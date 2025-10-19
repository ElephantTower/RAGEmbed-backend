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
      '/api/embeddings';
  }

  async generateEmbedding(
    prompt: string,
    modelName: string = 'embedding-gemma',
  ): Promise<number[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.url,
          {
            model: modelName,
            prompt,
          },
          { timeout: 30000 },
        ),
      );
      this.logger.log(`Generated embedding with ${modelName}`);
      return response.data.embedding;
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
