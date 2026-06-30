import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Query('hotelId') hotelId: string) {
    return this.knowledge.list(hotelId);
  }

  @Post('upload')
  upload(@Body() body: { hotelId: string; title: string; type: string; fileUrl?: string; content?: string }) {
    return this.knowledge.registerDocument(body.hotelId, body.title, body.type, body.fileUrl, body.content);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; content?: string; active?: boolean }) {
    return this.knowledge.updateDocument(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledge.deleteDocument(id);
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
