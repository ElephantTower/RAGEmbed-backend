import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ParserService } from './parser.service';
import { ParseDocsDto } from './dtos/parseDocs.dto';
import { AdminSecretGuard } from './admin-secret.guard';

@Controller('admin')
@UseGuards(AdminSecretGuard)
export class ParserController {
  constructor(private readonly parserService: ParserService) {}

  @Post('parse-docs')
  async parseDocs(
    @Body() dto: ParseDocsDto,
  ): Promise<{ message: string; result?: any }> {
    const {
      delayMs = 1000,
      chunkSize = 1500,
      chunkOverlap = 300,
      batchSize = 16,
      limit = 5,
    } = dto;

    console.log(
      `Starting document parsing with options: delayMs=${delayMs}, chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}, batchSize=${batchSize}, limit=${limit}`,
    );

    try {
      const result = await this.parserService.collectEmbeddings(
        delayMs,
        chunkSize,
        chunkOverlap,
        batchSize,
        limit,
      );
      console.log('Parsing completed:', JSON.stringify(result, null, 2));
      return { message: 'Parsing completed successfully', result };
    } catch (error) {
      console.error('Error during parsing:', error);
      throw error;
    }
  }
}
