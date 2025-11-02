import { Controller, Post, Body, Query, ParseIntPipe } from '@nestjs/common';
import { RAGService } from './rag.service';
import { FindSimilarDto } from './dtos/findSimilar.dto';

@Controller('rag')
export class RAGController {
  constructor(private ragService: RAGService) {}

  @Post('findSimilar')
  async findSimilar(@Body() dto: FindSimilarDto) {
    const { input, model_name, metric, length } = dto;

    const results = await this.ragService.findSimilar(
      input,
      model_name,
      metric,
      length,
    );

    return results;
  }

  @Post('giveAnswer')
  async giveAnswer(@Body() dto: FindSimilarDto) {
    const { input, model_name, metric, length } = dto;

    const result = await this.ragService.giveAnswer(
      input,
      model_name,
      metric,
      length,
    );

    return result;
  }
}
