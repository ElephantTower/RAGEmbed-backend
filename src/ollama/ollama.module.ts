import { Module } from '@nestjs/common';
import { OllamaInitService } from './ollama-init.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { OllamaService } from './ollama.service';
import { EmbeddingModule } from 'src/embedding/embedding.module';

@Module({
  imports: [ConfigModule, HttpModule, EmbeddingModule],
  providers: [OllamaInitService, OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
