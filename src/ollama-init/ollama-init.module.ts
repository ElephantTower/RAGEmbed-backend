import { Module } from '@nestjs/common';
import { OllamaInitService } from './ollama-init.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingModule } from 'src/embedding/embedding.module';

@Module({
  imports: [ConfigModule, HttpModule, EmbeddingModule],
  providers: [OllamaInitService],
})
export class OllamaInitModule {}