import { Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../embedding/ollama.service';
import { EmbeddingRepository } from '../embedding/embedding.repository';

@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private ollamaService: OllamaService,
    private embeddingRepository: EmbeddingRepository,
  ) {}

  async findSimilar(
    query: string,
    n: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    try {
      const queryVector = await this.ollamaService.generateEmbedding(query); // TODO add model name?
      this.logger.log(`Generated embedding for query: ${query.substring(0, 50)}...`);

      const results = await this.embeddingRepository.findSimilar(
        queryVector,
        n,
      );
      this.logger.log(`Found ${results.length} similar documents`);

      return results;
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
  }
}