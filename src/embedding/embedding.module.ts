import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { ModelsService } from './models.service';
import { EmbeddingRepository } from './embedding.repository';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule],
  providers: [ModelsService, EmbeddingRepository],
  exports: [ModelsService, EmbeddingRepository],
})
export class EmbeddingModule {}
