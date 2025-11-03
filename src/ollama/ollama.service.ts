import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  private readonly embedUrl: string;
  private readonly generateUrl: string;
  private readonly translationModelName: string;
  private readonly mainModelName: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    const ollamaHost = this.configService.get(
      'OLLAMA_URL',
      'http://ollama:11434',
    );
    this.baseUrl = ollamaHost;
    this.embedUrl = `${ollamaHost}/api/embed`;
    this.generateUrl = `${ollamaHost}/api/generate`;
    this.translationModelName = this.configService.get(
      'TRANSLATION_MODEL',
      'facebook/nllb-200-distilled-600M',
    );
    this.mainModelName = this.configService.get('MAIN_MODEL', 'llama3.1:8b');
  }

  async generateEmbeddings(
    input: string[],
    modelName: string,
  ): Promise<number[][]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.embedUrl,
          {
            model: modelName,
            input,
          },
          // { timeout: 30000 },
        ),
      );
      this.logger.log(
        `Generated embedding with ${modelName}, batchSize: ${response.data.embeddings.length}`,
      );
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

  async translateFromRussianToEnglish(text: string): Promise<string> {
    try {
      const prompt = `Translate from Russian to English: ${text}`;

      const response = await firstValueFrom(
        this.httpService.post(
          this.generateUrl,
          {
            model: this.translationModelName,
            prompt,
            stream: false,
          },
          // { timeout: 60000 },
        ),
      );

      const translatedText = response.data.response.trim();
      this.logger.log(
        `Translated text with ${this.translationModelName}: "${text.substring(0, 50)}..." -> "${translatedText.substring(0, 50)}..."`,
      );

      return translatedText;
    } catch (error) {
      this.logger.error('Failed to translate text', error);
      if (error.response) {
        this.logger.error(
          `HTTP error: ${error.response.status} - ${error.response.data}`,
        );
      }
      throw error;
    }
  }

  async summarizeChunk(chunk: string, documentTitle?: string): Promise<string> {
    try {
      const titlePart = documentTitle
        ? `From document: "${documentTitle}"\n`
        : '';
      const prompt = `${titlePart}Summarize the following text chunk in English, keeping the main ideas concise (3-5 sentences): ${chunk}`;

      const response = await firstValueFrom(
        this.httpService.post(
          this.generateUrl,
          {
            model: this.mainModelName,
            prompt,
            stream: false,
          },
          // { timeout: 60000 },
        ),
      );

      const summary = response.data.response.trim();
      this.logger.log(
        `Summarized chunk with ${this.mainModelName}: length ${chunk.length} -> ${summary.length} chars`,
      );

      return summary;
    } catch (error) {
      this.logger.error('Failed to summarize chunk', error);
      throw error;
    }
  }

  async giveAnswer(query: string, chunks: string[]): Promise<string> {
    try {
      const context = chunks.join('\n\n');
      const prePrompt =
        'Answer the following question based on the provided context. If the context does not contain relevant information, say so. Keep the answer concise and accurate.';
      const prompt = `${prePrompt}\n\nQuestion: ${query}\n\nContext: ${context}\n\nAnswer:`;

      const response = await firstValueFrom(
        this.httpService.post(
          this.generateUrl,
          {
            model: this.mainModelName,
            prompt,
            stream: false,
          },
          // { timeout: 60000 },
        ),
      );

      const answer = response.data.response.trim();
      this.logger.log(
        `Generated answer with ${this.mainModelName}: query length ${query.length}, context length ${chunks.length} -> answer length ${answer.length} chars`,
      );

      return answer;
    } catch (error) {
      this.logger.error('Failed to generate answer', error);
      throw error;
    }
  }
}
