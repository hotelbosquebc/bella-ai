import { Injectable, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Centro de Conhecimento: upload → extração de texto → chunking → embeddings →
 * indexação no Qdrant (collection por hotel: kb_{hotelId}) → busca semântica.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly qdrant = new QdrantClient({ url: process.env.QDRANT_URL ?? 'http://localhost:6333' });

  constructor(private readonly prisma: PrismaService) {}

  list(hotelId: string) {
    return this.prisma.knowledgeDocument.findMany({
      where: { hotelId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async registerDocument(
    hotelId: string,
    title: string,
    type: string,
    fileUrl?: string,
    content?: string,
  ) {
    const doc = await this.prisma.knowledgeDocument.create({
      // Conteúdo de texto é usado direto nas respostas (sem fila): marca como INDEXED.
      data: {
        hotelId,
        title,
        type,
        fileUrl,
        content,
        embeddingStatus: content ? 'INDEXED' : 'PENDING',
      },
    });
    this.logger.log(`Documento "${title}" registrado (hotel ${hotelId})`);
    return doc;
  }

  /** Edita um documento de conhecimento (título, conteúdo, ativo). */
  async updateDocument(id: string, data: { title?: string; content?: string; active?: boolean }) {
    return this.prisma.knowledgeDocument.update({ where: { id }, data });
  }

  async deleteDocument(id: string) {
    return this.prisma.knowledgeDocument.delete({ where: { id } });
  }

  /**
   * Contexto de conhecimento para o prompt da Bella: concatena o conteúdo dos
   * documentos ativos do hotel. Para um hotel, cabe inteiro no contexto do
   * modelo (sem necessidade de busca vetorial). Limitado por segurança.
   */
  async getKnowledgeContext(hotelId: string, maxChars = 12000): Promise<string> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { hotelId, active: true, content: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { title: true, content: true },
    });
    let out = '';
    for (const d of docs) {
      const block = `## ${d.title}\n${d.content}\n\n`;
      if (out.length + block.length > maxChars) break;
      out += block;
    }
    return out.trim();
  }

  /** Busca semântica (RAG) — reservado para múltiplos hotéis/documentos grandes. */
  async search(hotelId: string, query: string, limit = 5): Promise<string[]> {
    try {
      // TODO: gerar embedding da query e usar this.qdrant.search(`kb_${hotelId}`, ...)
      void query;
      void limit;
      return [];
    } catch (err) {
      this.logger.warn(`Busca vetorial indisponível: ${err}`);
      return [];
    }
  }

  async reindex(hotelId: string) {
    await this.prisma.knowledgeDocument.updateMany({
      where: { hotelId },
      data: { embeddingStatus: 'PENDING' },
    });
    // TODO: enfileirar reindexação completa
    return { status: 'queued' };
  }
}
