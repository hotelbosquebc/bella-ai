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

  async registerDocument(hotelId: string, title: string, type: string, fileUrl?: string) {
    const doc = await this.prisma.knowledgeDocument.create({
      data: { hotelId, title, type, fileUrl },
    });
    // TODO: enfileirar processamento (RabbitMQ): extração → chunking → embeddings → upsert
    this.logger.log(`Documento "${title}" registrado para indexação (hotel ${hotelId})`);
    return doc;
  }

  /** Busca semântica na base vetorial do hotel; retorna trechos para o prompt */
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
