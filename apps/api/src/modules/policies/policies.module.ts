import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('policies')
export class PoliciesController {
  constructor(
    private readonly policies: PoliciesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query('hotelId') hotelId: string) {
    return this.policies.list(hotelId);
  }

  @Post()
  create(@Body() body: any) {
    return this.policies.createVersion(body);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.prisma.policy.update({ where: { id }, data: { approved: true, active: true } });
  }
}

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
