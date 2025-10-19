import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingModule } from '../embedding/embedding.module';

import { RAGService } from './rag.service';
import { RAGController } from './rag.controller';

@Module({
  imports: [ConfigModule, PrismaModule, EmbeddingModule],
  providers: [RAGService],
  controllers: [RAGController],
  exports: [RAGService],
})
export class RAGModule {}