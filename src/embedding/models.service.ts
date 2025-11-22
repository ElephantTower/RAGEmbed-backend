import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private readonly embedderUrl: string;
  private readonly embedderName: string;
  private readonly rerankerUrl: string;
  private readonly rerankerName: string;
  private readonly llmUrl: string;
  private readonly llmName: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.embedderUrl = this.configService.get('EMBEDDER_URL', 'http://embeddings:7997/embeddings');
    this.embedderName = this.configService.get('EMBEDDER_MODEL', 'deepvk/USER-base');
    this.rerankerUrl = this.configService.get('RERANKER_URL', 'http://embeddings:7997/rerank');
    this.rerankerName = this.configService.get('RERANKER_MODEL', 'qilowoq/bge-reranker-v2-m3-en-ru');
    this.llmUrl = this.configService.get('LLM_URL', 'http://ollama:11434/api/chat');
    this.llmName = this.configService.get('LLM_MODEL', 'qilowoq/bge-reranker-v2-m3-en-ru');
  }

  async generateEmbeddings(
    input: string[],
  ): Promise<number[][]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.embedderUrl,
          {
            model: this.embedderName,
            input: input,
          },
          { timeout: 30000 },
        ),
      );
      this.logger.log(`Generated embedding with ${this.embedderName}, batchSize: ${response.data.data.length}`);
      return response.data.data.map(obj => obj.embedding);
    } catch (error) {
      this.logger.error('Failed to generate embedding', error);
      if (error.response) {
        this.logger.error(
          `HTTP error: ${error.response.status} - ${error.response.data}`,
        );
      }
      throw error;
    }
  }

  async rerank(
    query: string,
    documents: string[],
    topN: number
  ): Promise<number[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.rerankerUrl,
          {
            model: this.rerankerName,
            query: query,
            documents: documents,
            return_documents: false,
            raw_scores: false,
            top_n: topN
          },
          { timeout: 300000 },
        ),
      );
      this.logger.log(`Reranked texts with model ${this.rerankerName}: ${topN}/ ${documents.length}`);
      return response.data.results.map(obj => obj.index);
    } catch (error) {
      this.logger.error('Failed to rerank', error);
      if (error.response) {
        this.logger.error(
          `HTTP error: ${error.response.status} - ${error.response.data}`,
        );
      }
      throw error;
    }
  }

  async chat(
    messages: { role: string; content: string }[],
    stream: boolean
  ): Promise<any> {
    try {
      const config: any = {
        timeout: 300000,
      };

      if (stream) {
        config.responseType = 'stream';
      }

      const response = firstValueFrom(
        this.httpService.post(
          this.llmUrl,
          {
            model: this.llmName,
            messages: messages,
            stream: stream
          },
          config,
        ),
      );
      return response;
    } catch (error) {
      this.logger.error('Failed to answer', error);
      if (error.response) {
        this.logger.error(
          `HTTP error: ${error.response.status} - ${error.response.data}`,
        );
      }
      throw error;
    }
  }
}
