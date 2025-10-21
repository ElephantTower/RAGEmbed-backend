import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { EmbeddingModule } from 'src/embedding/embedding.module';
import { ParserService } from './parser.service';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule, EmbeddingModule],
  providers: [ParserService],
  controllers: [],
  exports: [],
})
export class ParserModule {}
