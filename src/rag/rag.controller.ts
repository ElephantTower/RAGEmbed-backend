import {
  Controller,
  Post,
  Body,
  Query,
  ParseIntPipe,
  Res,
  UseGuards,
  Get,
} from '@nestjs/common';
import { Response } from 'express';
import { RAGService } from './rag.service';
import { FindSimilarDto } from './dtos/findSimilar.dto';
import { SendMessageDto } from './dtos/sendMessage.dto';
import { ChatGuard } from './chat.guard';
import { Chat } from './decorators/chat.decorator';
import { Chat as PrismaChat } from '@prisma/client';
import { ChatService } from './chat.service';

@Controller('rag')
export class RAGController {
  constructor(
    private ragService: RAGService,
    private chatService: ChatService,
  ) {}

  @Post('findSimilar')
  async findSimilar(@Body() dto: FindSimilarDto) {
    const { input, metric, length } = dto;

    const results = await this.ragService.findSimilar(input, metric, length);

    return results;
  }

  @UseGuards(ChatGuard)
  @Post('sendMessage')
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Res() res: Response,
    @Chat() chat: PrismaChat,
  ) {
    const { input, metric, topChunks, topDocuments, stream } = dto;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      await this.ragService.processUserMessageStream(
        chat,
        input,
        res,
        metric,
        topChunks,
        topDocuments,
      );

      return;
    }

    const results = await this.ragService.processUserMessage(
      chat,
      input,
      metric,
      topChunks,
      topDocuments,
    );

    return res.json(results);
  }

  @UseGuards(ChatGuard)
  @Get('getHistory')
  async getHistory(@Chat() chat: PrismaChat) {
    return this.chatService.getMessages(chat);
  }
}
