export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
export type BingoLetter = (typeof BINGO_LETTERS)[number];

export const MAX_NUMBER = 75;
export const FREE_CELL = 0;
/** Grade coluna-major: index = col * 5 + row. Centro = col 2, row 2. */
export const FREE_INDEX = 12;
export const WIN_POINTS = 20;
export const MAX_CARD_REGENS = 5;
export const RECONNECT_GRACE_MS = 60_000;
/** Padrão do intervalo entre bolas; o servidor pode mudar via env DEFAULT_DRAW_INTERVAL_MS e o host ao criar a sala. */
export const DEFAULT_DRAW_INTERVAL_MS = 8_000;
export const MIN_DRAW_INTERVAL_MS = 4_000;
export const MAX_DRAW_INTERVAL_MS = 20_000;

export function letterFor(n: number): BingoLetter {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER)
    throw new RangeError(`Número fora de 1–75: ${n}`);
  return BINGO_LETTERS[Math.floor((n - 1) / 15)];
}

export function columnRange(col: number): [number, number] {
  return [col * 15 + 1, col * 15 + 15];
}

export function remainingForFullCard(
  grid: readonly number[],
  drawn: ReadonlySet<number>,
): number {
  return grid.filter((n) => n !== FREE_CELL && !drawn.has(n)).length;
}
