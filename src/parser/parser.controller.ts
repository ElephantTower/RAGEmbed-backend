import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ParserService } from './parser.service';
import { ParseDocsDto } from './dtos/parseDocs.dto';
import { AdminSecretGuard } from './admin-secret.guard';

@Controller('admin')
@UseGuards(AdminSecretGuard)
export class ParserController {
  private readonly logger = new Logger(ParserService.name);
  constructor(private readonly parserService: ParserService) {}

  @Post('parse-docs')
  async parseDocs(
    @Body() dto: ParseDocsDto,
  ): Promise<{ message: string; result?: any }> {
    const {
      delayMs = 1000,
      chunkSize = 500,
      chunkOverlap = 100,
      batchSize = 16,
      limit = 5,
    } = dto;

    this.logger.log(
      `Starting document parsing with options: delayMs=${delayMs}, chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}, batchSize=${batchSize}, limit=${limit}`,
    );

    try {
      this.parserService.collectEmbeddings(
        delayMs,
        chunkSize,
        chunkOverlap,
        batchSize,
        limit,
      );
      return { message: 'Parsing started' };
    } catch (error) {
      this.logger.error('Error during parsing:', error);
      throw error;
    }
  }
}
