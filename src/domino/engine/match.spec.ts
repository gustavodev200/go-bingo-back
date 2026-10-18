import {
  DEFAULT_DOMINO_RULES,
  type DominoRules,
  type DominoTile,
} from '../../contracts';
import { DominoMatch, type Announcement } from './match';
import { newDominoSet } from './tiles';

const tile = (s: string): DominoTile => ({ a: Number(s[0]), b: Number(s[1]) });
const key = (t: DominoTile) => `${Math.min(t.a, t.b)}${Math.max(t.a, t.b)}`;

/** The full set with the given hands first (seat order) and the rest, in set order, as the boneyard. */
function arranged(hands: string[][]): () => DominoTile[] {
  const used = new Set(hands.flat());
  const rest = newDominoSet().filter((t) => !used.has(key(t)));
  return () => [...hands.flat().map(tile), ...rest];
}

/** Exactly these tiles (no boneyard when every seat gets 7). */
const exact = (hands: string[][]) => () => hands.flat().map(tile);

const noRandom = (min: number) => min;

function match(
  seats: number[],
  tiles: () => DominoTile[],
  rules: Partial<DominoRules> = {},
) {
  const m = new DominoMatch(
    noRandom,
    seats,
    { ...DEFAULT_DOMINO_RULES, ...rules },
    { tiles },
  );
  m.startRound();
  return m;
}

const idOf = (m: DominoMatch, seat: number, s: string) =>
  m.privateView(seat)!.tiles.find((t) => key(t.tile) === s)!.id;

const play = (
  m: DominoMatch,
  seat: number,
  s: string,
  side?: 'left' | 'right',
) => m.play(seat, idOf(m, seat, s), side);

const events = (out: Announcement[]) => out.map((a) => a.event);

const TWO = [
  ['06', '36', '01', '02', '03', '11', '12'],
  ['66', '13', '14', '15', '16', '22', '23'],
];

describe('DominoMatch', () => {
  it('needs 2 players, and exactly 4 for teams', () => {
    expect(() => new DominoMatch(noRandom, [0], DEFAULT_DOMINO_RULES)).toThrow(
      'pelo menos 2',
    );
    expect(
      () => new DominoMatch(noRandom, [0, 1, 2], { target: 0, teams: true }),
    ).toThrow('4 jogadores');
  });

  it('deals 7 tiles each, keeps the rest as the boneyard and opens with the highest double', () => {
    const m = match([0, 1], arranged(TWO));
    const view = m.publicView();
    expect(view.handCounts.slice(0, 2)).toEqual([7, 7]);
    expect(view.boneyard).toBe(14);
    expect(view.ends).toBeNull();
    expect(m.turn).toBe(1);
    expect(m.privateView(1)!.playable).toEqual([
      { id: idOf(m, 1, '66'), sides: ['right'] },
    ]);
    expect(m.privateView(0)!.playable).toEqual([]);
    expect(() => play(m, 1, '13')).toThrow('maior carroça');
    expect(() => play(m, 0, '06')).toThrow('Não é a sua vez');
  });

  it('opens with the heaviest tile when nobody holds a double', () => {
    const m = match(
      [0, 1],
      arranged([
        ['01', '02', '03', '04', '05', '06', '12'],
        ['13', '14', '15', '16', '23', '24', '56'],
      ]),
    );
    expect(m.turn).toBe(1);
    expect(m.privateView(1)!.playable.map((p) => p.id)).toEqual([
      idOf(m, 1, '56'),
    ]);
  });

  it('places tiles on either end, oriented along the line', () => {
    const m = match([0, 1], arranged(TWO));
    const out = play(m, 1, '66');
    expect(out[0]).toEqual({
      event: 'domino:tile_played',
      payload: { seat: 1, tile: { a: 6, b: 6 }, side: 'right', tilesLeft: 6 },
    });
    // Same number on both ends: the shorter arm grows (right on a tie).
    play(m, 0, '06');
    expect(m.publicView().ends).toEqual([6, 0]);
    play(m, 1, '16');
    let view = m.publicView();
    expect(view.line.map((p) => `${p.a}${p.b}`)).toEqual(['16', '66', '60']);
    expect(view.origin).toBe(1);
    expect(view.ends).toEqual([1, 0]);

    expect(() => play(m, 0, '01')).toThrow('Escolha em qual ponta');
    expect(() => play(m, 0, '36')).toThrow('não encaixa');
    expect(() => play(m, 0, '02', 'left')).toThrow('não encaixa aí');
    expect(() => m.play(0, 'nope')).toThrow('não está na sua mão');
    expect(m.privateView(0)!.playable).toContainEqual({
      id: idOf(m, 0, '01'),
      sides: ['left', 'right'],
    });
    play(m, 0, '01', 'left');
    view = m.publicView();
    expect(view.line[0]).toEqual({ a: 0, b: 1, seat: 0 });
    expect(view.ends).toEqual([0, 0]);
    expect(view.origin).toBe(2);
  });

  it('buys from the boneyard until a tile fits and keeps the turn', () => {
    const m = match(
      [0, 1],
      arranged([
        ['01', '02', '03', '11', '12', '13', '14'],
        ['66', '15', '16', '22', '23', '24', '25'],
      ]),
    );
    play(m, 1, '66');
    expect(m.privateView(0)!.mustDraw).toBe(true);
    const token = m.turnToken;
    expect(m.draw(0)).toEqual([
      { event: 'domino:tiles_drawn', payload: { seat: 0, count: 4 } },
    ]);
    expect(m.turn).toBe(0);
    expect(m.turnToken).not.toBe(token);
    expect(m.privateView(0)!.mustDraw).toBe(false);
    expect(m.publicView().boneyard).toBe(10);
    expect(() => m.draw(0)).toThrow('jogue');
  });

  it('passes whoever cannot play when the boneyard is empty', () => {
    const m = match(
      [0, 1, 2, 3],
      arranged([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
        ['06', '16', '26', '24', '25', '33', '34'],
        ['36', '46', '56', '35', '44', '45', '55'],
      ]),
    );
    expect(m.publicView().boneyard).toBe(0);
    const out = play(m, 0, '66');
    expect(events(out)).toEqual(['domino:tile_played', 'domino:turn_passed']);
    expect(out[1].payload).toEqual({ seat: 1 });
    expect(m.turn).toBe(2);
    expect(() => m.draw(1)).toThrow('Não é a sua vez');
  });

  it('buying the last tiles without a fit passes the turn', () => {
    const m = match(
      [0, 1],
      exact([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
        ['16', '33'],
      ]),
    );
    play(m, 0, '66');
    // Seat 1 has no 6: it buys 1|6, which fits, and keeps the turn.
    expect(m.draw(1)).toEqual([
      { event: 'domino:tiles_drawn', payload: { seat: 1, count: 1 } },
    ]);
    play(m, 1, '16');
    // Seat 0 answers with 0|1; seat 1 buys the last tile (3|3), still no fit, and passes.
    play(m, 0, '01');
    const out = m.draw(1);
    expect(events(out)).toContain('domino:turn_passed');
    expect(m.publicView().boneyard).toBe(0);
  });

  it('a blocked game is won by the lowest hand, which scores the others', () => {
    const m = match(
      [0, 1],
      exact([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
      ]),
    );
    const out = play(m, 0, '66');
    expect(out[1]).toEqual({
      event: 'domino:round_ended',
      payload: {
        winners: [0],
        points: 29,
        blocked: true,
        pips: [15, 29, 0, 0],
        scores: [29, 0, 0, 0],
      },
    });
    expect(m.phase).toBe('MATCH_OVER');
    expect(m.winners).toEqual([0]);
    expect(() => m.startRound()).toThrow('já terminou');
  });

  it('a blocked game with equal hands is a tie', () => {
    const m = match(
      [0, 1],
      exact([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '01', '02', '04', '03', '00'],
      ]),
    );
    play(m, 0, '66');
    expect(m.publicView().lastRound).toEqual({
      winners: [],
      points: 0,
      blocked: true,
      pips: [15, 15, 0, 0],
    });
    expect(m.winners).toEqual([]);
  });

  it('whoever plays the last tile wins the round', () => {
    const m = match(
      [0, 1],
      exact([
        ['66', '56', '45', '34', '23', '12', '01'],
        ['00', '00', '00', '00', '00', '00', '00'],
      ]),
    );
    for (const s of ['66', '56', '45', '34', '23', '12']) {
      const out = play(m, 0, s);
      if (s !== '66') expect(events(out)).toContain('domino:turn_passed');
    }
    const out = play(m, 0, '01');
    expect(out[1]).toMatchObject({
      event: 'domino:round_ended',
      payload: { winners: [0], blocked: false, points: 0 },
    });
  });

  it('2 against 2: partners win together and both get the points', () => {
    const m = match(
      [0, 1, 2, 3],
      exact([
        ['66', '00', '00', '00', '00', '00', '01'],
        ['11', '11', '11', '11', '11', '11', '11'],
        ['00', '00', '00', '00', '00', '00', '02'],
        ['22', '22', '22', '22', '22', '22', '22'],
      ]),
      { teams: true },
    );
    play(m, 0, '66');
    expect(m.publicView().lastRound).toMatchObject({
      winners: [0, 2],
      points: 42,
    });
    expect(m.scores).toEqual([42, 0, 42, 0]);
  });

  it('plays rounds up to the target and the last winner opens the next one', () => {
    const m = match(
      [0, 1],
      exact([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
      ]),
      { target: 50 },
    );
    play(m, 0, '66');
    expect(m.phase).toBe('ROUND_OVER');
    expect(m.publicView().phase).toBe('ROUND_OVER');
    expect(() => m.draw(0)).toThrow('indisponível');
    expect(m.startRound()).toEqual([
      {
        event: 'domino:round_started',
        payload: { roundNumber: 2, starter: 0 },
      },
    ]);
    expect(() => m.startRound()).toThrow('em andamento');
    // Free opening: any tile.
    expect(m.privateView(0)!.playable).toHaveLength(7);
    play(m, 0, '66');
    expect(m.phase).toBe('MATCH_OVER');
    expect(m.winners).toEqual([0]);
    expect(m.scores[0]).toBe(58);
  });

  it('a timed out turn buys and plays the heaviest tile that fits', () => {
    const m = match(
      [0, 1],
      arranged([
        ['01', '02', '03', '11', '12', '13', '14'],
        ['66', '15', '16', '22', '23', '24', '25'],
      ]),
    );
    expect(events(m.timeout())).toEqual([
      'domino:turn_timed_out',
      'domino:tile_played',
    ]);
    const out = m.timeout();
    expect(events(out)).toEqual([
      'domino:turn_timed_out',
      'domino:tiles_drawn',
      'domino:tile_played',
    ]);
    expect(m.turn).toBe(1);
    expect(m.publicView().ends).toEqual([0, 6]);
  });

  it('a timed out turn with nothing to play passes', () => {
    const m = match(
      [0, 1, 2, 3],
      arranged([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
        ['06', '16', '26', '24', '25', '33', '34'],
        ['36', '46', '56', '35', '44', '45', '55'],
      ]),
    );
    play(m, 0, '66'); // seat 1 passes, seat 2's turn
    play(m, 2, '26', 'right'); // ends 6|2; seat 3 plays
    expect(m.turn).toBe(3);
    expect(events(m.timeout())).toEqual([
      'domino:turn_timed_out',
      'domino:tile_played',
    ]);
  });

  it('a player leaving gives their tiles to the boneyard and the turn moves on', () => {
    const m = match(
      [0, 1, 3],
      arranged([
        ['01', '02', '03', '04', '05', '11', '12'],
        ['66', '13', '14', '15', '16', '22', '23'],
        ['24', '25', '26', '33', '34', '35', '36'],
      ]),
    );
    expect(m.turn).toBe(1);
    expect(m.removePlayer(1)).toEqual([]);
    expect(m.turn).toBe(3);
    expect(m.publicView().boneyard).toBe(14);
    expect(m.privateView(1)).toBeNull();
    // 6|6 left with seat 1: the opening is free now.
    expect(m.privateView(3)!.playable).toHaveLength(7);
    expect(m.removePlayer(1)).toEqual([]);
    m.removePlayer(0);
    expect(m.phase).toBe('MATCH_OVER');
    expect(m.winners).toEqual([3]);
  });

  it('in 2 against 2 a player leaving hands the match to the other team', () => {
    const m = match(
      [0, 1, 2, 3],
      arranged([
        ['66', '00', '01', '02', '03', '04', '05'],
        ['11', '12', '13', '14', '15', '22', '23'],
        ['06', '16', '26', '24', '25', '33', '34'],
        ['36', '46', '56', '35', '44', '45', '55'],
      ]),
      { teams: true },
    );
    m.removePlayer(2);
    expect(m.phase).toBe('MATCH_OVER');
    expect(m.winners).toEqual([1, 3]);
  });
});
