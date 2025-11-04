import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OllamaService } from 'src/ollama/ollama.service';
import { EmbeddingRepository } from 'src/embedding/embedding.repository';
import { DocumentsRepository } from './documents.repository';
import { JSDOM } from 'jsdom';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { delay } from 'src/utils/delay.util';
import { Embedding, Document, Model } from '@prisma/client';

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
    modelNames: string[] = [],
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
    const documentPromises: Promise<any>[] = [];
    for (const document of processedDocuments) {
      documentPromises.push(
        this.processDocument(
          document,
          chunkSize,
          chunkOverlap,
          batchSize,
          modelNames,
        ),
      );
      await delay(delayMs);
    }
    await Promise.all(documentPromises);

    this.logger.log(
      `Collection completed. Processed ${processedDocuments.length} documents.`,
    );
    return {
      success: true,
      total: processedDocuments.length,
    };
  }
  async processDocument(
    document: {
      title: string;
      href: string;
      documentId: string;
    },
    chunkSize: number,
    chunkOverlap: number,
    batchSize: number,
    modelNames: string[],
  ): Promise<any> {
    const text = await this.getTextFromDocument(document.href);
    if (!text.trim()) {
      this.logger.warn(
        `Document ${document.documentId}: No text extracted for document`,
      );
      return;
    }

    const translatedTitle =
      await this.ollamaService.translateFromRussianToEnglish(document.title);
    await this.documentsRepository.addTranslatedTitle(
      document.documentId,
      translatedTitle,
    );

    const chunks = await this.chunkDocument(
      text,
      document.documentId,
      chunkSize,
      chunkOverlap,
    );
    if (chunks.length === 0) {
      this.logger.warn(
        `Document ${document.documentId}: No chunks created for document`,
      );
      return;
    }
    const models = await this.embeddingRepository.getAllModels();
    await this.createProcessingTasks(
      document,
      translatedTitle,
      chunks,
      models,
      modelNames,
      batchSize,
    );
  }

  private async createProcessingTasks(
    document: { documentId: string },
    translatedTitle: string,
    chunks: Chunk[],
    models: Model[],
    modelNames: string[],
    batchSize: number,
  ): Promise<void> {
    for (const model of models) {
      if (modelNames.length > 0 && !modelNames.includes(model.nameInOllama)) {
        continue;
      }

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        try {
          this.logger.log(
            `Document ${document.documentId}: Model ${model.nameInOllama}: Processing batch ${i / batchSize}`,
          );

          const processedChunks = await this.processBatchChunks(
            document.documentId,
            translatedTitle,
            model,
            i / batchSize,
            batchChunks,
          );

          const successful = processedChunks.filter((p) => p !== null);
          if (successful.length === 0) {
            continue;
          }

          await this.generateAndSaveEmbeddingsForBatch(
            document.documentId,
            model,
            i / batchSize,
            successful,
          );
        } catch (error) {
          this.logger.error(
            `${document.documentId}: Model ${model.nameInOllama}: Error processing batch ${i / batchSize}`,
            error,
          );
        }
      }
    }
  }

  private async processBatchChunks(
    documentId: string,
    translatedTitle: string,
    model: Model,
    batchIndex: number,
    batchChunks: Chunk[],
  ) {
    const processedChunks: ({
      chunk: Chunk;
      translatedText: string;
      summary: string;
      batchChunkInd: number;
    } | null)[] = [];

    for (const [batchChunkInd, chunk] of batchChunks.entries()) {
      let translatedText: string;
      let summary: string;
      try {
        translatedText = await this.ollamaService.translateFromRussianToEnglish(
          chunk.text,
        );
        summary = await this.ollamaService.summarizeChunk(
          translatedText,
          translatedTitle,
        );
        processedChunks.push({ chunk, translatedText, summary, batchChunkInd });
      } catch (error) {
        this.logger.error(
          `Document ${documentId}: Model ${model.nameInOllama}: Batch ${batchIndex}: Failed to process chunk ${chunk.chunkId}, index ${batchChunkInd}`,
          error,
        );
        processedChunks.push(null);
      }
    }

    return processedChunks;
  }

  private async generateAndSaveEmbeddingsForBatch(
    documentId: string,
    model: any,
    batchIndex: number,
    successfulProcessedChunks: {
      chunk: Chunk;
      translatedText: string;
      summary: string;
      batchChunkInd: number;
    }[],
  ): Promise<void> {
    const inputs = successfulProcessedChunks.map(
      (p) => model.documentPrefix + ' ' + p.summary,
    );
    const batchEmbeddings = await this.ollamaService.generateEmbeddings(
      inputs,
      model.nameInOllama,
    );

    if (batchEmbeddings.length !== inputs.length) {
      this.logger.error(
        `Document ${documentId}: Model ${model.nameInOllama}: Mismatch in batch size, expected ${inputs.length}, got ${batchEmbeddings.length}`,
      );
      return;
    }

    for (const [successIdx, p] of successfulProcessedChunks.entries()) {
      try {
        await this.embeddingRepository.saveEmbedding(
          p.chunk.documentId,
          model.id,
          p.chunk.chunkId,
          batchEmbeddings[successIdx],
          p.chunk.text,
          p.translatedText,
          p.summary,
        );
      } catch (error) {
        this.logger.error(
          `Document ${documentId}: Model ${model.nameInOllama}: Batch ${batchIndex}: Failed to save embedding for chunk ${p.chunk.chunkId}`,
          error,
        );
      }
    }
  }
}
