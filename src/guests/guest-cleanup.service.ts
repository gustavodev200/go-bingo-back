import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../core/prisma.service';

export const GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class GuestCleanupService {
  private readonly logger = new Logger(GuestCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async run(): Promise<void> {
    try {
      const result = await this.cleanup();
      this.logger.log({ event: 'guest_cleanup', ...result });
    } catch (error) {
      this.logger.error(error);
    }
  }

  async cleanup(
    now: Date = new Date(),
  ): Promise<{ authUsers: number; profiles: number }> {
    const cutoff = new Date(now.getTime() - GUEST_TTL_MS);
    const [{ exists }] = await this.prisma.$queryRaw<
      { exists: boolean }[]
    >`SELECT to_regclass('auth.users') IS NOT NULL AS exists`;
    if (!exists) return { authUsers: 0, profiles: 0 };

    // Convidado só sai se nem entrou nem renovou sessão nos últimos 30 dias.
    const authUsers = await this.prisma.$executeRaw`
      DELETE FROM auth.users u
      WHERE u.is_anonymous = true
        AND COALESCE(u.last_sign_in_at, u.created_at) < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM auth.sessions s
          WHERE s.user_id = u.id AND COALESCE(s.refreshed_at, s.updated_at, s.created_at) >= ${cutoff}
        )`;
    // Perfis de convidado cujo usuário não existe mais (RoomMember cai em cascata).
    const profiles = await this.prisma.$executeRaw`
      DELETE FROM "Profile" p
      WHERE p."isGuest" = true AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)`;
    return { authUsers, profiles };
  }
}
