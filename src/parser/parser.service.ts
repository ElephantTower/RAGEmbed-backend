import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ModelsService } from 'src/embedding/models.service';
import { EmbeddingRepository } from 'src/embedding/embedding.repository';
import { DocumentsRepository } from './documents.repository';
import { JSDOM } from 'jsdom';
import { TokenTextSplitter } from '@langchain/textsplitters';
import { getEncoding, Tiktoken } from "js-tiktoken";
import { delay } from 'src/utils/delay.util';

interface Chunk {
  chunkId: number;
  text: string;
  displayText: string;
  documentId: string;
}

interface Document {
  title: string;
  href: string;
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
  private readonly encoding: Tiktoken;
  private readonly contentsUrl: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private modelsService: ModelsService,
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
    this.encoding = getEncoding("cl100k_base");
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

      const elements = document.querySelectorAll('h1, h2, p, table, code, li, span');
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

    const tokens = this.encoding.encode(text);
    const chunks: Chunk[] = [];
    const step = chunkSize - chunkOverlap;

    let pos = 0;
    let id = 0;

    while (pos < tokens.length) {
      const chunkEnd = Math.min(pos + chunkSize, tokens.length);

      const fullTokens = tokens.slice(pos, chunkEnd);
      const fullText = this.encoding.decode(fullTokens);

      const displayStart = id === 0 ? 0 : chunkOverlap;
      const displayTokens = fullTokens.slice(displayStart);
      const displayText = this.encoding.decode(displayTokens);

      chunks.push({
        chunkId: id++,
        documentId,
        text: fullText,
        displayText,
      });

      pos += step;
    }

    return chunks;
  }

  async updateDocuments(
    documents: { title: string; href: string }[]
  ): Promise<Document[]>
  {
    const processedDocuments: Document[] = [];
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
    return processedDocuments;
  }

  async prepareChunks(
    documents: Document[],
    delayMs: number,
    chunkSize: number,
    chunkOverlap: number,
  ): Promise<Chunk[]> {
    const allChunks: Chunk[] = [];
    for (const document of documents) {
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

      allChunks.push(...chunks);
      await delay(delayMs);
    }
    return allChunks;
  }

  async collectEmbeddings(
    delayMs: number = 1000,
    chunkSize: number = 500,
    chunkOverlap: number = 100,
    batchSize: number = 16,
    limit: number = 2,
  ) {
    const documents = await this.parseTitles();

    const processedDocuments = await this.updateDocuments(documents);

    const limitedDocuments = processedDocuments.slice(0, limit);

    const allChunks = await this.prepareChunks(
      limitedDocuments,
      delayMs,
      chunkSize,
      chunkOverlap
    );

    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batchChunks = allChunks.slice(i, i + batchSize);
      const input = batchChunks.map((chunk) => 'search_document: ' + chunk.text);
      this.logger.log(`Processing batch ${i / batchSize}`);
      try {
        const batchEmbeddings = await this.modelsService.generateEmbeddings(input);

        if (batchEmbeddings.length !== input.length) {
          this.logger.error(
            `Mismatch in batch size for document ${document.title}, expected ${input.length}, got ${batchEmbeddings.length}`,
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
              batchChunks[bacthChunkInd].text,
              batchChunks[bacthChunkInd].displayText,
              batchChunks[bacthChunkInd].chunkId,
              chunkOverlap,
              batchEmbeddings[bacthChunkInd],
            );
          } catch (error) {
            this.logger.error(
              `Failed to save embedding for batch ${i / batchSize}, index ${bacthChunkInd}:`,
              error,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Error processing batch ${i / batchSize}:`,
          error,
        );
      }
    }

    this.logger.log(
      `Collection completed`,
    );
    return {
      success: true,
      total: limitedDocuments.length,
    };
  }
}
