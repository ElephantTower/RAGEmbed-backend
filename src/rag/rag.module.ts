import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { JwtModule } from '@nestjs/jwt';
import { RAGService } from './rag.service';
import { RAGController } from './rag.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    EmbeddingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [RAGService, ChatService],
  controllers: [RAGController],
  exports: [RAGService],
})
export class RAGModule {}
