import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `schema` = última migration aplicada no banco (null se o banco não responder): confirma após um deploy que o
   * `prisma migrate deploy` rodou. Falha do banco não derruba o health (o Render reiniciaria o serviço por isso).
   */
  @Get()
  async check(): Promise<{ status: 'ok'; schema: string | null }> {
    try {
      const [latest] = await this.prisma.$queryRaw<
        { migration_name: string }[]
      >`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY migration_name DESC LIMIT 1`;
      return { status: 'ok', schema: latest?.migration_name ?? null };
    } catch {
      return { status: 'ok', schema: null };
    }
  }
}
