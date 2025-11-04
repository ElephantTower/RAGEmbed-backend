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
    this.logger.log(
      `Starting to generate embeddings for batch size ${input.length} with ${modelName}`,
    );
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

  private extractAnswerFromJSON(text: string): string {
    if (!text || typeof text !== 'string') {
      this.logger.warn(
        'extractAnswerFromJSON: Input text is empty or not a string, returning original.',
      );
      return text || '';
    }

    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      this.logger.warn(
        `extractAnswerFromJSON: No valid JSON braces found in text: "${text.substring(0, 50)}..."`,
      );
      return text;
    }

    const extractedJSON = text.slice(startIndex, endIndex + 1);

    try {
      const parsed = JSON.parse(extractedJSON);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'answer' in parsed &&
        typeof parsed.answer === 'string'
      ) {
        this.logger.debug(
          `extractAnswerFromJSON: Successfully extracted answer: "${parsed.answer.substring(0, 50)}..."`,
        );
        return parsed.answer;
      } else {
        this.logger.warn(
          `extractAnswerFromJSON: Parsed JSON lacks valid 'answer' field: ${JSON.stringify(parsed).substring(0, 100)}...`,
        );
        return text;
      }
    } catch (parseError) {
      this.logger.error(
        `extractAnswerFromJSON: Failed to parse extracted JSON "${extractedJSON.substring(0, 100)}...": ${parseError.message}`,
      );
      return text;
    }
  }

  async translateFromRussianToEnglish(text: string): Promise<string> {
    this.logger.log(
      `Starting to translate from Russian to English: "${text.substring(0, 50)}..." with ${this.translationModelName}`,
    );
    try {
      const prompt = `Translate from Russian to English: ${text}\nGive answer in JSON format {"answer": "[answer]"}`;

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

      const rawResponse = response.data.response.trim();
      const translatedText = this.extractAnswerFromJSON(rawResponse);

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
    this.logger.log(
      `Starting to summarize chunk of length ${chunk.length} with ${this.mainModelName}${documentTitle ? ` for document "${documentTitle}"` : ''}`,
    );
    try {
      const titlePart = documentTitle
        ? `From document: "${documentTitle}"\n`
        : '';
      const prompt = `${titlePart}Summarize the following text chunk in English, keeping the main ideas concise (3-5 sentences): ${chunk}\nGive answer in JSON format {"answer": "[answer]"}`;

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

      const rawResponse = response.data.response.trim();
      const summary = this.extractAnswerFromJSON(rawResponse);

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
    this.logger.log(
      `Starting to generate answer for query length ${query.length} with ${chunks.length} chunks using ${this.mainModelName}`,
    );
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
