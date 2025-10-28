import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fromSql, toSql } from 'pgvector/utils';
import { Embedding as PrismaEmbedding, Document, Model } from '@prisma/client';
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
    modelId: string,
    chunkIdx: number,
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
        INSERT INTO "Embedding" ("id", "documentId", "modelId", "chunkIdx", "vector", "updatedAt")
        VALUES (${id}, ${documentId}, ${modelId}, ${chunkIdx}, ${vectorSql}::vector(768), NOW())
        ON CONFLICT ("documentId", "modelId", "chunkIdx")
        DO UPDATE SET 
          vector = ${vectorSql}::vector(768),
          "updatedAt" = NOW()
        RETURNING 
        "id", 
        "documentId", 
        "modelId", 
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

  async findSimilar(
    queryVector: number[],
    modelId: string,
    metric: string,
    limit: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    const querySql = toSql(queryVector);

    let distanceOp: string;
    switch (metric.toLowerCase()) {
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
          `Unsupported metric: ${metric}. Supported: cosine, euclidean/l2, ip/inner_product`,
        );
    }

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
      WHERE e."modelId" = $1
      GROUP BY d."id", d."title", d."link"
      ORDER BY "distance" ASC
      LIMIT $2
    `,
      modelId,
      limit,
    );

    return results.map((row) => ({
      title: row.title,
      link: row.link,
      distance: row.distance,
    }));
  }

  async getModel(nameInOllama: string): Promise<Model | null> {
    let model = await this.prisma.model.findUnique({
      where: { nameInOllama },
    });

    return model;
  }

  async getAllModels(): Promise<Model[]> {
    let models = await this.prisma.model.findMany();
    return models;
  }
}
