import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { OllamaService } from './ollama.service';
import { EmbeddingRepository } from './embedding.repository';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule],
  providers: [OllamaService, EmbeddingRepository],
  exports: [OllamaService, EmbeddingRepository],
})
export class EmbeddingModule {}
