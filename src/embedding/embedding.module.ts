import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { OllamaService } from './ollama.service';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule],
  providers: [OllamaService],
  exports: [OllamaService],
})
export class EmbeddingModule {}