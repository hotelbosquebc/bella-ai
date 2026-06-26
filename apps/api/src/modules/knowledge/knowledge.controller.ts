import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Query('hotelId') hotelId: string) {
    return this.knowledge.list(hotelId);
  }

  @Post('upload')
  upload(@Body() body: { hotelId: string; title: string; type: string; fileUrl?: string }) {
    return this.knowledge.registerDocument(body.hotelId, body.title, body.type, body.fileUrl);
  }

  @Post('reindex')
  reindex(@Body() body: { hotelId: string }) {
    return this.knowledge.reindex(body.hotelId);
  }

  @Get('search')
  search(@Query('hotelId') hotelId: string, @Query('q') q: string) {
    return this.knowledge.search(hotelId, q);
  }
}
