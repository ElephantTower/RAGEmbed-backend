import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { fromSql, toSql } from 'pgvector/utils';
import { Embedding as PrismaEmbedding, Document } from '@prisma/client';

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
    vector: number[],
  ): Promise<Embedding> {
    const vectorSql = toSql(vector);

    const result = await this.prisma.$queryRaw<RawEmbedding[]>`
      INSERT INTO "Embedding" (documentId, modelId, vector)
      VALUES (${documentId}, ${modelId}, ${vectorSql}::vector(768))
      ON CONFLICT (documentId, modelId)
      DO UPDATE SET vector = ${vectorSql}::vector(768)
      RETURNING *
    `;

    if (!result[0]) {
      throw new Error('Failed to save or update embedding');
    }

    return toEmbedding(result[0]);
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
    limit: number = 5,
  ): Promise<{ title: string; link: string; distance: number }[]> {
    const querySql = toSql(queryVector);

    const results = await this.prisma.$queryRaw<
      { title: string; link: string; min_distance: number }[]
    >`
        SELECT 
            d.title,
            d.link,
            MIN(e.vector <=> ${querySql}::vector(768)) AS min_distance 
        FROM "Embedding" e
        INNER JOIN "Document" d ON e.documentId = d.id
        GROUP BY d.id, d.title, d.link
        ORDER BY min_distance ASC
        LIMIT ${limit}
    `;

    return results.map((row) => ({
      title: row.title,
      link: row.link,
      distance: row.min_distance,
    }));
  }
}
