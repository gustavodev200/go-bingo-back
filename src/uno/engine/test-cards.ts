// coverage: justificativa — helper de teste (notação curta de cartas), sem lógica de produção.
/* istanbul ignore file */
import type { UnoCard, UnoColor, UnoValue } from '../../contracts';

const COLORS: Record<string, UnoColor | 'wild'> = {
  r: 'red',
  y: 'yellow',
  g: 'green',
  b: 'blue',
  w: 'wild',
};
const VALUES: Record<string, UnoValue> = {
  S: 'skip',
  R: 'reverse',
  '+2': 'draw2',
};

/** Test shorthand: 'r5', 'gS' (skip), 'bR' (reverse), 'y+2', 'w' (wild), 'w+4'. */
export function card(code: string): UnoCard {
  const color = COLORS[code[0]];
  const rest = code.slice(1);
  if (color === 'wild')
    return { color, value: rest === '+4' ? 'wild4' : 'wild' };
  return { color, value: VALUES[rest] ?? (rest as UnoValue) };
}

export const cards = (...codes: string[]) => codes.map(card);
