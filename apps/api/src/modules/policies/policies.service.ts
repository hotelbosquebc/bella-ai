import { Injectable } from '@nestjs/common';
import { Policy, PolicyCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Palavras-chave → categoria de política, para seleção do contexto da Bella */
const CATEGORY_KEYWORDS: [RegExp, PolicyCategory][] = [
  [/cancel/i, 'CANCELLATION'],
  [/(reembolso|estorno|devolu)/i, 'REFUND'],
  [/no-?show/i, 'NO_SHOW'],
  [/(pet|cachorro|gato|animal)/i, 'PETS'],
  [/(crian[çc]a|beb[êe]|filho|menor)/i, 'CHILDREN'],
  [/(grupo|excurs[ãa]o|caravana)/i, 'GROUPS'],
  [/(pagamento|pix|cart[ãa]o|parcel)/i, 'PAYMENT'],
  [/check.?in|entrada/i, 'CHECK_IN'],
  [/check.?out|sa[íi]da/i, 'CHECK_OUT'],
  [/(alterar|mudar|remarcar|reagendar)/i, 'CHANGES'],
];

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toda resposta da Bella consulta a base oficial de políticas.
   *
   * Políticas são versionadas e as versões antigas continuam `active/approved`.
   * Sem filtrar, o prompt receberia TODAS as versões da mesma categoria de uma
   * vez — a regra nova e a antiga juntas, se contradizendo. Fica só a de maior
   * versão por categoria.
   */
  async findRelevant(hotelId: string, messageText: string): Promise<Policy[]> {
    const categories = CATEGORY_KEYWORDS.filter(([re]) => re.test(messageText)).map(([, cat]) => cat);
    if (categories.length === 0) return [];
    const todas = await this.prisma.policy.findMany({
      where: { hotelId, active: true, approved: true, category: { in: categories } },
      orderBy: { version: 'desc' },
    });
    const maisRecentePorCategoria = new Map<string, Policy>();
    for (const p of todas) {
      const atual = maisRecentePorCategoria.get(p.category);
      if (!atual || p.version > atual.version) maisRecentePorCategoria.set(p.category, p);
    }
    return [...maisRecentePorCategoria.values()];
  }

  list(hotelId: string) {
    return this.prisma.policy.findMany({ where: { hotelId }, orderBy: [{ category: 'asc' }, { version: 'desc' }] });
  }

  /** Nova versão de política (versionamento: nunca sobrescreve) */
  async createVersion(data: {
    hotelId: string;
    category: PolicyCategory;
    title: string;
    content: string;
    authorId?: string;
  }) {
    const latest = await this.prisma.policy.findFirst({
      where: { hotelId: data.hotelId, category: data.category, title: data.title },
      orderBy: { version: 'desc' },
    });
    return this.prisma.policy.create({
      data: { ...data, version: (latest?.version ?? 0) + 1, approved: false },
    });
  }
}
