/**
 * Semana do ranking: segunda-feira 00:00 até domingo 23:59 no fuso de São Paulo
 * (UTC−3 o ano todo desde 2019, sem horário de verão).
 */
const SP_OFFSET = '-03:00';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante em que começa a semana (segunda 00:00 em São Paulo) que contém `now`. */
export function weekStart(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(now);
  const today = new Date(`${ymd}T00:00:00${SP_OFFSET}`);
  // getUTCDay do "meio-dia" do dia local: 0 = domingo.
  const weekday = new Date(`${ymd}T12:00:00${SP_OFFSET}`).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return new Date(today.getTime() - sinceMonday * DAY_MS);
}

export function addWeeks(start: Date, weeks: number): Date {
  return new Date(start.getTime() + weeks * 7 * DAY_MS);
}

/** Chave DATE (meia-noite UTC) da segunda-feira, para SeasonPayout.weekStart. */
export function weekKey(start: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(start);
  return new Date(`${ymd}T00:00:00.000Z`);
}
