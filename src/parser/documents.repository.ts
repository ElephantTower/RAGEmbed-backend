import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Document } from '@prisma/client';

@Injectable()
export class DocumentsRepository {
  constructor(private prisma: PrismaService) {}

  async upsertDocument(title: string, link: string): Promise<Document> {
    return this.prisma.document.upsert({
      where: { link },
      update: { title },
      create: { title, link },
    });
  }

  async addTranslatedTitle(
    documentId: string,
    translatedTitle: string,
  ): Promise<Document> {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { translatedTitle: translatedTitle },
    });
  }

  async findByLink(link: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { link } });
  }
}
