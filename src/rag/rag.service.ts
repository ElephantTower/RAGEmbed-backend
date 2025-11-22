import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModelsService } from '../embedding/models.service';
import { EmbeddingRepository } from '../embedding/embedding.repository';
import { Response } from 'express';

interface RetrievedChunk{
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
  ) {}

  async findSimilar(
    input: string,
    metric: string,
    length: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    try {

      const queryVector = await this.modelsService.generateEmbeddings(
        ['search_query: ' + input],
      );
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
    topDocuments: number = 2
  ): Promise<any> {
    const messages = await this.buildMessages(input, metric, topChunks, topDocuments);
    const response = await this.modelsService.chat(messages, false);
    this.logger.log(`Answered with model`);
    return { answer: response.data.message.content };
  }

  async processUserMessageStream(
    input: string,
    res: Response,
    metric: string = 'cosine',
    topChunks: number = 10,
    topDocuments: number = 2
  ) {
    const messages = await this.buildMessages(input, metric, topChunks, topDocuments);

    const response = await this.modelsService.chat(messages, true);

    const stream = response.data;

    stream.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            res.write(`data: ${JSON.stringify({ token: json.message.content })}\n\n`);
          }
          if (json.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
          }
        } catch {
        }
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
    topDocuments: number = 2
  ): Promise<{ role: string; content: string }[]>{
    try {
      const queryVector = await this.modelsService.generateEmbeddings(['search_query: ' + input]);

      this.logger.log(
        `Generated embedding for query: ${input.substring(0, 50)}...`,
      );

      const chunks: RetrievedChunk[] = await this.embeddingRepository.findSimilarChunks(
        queryVector[0],
        metric,
        topChunks,
      );
      this.logger.log(`Found ${chunks.length} similar chunks`);

      const mergedChunks = this.mergeRetrievedChunks(chunks);

      const bestIndicies = await this.modelsService.rerank(
        input,
        mergedChunks.map(obj => obj.text),
        topDocuments
      );

      const finalChunks = bestIndicies.map(i => mergedChunks[i].text);

      const systemPrompt = `Ты — эксперт по языку программирования PascalABC.NET. 
      Отвечай на русском языке, максимально точно, с примерами кода когда это уместно.
      Используй только информацию из предоставленного контекста. 
      Если в контексте нет ответа — скажи "Я не нашел информацию по этому вопросу в документации PascalABC.NET".
      Не придумывай ничего от себя.`;

      const userContent = `Достоверный контекст из документации PascalABC.NET:\n\n${finalChunks
        .map((text, i) => `--- Фрагмент ${i + 1} ---\n${text}`)
        .join('\n\n')}\n\nВопрос: ${input}\n\nОтветь на вопрос строго по контексту.`;
      
      const messages: { role: string; content: string }[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ];

      return messages;
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
  }

  mergeRetrievedChunks(
    chunks: RetrievedChunk[]
  ):{ text: string; documentId: string; sourceChunkIds: number[]; minDistance: number }[] {
    if (chunks.length === 0) return [];

    const byDoc = chunks.reduce((acc, c) => {
      (acc[c.documentId] ??= []).push(c);
      return acc;
    }, {} as Record<string, RetrievedChunk[]>);

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
