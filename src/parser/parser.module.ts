import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [ConfigModule, PrismaModule, HttpModule],
  providers: [],
  exports: [],
})
export class ParserModule {}
