import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { ParserService } from './parser.service';
import { DocumentsRepository } from './documents.repository';
import { ParserController } from './parser.controller';
import { AdminSecretGuard } from './admin-secret.guard';
import { OllamaModule } from 'src/ollama/ollama.module';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule, OllamaModule],
  providers: [ParserService, DocumentsRepository, AdminSecretGuard],
  controllers: [ParserController],
  exports: [ParserService],
})
export class ParserModule {}
