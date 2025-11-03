import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingRepository } from './embedding.repository';

@Module({
  imports: [PrismaModule],
  providers: [EmbeddingRepository],
  exports: [EmbeddingRepository],
})
export class EmbeddingModule {}
