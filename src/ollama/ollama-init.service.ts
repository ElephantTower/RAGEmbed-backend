import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { EmbeddingRepository } from 'src/embedding/embedding.repository';

@Injectable()
export class OllamaInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OllamaInitService.name);
  private readonly url: string;
  private readonly translationModelName: string;
  private readonly mainModelName: string;
  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private embeddingRepository: EmbeddingRepository,
  ) {
    this.url =
      this.configService.get('OLLAMA_URL', 'http://ollama:11434') + '/api/pull';
    this.translationModelName = this.configService.get(
      'TRANSLATION_MODEL',
      'facebook/nllb-200-distilled-600M',
    );
    this.mainModelName = this.configService.get('MAIN_MODEL', 'llama3.1:8b');
  }

  async onApplicationBootstrap() {
    this.pullAllModelsInBackground();
  }

  async pullAllModelsInBackground() {
    const models = await this.embeddingRepository.getAllModels();
    this.logger.log(
      `Run pull ${models.length} embedding models in the background...`,
    );

    for (const { nameInOllama } of models) {
      this.httpService.post(this.url, { model: nameInOllama }).subscribe({
        next: () => this.logger.log(`Pull for model: ${nameInOllama}`),
        error: (err) =>
          this.logger.error(`Error pulling ${nameInOllama}: ${err.message}`),
      });
    }

    this.logger.log(`Run pull translation model in the background...`);
    this.httpService
      .post(this.url, { model: this.translationModelName })
      .subscribe({
        next: () =>
          this.logger.log(`Pull for model: ${this.translationModelName}`),
        error: (err) =>
          this.logger.error(
            `Error pulling ${this.translationModelName}: ${err.message}`,
          ),
      });

    this.logger.log(`Run pull main model in the background...`);
    this.httpService.post(this.url, { model: this.mainModelName }).subscribe({
      next: () => this.logger.log(`Pull for model: ${this.mainModelName}`),
      error: (err) =>
        this.logger.error(
          `Error pulling ${this.mainModelName}: ${err.message}`,
        ),
    });
  }
}
