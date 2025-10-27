import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OllamaService } from 'src/embedding/ollama.service';
import { EmbeddingRepository } from 'src/embedding/embedding.repository';
import { DocumentsRepository } from './documents.repository';
import { JSDOM } from 'jsdom';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { delay } from 'src/utils/delay.util';

interface Chunk {
  chunkId: number;
  text: string;
  documentId: string;
}

interface EmbeddingResult {
  chunkId: number;
  documentId: string;
  modelName: string;
  embedding: number[];
}

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);
  private readonly baseUrl: string;
  private readonly contentsUrl: string;
  private readonly models: string[];

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private ollamaService: OllamaService,
    private embeddingRepository: EmbeddingRepository,
    private documentsRepository: DocumentsRepository,
  ) {
    this.baseUrl = this.configService.get(
      'DOCS_BASE_URL',
      'https://pascalabc.net/downloads/pabcnethelp/',
    );
    this.contentsUrl = this.configService.get(
      'DOCS_CONTENT_URL',
      'https://pascalabc.net/downloads/pabcnethelp/webhelpcontents.htm',
    );
    this.models = this.configService.get('MODEL_NAMES').split(' ');
  }

  async parseTitles(): Promise<{ title: string; href: string }[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(this.contentsUrl, { responseType: 'text' }),
      );
      const html = response.data;

      const dom = new JSDOM(html);
      const document = dom.window.document;

      const divs = document.querySelectorAll('div');
      const leafNodes: { title: string; href: string }[] = [];

      for (const div of divs) {
        const children = Array.from(div.children);
        if (children.length === 1 && children[0].tagName === 'NOBR') {
          const anchor = div.querySelector('a[href]');
          if (anchor) {
            const href = anchor.getAttribute('href') || '';
            if (
              href !== '#' &&
              href.startsWith('topics/') &&
              href.endsWith('.html')
            ) {
              const span = div.querySelector('span[id^="l"]');
              const title = span ? span.textContent?.trim() || '' : '';
              if (title) {
                leafNodes.push({ title, href });
              }
            }
          }
        }
      }
      return leafNodes;
    } catch (error) {
      this.logger.error('Failed to fetch or parse document:', error);
      return [];
    }
  }

  async getTextFromDocument(hrefPart: string): Promise<string> {
    try {
      const fullUrl = `${this.baseUrl}${hrefPart}`;
      const response = await firstValueFrom(
        this.httpService.get(fullUrl, { responseType: 'text' }),
      );
      const html = response.data;

      const dom = new JSDOM(html);
      const document = dom.window.document;

      document.querySelectorAll('script').forEach((script) => script.remove());

      const body = document.querySelector('body');
      if (!body) return '';

      const elements = document.querySelectorAll('h1, h2, p, table, code');
      let text = '';

      for (const el of elements) {
        let content = el.textContent || '';
        content = content.trim();
        text += `${content}\n`;
      }

      return text.trim();
    } catch (error) {
      this.logger.error(
        "Couldn't load or parse the text of the document:",
        error,
      );
      return '';
    }
  }

  async chunkDocument(
    text: string,
    documentId: string,
    chunkSize: number,
    chunkOverlap: number,
  ): Promise<Chunk[]> {
    if (!text) return [];

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkSize,
      chunkOverlap: chunkOverlap,
      separators: ['\n\n', '\n', ' ', ''],
    });

    const chunks = await splitter.splitText(text);
    return chunks.map((chunk, index) => ({
      chunkId: index,
      text: chunk,
      documentId: documentId,
    }));
  }

  async collectEmbeddings(
    delayMs: number = 1000,
    chunkSize: number = 1000,
    chunkOverlap: number = 300,
    batchSize: number = 16,
    limit: number = 5,
  ) {
    const documents = await this.parseTitles();

    const processedDocuments: {
      title: string;
      href: string;
      documentId: string;
    }[] = [];
    for (const doc of documents) {
      const fullLink = `${this.baseUrl}${doc.href}`;
      try {
        const dbDoc = await this.documentsRepository.upsertDocument(
          doc.title,
          fullLink,
        );
        processedDocuments.push({ ...doc, documentId: dbDoc.id });
      } catch (error) {
        this.logger.error(`Failed to upsert document ${doc.title}:`, error);
      }
    }

    const limitedDocuments = processedDocuments.slice(0, limit);
    let processedCount = 0;

    const allChunks: Chunk[] = [];
    for (const document of limitedDocuments) {
      this.logger.log(`Processing document: ${document.title}`);
      const text = await this.getTextFromDocument(document.href);
      if (!text.trim()) {
        this.logger.warn(`No text extracted for document: ${document.title}`);
        continue;
      }

      const chunks = await this.chunkDocument(
        text,
        document.documentId,
        chunkSize,
        chunkOverlap,
      );

      if (chunks.length === 0) {
        this.logger.warn(`No chunks created for document: ${document.title}`);
        continue;
      }

      processedCount += 1;
      allChunks.push(...chunks);
      await delay(delayMs);
    }

    for (const model of this.models) {
      this.logger.log(`  Model: ${model}`);
      const modelId = await this.embeddingRepository.getModelId(model);
      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batchChunks = allChunks.slice(i, i + batchSize);
        const input = batchChunks.map((chunk) => chunk.text);
        this.logger.log(`Processing batch ${i / batchSize} for model ${model}`);
        try {
          const batchEmbeddings = await this.ollamaService.generateEmbeddings(
            input,
            model,
          );

          if (batchEmbeddings.length !== input.length) {
            this.logger.error(
              `Mismatch in batch size for document ${document.title}, model ${model}, expected ${input.length}, got ${batchEmbeddings.length}`,
            );
            continue;
          }

          for (
            let bacthChunkInd = 0;
            bacthChunkInd < batchChunks.length;
            bacthChunkInd += 1
          ) {
            try {
              await this.embeddingRepository.saveEmbedding(
                batchChunks[bacthChunkInd].documentId,
                modelId,
                batchChunks[bacthChunkInd].chunkId,
                batchEmbeddings[bacthChunkInd],
              );
            } catch (error) {
              this.logger.error(
                `Failed to save embedding for batch ${i / batchSize}, index ${bacthChunkInd}, with ${model}:`,
                error,
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Error processing batch ${i / batchSize}, model ${model}:`,
            error,
          );
        }
      }
    }

    this.logger.log(
      `Collection completed. Processed ${processedCount} documents.`,
    );
    return {
      success: true,
      processed: processedCount,
      total: limitedDocuments.length,
    };
  }
}
