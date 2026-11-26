import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registerToken(userId: string, token: string, platform: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastUsedAt: new Date() },
    });
  }

  async removeToken(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
    return { removed: true };
  }

  /**
   * Pošle push notifikáciu všetkým zariadeniam daných používateľov.
   * Chyby sa logujú, ale nikdy nezhodia hlavnú operáciu (správa/nominácia
   * sa uloží aj keď push zlyhá). Neplatné tokeny sa automaticky odstránia.
   */
  async notifyUsers(userIds: string[], message: PushMessage): Promise<{ sent: number }> {
    if (userIds.length === 0) return { sent: 0 };
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds } },
    });
    if (tokens.length === 0) return { sent: 0 };

    let sent = 0;
    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
      const chunk = tokens.slice(i, i + CHUNK_SIZE);
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            chunk.map((t) => ({
              to: t.token,
              title: message.title,
              body: message.body,
              data: message.data,
              sound: 'default',
            })),
          ),
        });
        const result = (await response.json()) as {
          data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
        };
        const tickets = result.data ?? [];
        for (const [index, ticket] of tickets.entries()) {
          if (ticket.status === 'ok') {
            sent++;
          } else {
            // chyba odoslania (napr. InvalidCredentials = chýba FCM/APNs kľúč, MessageRateExceeded…)
            this.logger.warn(`Expo push odmietnutý (${chunk[index]!.platform}): ${ticket.details?.error ?? ticket.status} — ${ticket.message ?? ''}`);
            if (ticket.details?.error === 'DeviceNotRegistered') await this.removeToken(chunk[index]!.token);
          }
        }
      } catch (error) {
        this.logger.warn(`Expo push zlyhal: ${error instanceof Error ? error.message : error}`);
      }
    }
    return { sent };
  }
}
