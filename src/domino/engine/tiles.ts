import { DOMINO_MAX_PIP, type DominoTile } from '../../contracts';

/** The 28 tiles of the double-six set, each once, with `a <= b`. */
export function newDominoSet(): DominoTile[] {
  const out: DominoTile[] = [];
  for (let a = 0; a <= DOMINO_MAX_PIP; a++)
    for (let b = a; b <= DOMINO_MAX_PIP; b++) out.push({ a, b });
  return out;
}

export const hasPip = (tile: DominoTile, pip: number) =>
  tile.a === pip || tile.b === pip;
