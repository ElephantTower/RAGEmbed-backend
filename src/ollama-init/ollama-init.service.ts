import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { EmbeddingRepository } from 'src/embedding/embedding.repository';

@Injectable()
export class OllamaInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OllamaInitService.name);
  private readonly url: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private embeddingRepository: EmbeddingRepository
  ) {
    this.url = this.configService.get('OLLAMA_URL', 'http://ollama:11434') + '/api/pull';
  }

  async onApplicationBootstrap() {
    this.pullAllModelsInBackground();
  }
 
  async pullAllModelsInBackground() {
    const models = await this.embeddingRepository.getAllModels();
    this.logger.log(`Run pull ${models.length} models in the background...`);

    for (const { nameInOllama } of models) {
      this.httpService
        .post(this.url, { model: nameInOllama })
        .subscribe({
          next: () => this.logger.log(`Pull for model: ${nameInOllama}`),
          error: (err) =>
            this.logger.error(`Error pulling ${nameInOllama}: ${err.message}`),
        });
    }
  }
}