import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { BellaModule } from './modules/bella/bella.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { GuestsModule } from './modules/guests/guests.module';
import { LeadsModule } from './modules/leads/leads.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ChannelsModule,
    BellaModule,
    ReservationsModule,
    ConversationsModule,
    GuestsModule,
    LeadsModule,
    KnowledgeModule,
    PoliciesModule,
    AuditModule,
  ],
})
export class AppModule {}
