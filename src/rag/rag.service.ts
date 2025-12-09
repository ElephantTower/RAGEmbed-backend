import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModelsService } from '../embedding/models.service';
import { EmbeddingRepository } from '../embedding/embedding.repository';
import { Response } from 'express';
import { Chat, Message, Role } from '@prisma/client';
import { ChatService } from './chat.service';

interface RetrievedChunk {
  chunkIdx: number;
  chunkText: string;
  displayText: string;
  documentId: string;
  distance: number;
}

@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private modelsService: ModelsService,
    private embeddingRepository: EmbeddingRepository,
    private chatService: ChatService,
  ) {}

  async findSimilar(
    input: string,
    metric: string,
    length: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    try {
      const queryVector = await this.modelsService.generateEmbeddings([
        'search_query: ' + input,
      ]);
      this.logger.log(
        `Generated embedding for query: ${input.substring(0, 50)}...`,
      );

      const results = await this.embeddingRepository.findSimilarDocuments(
        queryVector[0],
        metric,
        length,
      );
      this.logger.log(`Found ${results.length} similar documents`);

      return results;
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
  }

  async processUserMessage(
    chat: Chat,
    input: string,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ): Promise<any> {
    const prevMessages = (
      await this.chatService.getMessagesWithSystem(chat)
    ).map((message) => {
      return { content: message.content, role: message.role };
    });

    const newMessages: {
      role: Role;
      content: string;
    }[] = [];
    if (prevMessages.length === 0) {
      newMessages.push(this.buildStarterMessage());
    }

    newMessages.push(
      await this.buildMessage(input, metric, topChunks, topDocuments),
    );

    const response = await this.modelsService.chat(
      [...prevMessages, ...newMessages],
      false,
    );
    this.logger.log(`Answered with model`);

    newMessages.push({
      content: response.data.message.content,
      role: 'assistant',
    });

    for (const message of newMessages) {
      await this.chatService.createMessage(chat, message.content, message.role);
    }

    return { answer: response.data.message.content };
  }

  async processUserMessageStream(
    chat: Chat,
    input: string,
    res: Response,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ) {
    const prevMessages = (
      await this.chatService.getMessagesWithSystem(chat)
    ).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const newMessages: {
      role: Role;
      content: string;
      rawContent?: string;
    }[] = [];

    if (prevMessages.length === 0) {
      newMessages.push(this.buildStarterMessage());
    }

    const userMessage = await this.buildMessage(
      input,
      metric,
      topChunks,
      topDocuments,
    );

    newMessages.push(userMessage);

    const response = await this.modelsService.chat(
      [...prevMessages, ...newMessages],
      true,
    );

    const stream = response.data;

    let assistantContent = '';

    const saveNewMessages = async (
      newMessages: {
        role: Role;
        content: string;
        rawContent?: string;
      }[],
    ) => {
      for (const msg of newMessages) {
        await this.chatService.createMessage(
          chat,
          msg.content,
          msg.role,
          msg.rawContent,
        );
      }
    };

    stream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            const token = json.message.content;
            assistantContent += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);

            this.logger.log(`Answered with model`);

            newMessages.push({
              content: assistantContent,
              role: 'assistant',
            });

            saveNewMessages(newMessages).catch((err) => {
              this.logger.error('Failed to save messages after stream', err);
            });

            res.end();
          }
        } catch {}
      }
    });

    stream.on('end', () => {
      if (!res.headersSent) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      res.end();
    });

    stream.on('error', (err) => {
      this.logger.error('Ollama stream error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream failed' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
        res.end();
      }
    });
  }

  async buildMessage(
    input: string,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ): Promise<{ role: Role; content: string; rawContent: string }> {
    try {
      const queryVector = await this.modelsService.generateEmbeddings([
        'search_query: ' + input,
      ]);

      this.logger.log(
        `Generated embedding for query: ${input.substring(0, 50)}...`,
      );

      const chunks: RetrievedChunk[] =
        await this.embeddingRepository.findSimilarChunks(
          queryVector[0],
          metric,
          topChunks,
        );
      this.logger.log(`Found ${chunks.length} similar chunks`);

      const mergedChunks = this.mergeRetrievedChunks(chunks);

      const bestIndicies = await this.modelsService.rerank(
        input,
        mergedChunks.map((obj) => obj.text),
        topDocuments,
      );

      const finalChunks = bestIndicies.map((i) => mergedChunks[i].text);

      const userContent = `Вопрос пользователя: ${input}\n\nОтветь на вопрос строго по контексту.\n\nКонтекст: \n\n${finalChunks
        .map((text, i) => `--- Фрагмент ${i + 1} ---\n${text}\n`)
        .join('\n\n')}`;

      return { role: 'user', content: userContent, rawContent: input };
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
  }

  buildStarterMessage(): {
    role: Role;
    content: string;
    rawContent?: string;
  } {
    const systemPrompt = `Ты — ассистент по документации PascalABC.NET. Твоя задача — помогать пользователям с вопросами о языке программирования PascalABC.NET, его функциях, синтаксисе и примерах на основе официальной документации.

Используй предоставленный контекст для точных ответов и предыдущие сообщения, но никогда не упоминай контекст, источники или процесс поиска в своем ответе. Отвечай так, будто ты знаешь эту информацию наизусть.

Обработка специальных вопросов:
- Если вопрос касается твоей роли или способностей (например, "кто ты?", "что ты умеешь?", "расскажи о себе", "как ты работаешь?" или "что ты знаешь?"), отвечай разнообразно и дружелюбно: всегда подчёркивай, что ты специалист по документации PascalABC.NET, перечисли ключевые умения (объяснять синтаксис, функции, примеры кода), варьируй формулировки для живости (используй синонимы, добавь энтузиазм или лёгкий юмор, если уместно), но будь краток. Закончи перенаправлением к теме: "Чем могу помочь с PascalABC.NET?" или похожей фразой в вариациях. Не повторяй один и тот же текст — делай каждый ответ естественным и уникальным.
- Примеры вариаций (используй как вдохновение, но не копируй дословно):
  - На "кто ты?": "Привет! Я — виртуальный помощник, заточенный под документацию PascalABC.NET. Знаю всё о синтаксисе, функциях и коде. Готов помочь с твоим вопросом по языку!"
  - На "что ты умеешь?": "Я мастер по PascalABC.NET: объясняю, как писать код, разбираю примеры и отвечаю на технические вопросы. Давай, спрашивай — что интересует?"

Правила ответа:
- Отвечай только на русском языке, кроме фрагментов кода, терминов и примеров на PascalABC.NET (они на английском).
- Будь кратким, четким и полезным: сразу давай ответ по сути, без вводных фраз вроде "Вот ответ..." или "На основе...".
- Если вопрос касается кода, приводи примеры с объяснениями.
- Если контекст не содержит нужной информации или вопрос не связан с PascalABC.NET (кроме специальных вопросов выше), вежливо скажи в вариациях: "Извините, мой фокус только на документации PascalABC.NET. Если вопрос по этой теме, я на связи!" или подобное, чтобы не звучало шаблонно.
- Не отвечай подробно на вопросы, не связанные с PascalABC.NET, и не продолжай разговор на отвлечённые темы. Если пользователь просто здоровается (например, "привет"), ответь в живой манере: "Привет! Рад тебя видеть. Я здесь, чтобы помочь с PascalABC.NET — что на уме?" или вариацию.
- Обращай внимание, если пользователь ссылается на предыдущие сообщения`;

    return { role: 'system', content: systemPrompt };
  }

  mergeRetrievedChunks(chunks: RetrievedChunk[]): {
    text: string;
    documentId: string;
    sourceChunkIds: number[];
    minDistance: number;
  }[] {
    if (chunks.length === 0) return [];

    const byDoc = chunks.reduce(
      (acc, c) => {
        (acc[c.documentId] ??= []).push(c);
        return acc;
      },
      {} as Record<string, RetrievedChunk[]>,
    );

    const result: {
      text: string;
      documentId: string;
      sourceChunkIds: number[];
      minDistance: number;
    }[] = [];

    for (const docId in byDoc) {
      const list = byDoc[docId];
      list.sort((a, b) => a.chunkIdx - b.chunkIdx);

      let mergedText = list[0].displayText;
      let currentIds = [list[0].chunkIdx];
      let currentMinDist = list[0].distance;

      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];

        const isConsecutive = curr.chunkIdx === prev.chunkIdx + 1;

        if (isConsecutive) {
          mergedText += curr.displayText;
          currentIds.push(curr.chunkIdx);
          currentMinDist = Math.min(currentMinDist, curr.distance);
        } else {
          result.push({
            text: mergedText,
            documentId: docId,
            sourceChunkIds: currentIds,
            minDistance: currentMinDist,
          });

          mergedText = curr.displayText;
          currentIds = [curr.chunkIdx];
          currentMinDist = curr.distance;
        }
      }

      result.push({
        text: mergedText,
        documentId: docId,
        sourceChunkIds: currentIds,
        minDistance: currentMinDist,
      });
    }

    return result;
  }
}
