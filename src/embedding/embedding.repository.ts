import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fromSql, toSql } from 'pgvector/utils';
import { Embedding as PrismaEmbedding, Document } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

type Embedding = PrismaEmbedding & {
  vector: number[];
};

type RawEmbedding = PrismaEmbedding & {
  vector: string;
};

function toEmbedding(rawEmbedding: RawEmbedding): Embedding {
  return {
    ...rawEmbedding,
    vector: fromSql(rawEmbedding.vector),
  };
}

@Injectable()
export class EmbeddingRepository {
  constructor(private prisma: PrismaService) {}

  async saveEmbedding(
    documentId: string,
    text: string,
    displayText: string,
    chunkIdx: number,
    overlap: number,
    vector: number[],
  ): Promise<Embedding> {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < MAX_RETRIES) {
      const id = createId();
      const vectorSql = toSql(vector);

      try {
        const result = await this.prisma.$queryRaw<RawEmbedding[]>`
        INSERT INTO "Embedding" ("id", "documentId", "chunkText", "displayText", "chunkIdx", "overlap", "vector", "updatedAt")
        VALUES (${id}, ${documentId}, ${text}, ${displayText}, ${chunkIdx}, ${overlap}, ${vectorSql}::vector(768), NOW())
        ON CONFLICT ("documentId", "chunkIdx")
        DO UPDATE SET 
          vector = ${vectorSql}::vector(768),
          "updatedAt" = NOW()
        RETURNING 
        "id", 
        "documentId", 
        "chunkIdx", 
        vector::text AS "vector",
        "updatedAt"
      `;

        if (result[0]) {
          return toEmbedding(result[0]);
        }
        throw new Error('Failed to save or update embedding');
      } catch (error: any) {
        attempt++;
        lastError = error;
        console.warn(
          `Collision detected (or just an error) on ID ${id}, retrying... (attempt ${attempt}/${MAX_RETRIES})`,
        );
        continue;
      }
    }
    throw new Error(
      `Failed to save embedding after ${MAX_RETRIES} retries due to: ${lastError?.message}`,
    );
  }

  async getEmbeddingByDocument(documentId: string): Promise<Embedding | null> {
    const result = await this.prisma.$queryRaw<RawEmbedding[]>`
      SELECT *
      FROM "Embedding"
      WHERE documentId = ${documentId}
    `;

    if (!result[0]) {
      return null;
    }

    return toEmbedding(result[0]);
  }

  getDistanceOp(metricName: string): string {
    let distanceOp: string;
    switch (metricName.toLowerCase()) {
      case 'cosine':
        distanceOp = '<=>';
        break;
      case 'euclidean':
      case 'l2':
        distanceOp = '<->';
        break;
      case 'ip':
      case 'inner_product':
        distanceOp = '<#>';
        break;
      default:
        throw new Error(
          `Unsupported metric: ${metricName}. Supported: cosine, euclidean/l2, ip/inner_product`,
        );
    }
    return distanceOp;
  }

  async findSimilarDocuments(
    queryVector: number[],
    metric: string,
    limit: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    const querySql = toSql(queryVector);

    const distanceOp = this.getDistanceOp(metric);

    const results = await this.prisma.$queryRawUnsafe<
      { title: string; link: string; distance: number }[]
    >(
      `
      SELECT 
        d."title",
        d."link",
        MIN(e."vector" ${distanceOp} '${querySql}'::vector(768)) AS "distance"
      FROM "Embedding" e
      INNER JOIN "Document" d ON e."documentId" = d."id"
      GROUP BY d."id", d."title", d."link"
      ORDER BY "distance" ASC
      LIMIT $1
    `,
      limit,
    );

    return results.map((row) => ({
      title: row.title,
      link: row.link,
      distance: row.distance,
    }));
  }

  async findSimilarChunks(
    queryVector: number[],
    metric: string,
    limit: number = 5,
  ): Promise<{
    chunkIdx: number;
    chunkText: string;
    displayText: string;
    documentId: string;
    distance: number;
  }[]> {
    const querySql = toSql(queryVector);

    const distanceOp = this.getDistanceOp(metric);

    const results = await this.prisma.$queryRawUnsafe<
      {
        chunkIdx: number;
        chunkText: string;
        displayText: string;
        documentId: string;
        distance: number;
      }[]
    >(
      `
      SELECT 
        e."chunkIdx",
        e."chunkText",
        e."displayText",
        e."documentId",
        e."vector" ${distanceOp} '${querySql}'::vector(768) AS "distance"
      FROM "Embedding" e
      INNER JOIN "Document" d ON e."documentId" = d."id"
      ORDER BY "distance" ASC
      LIMIT $1
    `,
      limit,
    );

    return results;
  }
  
}
