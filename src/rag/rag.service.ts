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
    input: string,
    model_name: string,
    metric: string,
    length: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    try {
      const queryVector = await this.ollamaService.generateEmbeddings([input], model_name);
      this.logger.log(
        `Generated embedding for query: ${input.substring(0, 50)}... with model ${model_name}`,
      );

      const modelId = await this.embeddingRepository.getModelId(model_name);
      this.logger.log(`Using model ID: ${modelId}`);

      const results = await this.embeddingRepository.findSimilar(
        queryVector[0],
        modelId,
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
}