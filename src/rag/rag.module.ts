import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingModule } from '../embedding/embedding.module';

import { RAGService } from './rag.service';
import { RAGController } from './rag.controller';
import { OllamaModule } from 'src/ollama/ollama.module';

@Module({
  imports: [ConfigModule, PrismaModule, OllamaModule, EmbeddingModule],
  providers: [RAGService],
  controllers: [RAGController],
  exports: [RAGService],
})
export class RAGModule {}
