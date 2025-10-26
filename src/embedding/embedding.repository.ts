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

    const results = await this.prisma.$queryRaw<
      { title: string; link: string; distance: number }[]
    >`
      SELECT 
        d.title,
        d.link,
        e.vector ${distanceOp} ${querySql}::vector(768) AS distance
      FROM "Embedding" e
      INNER JOIN "Document" d ON e.documentId = d.id
      WHERE e.modelId = ${modelId}
      ORDER BY distance ASC
      LIMIT ${limit}
    `;

    return results.map((row) => ({
      title: row.title,
      link: row.link,
      distance: row.distance,
    }));
  }

  async getModelId(nameInOllama: string): Promise<string> {
    let model = await this.prisma.model.findUnique({
      where: { nameInOllama },
    });

    if (!model) {
      model = await this.prisma.model.create({
        data: { nameInOllama },
      });
    }

    return model.id;
  }
}
