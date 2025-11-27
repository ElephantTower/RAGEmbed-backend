import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModelsService } from '../embedding/models.service';
import { EmbeddingRepository } from '../embedding/embedding.repository';
import { Response } from 'express';
import { DocumentsRepository } from 'src/parser/documents.repository';
import { Document } from '@prisma/client';

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
    private documentsRepository: DocumentsRepository,
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
    input: string,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ): Promise<any> {
    const messages = await this.buildMessages(
      input,
      metric,
      topChunks,
      topDocuments,
    );
    const response = await this.modelsService.chat(messages, false);
    this.logger.log(`Answered with model`);
    return { answer: response.data.message.content };
  }

  async processUserMessageStream(
    input: string,
    res: Response,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ) {
    const messages = await this.buildMessages(
      input,
      metric,
      topChunks,
      topDocuments,
    );

    const response = await this.modelsService.chat(messages, true);

    const stream = response.data;

    stream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            res.write(
              `data: ${JSON.stringify({ token: json.message.content })}\n\n`,
            );
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
          }
        } catch {}
      }
    });

    stream.on('end', () => res.end());
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

  async buildMessages(
    input: string,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2,
  ): Promise<{ role: string; content: string }[]> {
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

      const documentsArr = await this.documentsRepository.findByIds(
        mergedChunks.map((chunk) => chunk.documentId),
      );
      const documentsMap: { [key: string]: Document } =
        documentsArr?.reduce((acc, currentDocument) => {
          acc[currentDocument.id] = currentDocument;
          return acc;
        }, {}) ?? {};

      const finalLinks = bestIndicies.map(
        (i) => documentsMap[mergedChunks[i].documentId].link,
      );

      const systemPrompt = `Ты — ассистент по документации PascalABC.NET. Твоя задача — помогать пользователям с вопросами о языке программирования PascalABC.NET, его функциях, синтаксисе и примерах на основе официальной документации.

Используй предоставленный контекст для точных ответов, но никогда не упоминай контекст, фрагменты, источники или процесс поиска в основном тексте ответа. Отвечай так, будто ты знаешь эту информацию наизусть.

Обработка специальных вопросов:
- Если вопрос касается твоей роли или способностей (например, "кто ты?", "что ты умеешь?", "расскажи о себе", "как ты работаешь?" или "что ты знаешь?"), отвечай разнообразно и дружелюбно: всегда подчёркивай, что ты специалист по документации PascalABC.NET, перечисли ключевые умения (объяснять синтаксис, функции, примеры кода), варьируй формулировки для живости (используй синонимы, добавь энтузиазм или лёгкий юмор, если уместно), но будь краток. Закончи перенаправлением к теме: "Чем могу помочь с PascalABC.NET?" или похожей фразой в вариациях. Не повторяй один и тот же текст — делай каждый ответ естественным и уникальным.

Правила цитирования:
- Если в твоём ответе используется информация из конкретных фрагментов контекста (определи это логично: если ключевые факты, примеры или детали взяты из фрагмента), в самом конце ответа (после основного текста) добавь раздел "Использованные источники:" с маркированным списком только тех ссылок, которые релевантны (из заголовков фрагментов, например, "Ссылка [link]"). Не добавляй этот раздел, если фрагменты не использовались.
- Формат раздела: Начинай с строки "Использованные источники:" на новой строке, затем маркированный список (- [ссылка1]\n- [ссылка2]), без лишних объяснений или текста. Пример: 
Использованные источники:
- https://example.com/doc1
- https://example.com/doc2

Правила ответа:
- Отвечай только на русском языке, кроме фрагментов кода, терминов и примеров на PascalABC.NET (они на английском).
- Будь кратким, четким и полезным: сразу давай ответ по сути, без вводных фраз вроде "Вот ответ..." или "На основе...".
- Если вопрос касается кода, приводи примеры с объяснениями.
- Если контекст не содержит нужной информации или вопрос не связан с PascalABC.NET (кроме специальных вопросов выше), вежливо скажи что-то подобное: "Извините, мой фокус — только на документации PascalABC.NET. Если вопрос по этой теме, я на связи!" немного меняй формулирки, чтобы не звучало шаблонно.
- Не отвечай подробно на вопросы, не связанные с PascalABC.NET, и не продолжай разговор на отвлечённые темы. Если пользователь просто здоровается (например, "привет"), поздоровайся в живой манере и расскажи, чем ты можешь быть полезен.`;

      const userContent = `Контекст: \n\n${finalChunks
        .map(
          (text, i) =>
            `--- Фрагмент ${i + 1}. Ссылка [${finalLinks[i]}] ---\n${text}\n`,
        )
        .join(
          '\n\n',
        )}\n\nВопрос пользователя: ${input}\n\nОтветь на вопрос строго по контексту.`;

      const messages: { role: string; content: string }[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

      return messages;
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
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
