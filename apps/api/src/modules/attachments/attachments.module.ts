import { Body, Controller, Delete, Get, Module, Param, Post, Query, Res, NotFoundException } from '@nestjs/common';
/** Tipo mínimo do response do Express — evita depender de @types/express. */
type HttpResponse = {
  setHeader(nome: string, valor: string): void;
  end(corpo: Buffer): void;
};
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

/**
 * Anexos da Bella: arquivos prontos que acompanham a sugestão (folha de regras
 * de pets, catálogo de ingressos). Ficam em base64 no banco — custo ZERO, sem
 * storage contratado, e são poucos arquivos que quase não mudam.
 *
 * O envio ao hóspede continua manual: a Bella só deixa o arquivo pronto.
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista SEM o conteúdo — `data` tem megabytes e travaria o painel. */
  @Get()
  async list(@Query('hotelId') hotelId?: string) {
    const id = hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    const linhas = await this.prisma.attachment.findMany({
      where: { hotelId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true, mimeType: true, keywords: true, active: true, createdAt: true },
    });
    return linhas;
  }

  @Post()
  async create(
    @Body() body: { hotelId?: string; title: string; mimeType: string; data: string; keywords?: string },
  ) {
    const hotelId = body.hotelId || process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';
    // Aceita tanto data URL ("data:image/png;base64,AAA") quanto base64 puro.
    const data = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
    const criado = await this.prisma.attachment.create({
      data: {
        hotelId,
        title: body.title,
        mimeType: body.mimeType,
        data,
        keywords: normalizar(body.keywords ?? ''),
      },
      select: { id: true, title: true, mimeType: true, keywords: true, active: true },
    });
    return criado;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.attachment.delete({ where: { id }, select: { id: true } });
  }

  /**
   * Serve o arquivo em si. Público porque é conteúdo que já vai ser enviado ao
   * hóspede (regras de pets, catálogo) e o id é um UUID não adivinhável — assim
   * a extensão pode baixá-lo direto, sem embutir token no download.
   */
  @Public()
  @Get(':id/file')
  async file(@Param('id') id: string, @Res() res: HttpResponse) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Anexo não encontrado');
    const buf = Buffer.from(a.data, 'base64');
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buf);
  }
}

/** minúsculas e sem acento, para casar com o texto da conversa */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

@Module({ controllers: [AttachmentsController] })
export class AttachmentsModule {}
