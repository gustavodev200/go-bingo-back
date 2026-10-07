export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
export type BingoLetter = (typeof BINGO_LETTERS)[number];

export const MAX_NUMBER = 75;
export const FREE_CELL = 0;
/** Grade coluna-major: index = col * 5 + row. Centro = col 2, row 2. */
export const FREE_INDEX = 12;
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

/** Modo de vitória da sala: cartela cheia ou quina (qualquer linha, coluna ou diagonal). */
export const WIN_PATTERNS = ['FULL_CARD', 'LINE'] as const;
export type WinPattern = (typeof WIN_PATTERNS)[number];
export const DEFAULT_WIN_PATTERN: WinPattern = 'FULL_CARD';
/** Pontos de ranking do vencedor logado, por modo (quina é mais fácil, vale menos). */
export const WIN_POINTS: Record<WinPattern, number> = {
  FULL_CARD: 20,
  LINE: 10,
};
export const WIN_PATTERN_LABELS: Record<WinPattern, string> = {
  FULL_CARD: 'Cartela cheia',
  LINE: 'Quina',
};

const range5 = [0, 1, 2, 3, 4];
/** As 12 sequências da quina (índices coluna-major): 5 linhas, 5 colunas e as 2 diagonais. */
export const WIN_LINES: readonly (readonly number[])[] = [
  ...range5.map((row) => range5.map((col) => col * 5 + row)),
  ...range5.map((col) => range5.map((row) => col * 5 + row)),
  range5.map((i) => i * 5 + i),
  range5.map((i) => (4 - i) * 5 + i),
];

/**
 * Menor número de casas que faltam para fechar alguma sequência da quina.
 * `done(index)` diz se a casa já conta; o centro FREE sempre conta (linha dele pede só 4).
 */
export function closestLine(done: (index: number) => boolean): number {
  return Math.min(
    ...WIN_LINES.map(
      (line) => line.filter((i) => i !== FREE_INDEX && !done(i)).length,
    ),
  );
}

export function remainingForFullCard(
  grid: readonly number[],
  drawn: ReadonlySet<number>,
): number {
  return grid.filter((n) => n !== FREE_CELL && !drawn.has(n)).length;
}

/** Números sorteados que ainda faltam para vencer no modo da sala (0 = pode bater bingo). */
export function remainingFor(
  pattern: WinPattern,
  grid: readonly number[],
  drawn: ReadonlySet<number>,
): number {
  return pattern === 'LINE'
    ? closestLine((i) => drawn.has(grid[i]))
    : remainingForFullCard(grid, drawn);
}
