/**
 * CPU nas mesas: o anfitrião completa lugares vazios com bots (id `cpu:N`, ver `isCpuId`).
 * A partida segue igual para quem joga; na Arena ela vira "contra a CPU" (sem ranking, agrado fixo).
 */

/** Pausa antes de cada jogada da CPU: dá tempo de a mesa ver o que aconteceu. */
export const CPU_THINK_MS = 1_100;

/** Id sintético do n-ésimo bot da mesa (nunca colide com um uuid de perfil). */
export function cpuUserId(n: number): string {
  return `cpu:${n}`;
}

/** "CPU 1", "CPU 2"… pela quantidade de bots já sentados. */
export function cpuNickname(botsSeated: number): string {
  return `CPU ${botsSeated + 1}`;
}
