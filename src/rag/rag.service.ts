import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OllamaService } from '../ollama/ollama.service';
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
      const model = await this.embeddingRepository.getModel(model_name);
      if (!model) {
        throw new NotFoundException(`There is no model named ${model_name}`);
      }

      const queryVector = await this.ollamaService.generateEmbeddings(
        [model.queryPrefix + ' ' + input],
        model_name,
      );
      this.logger.log(
        `Generated embedding for query: ${input.substring(0, 50)}... with model ${model_name}`,
      );

      this.logger.log(`Using model: ${model_name}`);

      const results = await this.embeddingRepository.findSimilar(
        queryVector[0],
        model.id,
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

  async giveAnswer(
    input: string,
    model_name: string,
    metric: string,
    length: number = 5,
  ): Promise<string> {
    try {
      const model = await this.embeddingRepository.getModel(model_name);
      if (!model) {
        throw new NotFoundException(`There is no model named ${model_name}`);
      }
      const translatedInput =
        await this.ollamaService.translateFromRussianToEnglish(input);
      this.logger.log(
        `Generated translation for query: ${input.substring(0, 50)}... Translation: ${translatedInput.substring(0, 50)}`,
      );
      const queryVector = await this.ollamaService.generateEmbeddings(
        [model.queryPrefix + ' ' + translatedInput],
        model_name,
      );
      this.logger.log(
        `Generated embedding for query: ${translatedInput.substring(0, 50)}... with model ${model_name}`,
      );

      const contextChunks =
        await this.embeddingRepository.findNearestEmbeddings(
          queryVector[0],
          model.id,
          metric,
          length,
        );

      return await this.ollamaService.giveAnswer(
        input,
        contextChunks.map((c) => c.text),
      );
    } catch (error) {
      this.logger.error('RAG search failed', error);
      throw error;
    }
  }
}
