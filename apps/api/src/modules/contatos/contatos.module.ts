import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { contatoMarcado, nomeCanonico, telefoneCanonico } from '../../common/contatos-marcados';

const HOTEL = () => process.env.DEFAULT_HOTEL_ID || 'hotel-do-bosque';

/**
 * Guias de grupos e excursoes (pedido do dono, 21/10/2026).
 *
 * Marcados no painel (caixa de entrada) ou na extensao do WhatsApp Web. A
 * Bella nao responde a eles: passa direto para uma pessoa, e o contato
 * aparece com a cor escolhida nos dois lugares.
 */
@Controller('contatos-marcados')
export class ContatosMarcadosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.contatoMarcado.findMany({ where: { hotelId: HOTEL() }, orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() body: { identificador?: string; nome?: string; tipo?: string; cor?: string; observacao?: string }) {
    const identificador = String(body.identificador || '').trim().slice(0, 80) || null;
    const nome = String(body.nome || '').trim().slice(0, 120) || null;
    if (!identificador && !nome) throw new BadRequestException('Informe o número ou o nome do contato.');
    if (identificador && /^[\d\s()+.-]+$/.test(identificador) && telefoneCanonico(identificador).length < 8) {
      throw new BadRequestException('Número de telefone incompleto.');
    }
    const cor = /^#[0-9a-f]{6}$/i.test(body.cor || '') ? String(body.cor) : '#7c3aed';

    // Marcar duas vezes o mesmo contato so atualiza a cor e o nome.
    const existentes = await this.prisma.contatoMarcado.findMany({ where: { hotelId: HOTEL() } });
    const igual = contatoMarcado(existentes, { identificador, nome });
    const data = {
      identificador: identificador ?? igual?.identificador ?? null,
      nome: nome ?? igual?.nome ?? null,
      tipo: String(body.tipo || 'guia').slice(0, 30),
      cor,
      observacao: body.observacao ? String(body.observacao).slice(0, 300) : (igual?.observacao ?? null),
    };
    if (igual) return this.prisma.contatoMarcado.update({ where: { id: igual.id }, data });
    return this.prisma.contatoMarcado.create({ data: { hotelId: HOTEL(), ...data } });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.contatoMarcado.delete({ where: { id } });
  }
}

/** Para o atendimento automatico: o remetente e um contato marcado? */
export async function buscarContatoMarcado(
  prisma: PrismaService,
  hotelId: string,
  quem: { identificador?: string | null; nome?: string | null },
) {
  if (!telefoneCanonico(quem.identificador) && !nomeCanonico(quem.nome)) return null;
  const marcados = await prisma.contatoMarcado.findMany({ where: { hotelId } });
  return contatoMarcado(marcados, quem);
}

@Module({ controllers: [ContatosMarcadosController] })
export class ContatosModule {}
