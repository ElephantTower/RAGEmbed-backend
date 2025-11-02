import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { OllamaService } from '../ollama/ollama.service';
import { EmbeddingRepository } from './embedding.repository';
import { OllamaModule } from 'src/ollama/ollama.module';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule, OllamaModule],
  providers: [EmbeddingRepository],
  exports: [EmbeddingRepository],
})
export class EmbeddingModule {}
