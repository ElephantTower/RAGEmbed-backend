import { Controller, Post, Body, Query, ParseIntPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { RAGService } from './rag.service';
import { FindSimilarDto } from './dtos/findSimilar.dto';
import { SendMessageDto } from './dtos/sendMessage.dto';

@Controller('rag')
export class RAGController {
  constructor(private ragService: RAGService) {}

  @Post('findSimilar')
  async findSimilar(@Body() dto: FindSimilarDto) {
    const { input, metric, length } = dto;

    const results = await this.ragService.findSimilar(
      input,
      metric,
      length,
    );

    return results;
  }

  @Post('sendMessage')
  async sendMessage(@Body() dto: SendMessageDto, @Res() res: Response) {
    const { input, metric, topChunks, topDocuments, stream } = dto;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      await this.ragService.processUserMessageStream(
        input, 
        res,
        metric,
        topChunks,
        topDocuments,
      );

      return;
    }

    const results = await this.ragService.processUserMessage(
      input,
      metric,
      topChunks,
      topDocuments
    );

    return results;
  }
}
