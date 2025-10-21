import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly url: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.url =
      this.configService.get('OLLAMA_URL', 'http://ollama:11434') +
      '/api/embed';
  }

  async generateEmbeddings(
    input: string[],
    modelName: string = 'embeddinggemma',
  ): Promise<number[][]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.url,
          {
            model: modelName,
            input,
          },
          { timeout: 30000 },
        ),
      );
      this.logger.log(`Generated embedding with ${modelName}, batchSize: ${response.data.embeddings.length}`);
      return response.data.embeddings;
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
}
