import {
  DAMAS_DRAW_MOVES,
  DAMAS_INITIAL_BOARD,
  DAMAS_MAX_TIMEOUTS,
  damasSquare as sq,
  isDarkSquare,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { DamasMatch } from './match';
import { BLACK, boardFromString, legalMoves, WHITE } from './rules';

/** Builds a board from pieces placed by [row, col]. */
function board(pieces: Record<string, [number, number][]>): string {
  const cells = Array<string>(64).fill('.');
  for (const [cell, list] of Object.entries(pieces))
    for (const [r, c] of list) cells[sq(r, c)] = cell;
  return cells.join('');
}

const first = () => 0;

describe('damas rules', () => {
  it('sets 12 pieces per side on the dark squares, dark corner at the bottom left', () => {
    expect(DAMAS_INITIAL_BOARD.match(/w/g)).toHaveLength(12);
    expect(DAMAS_INITIAL_BOARD.match(/b/g)).toHaveLength(12);
    expect(isDarkSquare(sq(7, 0))).toBe(true);
    for (let i = 0; i < 64; i++)
      if (DAMAS_INITIAL_BOARD[i] !== '.') expect(isDarkSquare(i)).toBe(true);
  });

  it('gives white 7 opening moves, all one square forward', () => {
    const moves = legalMoves(boardFromString(DAMAS_INITIAL_BOARD), WHITE);
    expect(moves).toHaveLength(7);
    for (const m of moves) {
      expect(m.captures).toEqual([]);
      expect(Math.floor(m.path[0] / 8)).toBe(4);
    }
  });

  it('never moves a man backwards without capturing', () => {
    const b = boardFromString(board({ w: [[4, 3]] }));
    expect(
      legalMoves(b, WHITE)
        .map((m) => m.path[0])
        .sort(),
    ).toEqual([sq(3, 2), sq(3, 4)].sort());
  });

  it('makes capturing mandatory', () => {
    const b = boardFromString(
      board({
        w: [
          [5, 2],
          [6, 7],
        ],
        b: [[4, 3]],
      }),
    );
    const moves = legalMoves(b, WHITE);
    expect(moves).toEqual([
      { from: sq(5, 2), path: [sq(3, 4)], captures: [sq(4, 3)] },
    ]);
  });

  it('lets men capture backwards', () => {
    const b = boardFromString(board({ w: [[3, 3]], b: [[4, 4]] }));
    expect(legalMoves(b, WHITE)).toEqual([
      { from: sq(3, 3), path: [sq(5, 5)], captures: [sq(4, 4)] },
    ]);
  });

  it('chains captures and applies the majority rule', () => {
    // Piece A can take one; piece B can take two in a row.
    const b = boardFromString(
      board({
        w: [
          [7, 0],
          [5, 6],
        ],
        b: [
          [6, 1],
          [4, 5],
          [2, 5],
        ],
      }),
    );
    const moves = legalMoves(b, WHITE);
    expect(moves).toEqual([
      {
        from: sq(5, 6),
        path: [sq(3, 4), sq(1, 6)],
        captures: [sq(4, 5), sq(2, 5)],
      },
    ]);
  });

  it('lets the king fly and capture at a distance, landing on any free square behind', () => {
    const b = boardFromString(board({ W: [[7, 0]], b: [[4, 3]] }));
    const moves = legalMoves(b, WHITE);
    expect(moves.map((m) => m.path)).toEqual([
      [sq(3, 4)],
      [sq(2, 5)],
      [sq(1, 6)],
      [sq(0, 7)],
    ]);
    expect(moves.every((m) => m.captures[0] === sq(4, 3))).toBe(true);
  });

  it('never jumps two pieces in a row on the same diagonal', () => {
    const b = boardFromString(
      board({
        W: [[7, 0]],
        b: [
          [5, 2],
          [4, 3],
        ],
      }),
    );
    expect(legalMoves(b, WHITE).every((m) => m.captures.length === 0)).toBe(
      true,
    );
  });

  it('slides the king any distance when there is nothing to capture', () => {
    const b = boardFromString(board({ W: [[7, 0]] }));
    expect(legalMoves(b, WHITE)).toHaveLength(7);
  });

  it('never jumps the same piece twice and treats captured pieces as blockers', () => {
    // King on a loop of four enemies: it can take them all, but never one twice.
    const b = boardFromString(
      board({
        W: [[5, 0]],
        b: [
          [4, 1],
          [2, 3],
          [4, 5],
          [6, 3],
        ],
      }),
    );
    const moves = legalMoves(b, WHITE);
    for (const m of moves)
      expect(new Set(m.captures).size).toBe(m.captures.length);
    expect(Math.max(...moves.map((m) => m.captures.length))).toBe(2);
  });

  it('does not promote a man that only passes the last row during a capture', () => {
    // Lands on row 0 after the first jump, then must go on capturing backwards.
    const m = new DamasMatch(
      first,
      [0, 1],
      board({
        w: [[2, 1]],
        b: [
          [1, 2],
          [1, 4],
          [7, 7],
        ],
      }),
    );
    const view = m.publicView();
    expect(view.moves).toEqual([
      {
        from: sq(2, 1),
        path: [sq(0, 3), sq(2, 5)],
        captures: [sq(1, 2), sq(1, 4)],
      },
    ]);
    const out = m.move(0, sq(2, 1), [sq(0, 3), sq(2, 5)]);
    expect(out[0]).toMatchObject({
      event: 'damas:moved',
      payload: { promoted: false },
    });
    expect(m.publicView().board[sq(2, 5)]).toBe('w');
  });

  it('crowns a man that ends its move on the far row', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({ w: [[1, 2]], b: [[7, 7]] }),
    );
    const out = m.move(0, sq(1, 2), [sq(0, 1)]);
    expect(out[0]).toMatchObject({ payload: { promoted: true } });
    expect(m.publicView().board[sq(0, 1)]).toBe('W');
  });
});

describe('DamasMatch', () => {
  it('starts with white and alternates turns', () => {
    const m = new DamasMatch(first, [1, 0]);
    expect(m.turnSeat).toBe(1);
    expect(m.publicView().turn).toBe('white');
    const move = m.publicView().moves[0];
    m.move(1, move.from, move.path);
    expect(m.turnSeat).toBe(0);
    expect(m.publicView()).toMatchObject({ turn: 'black', plies: 1 });
  });

  it('rejects moves out of turn and illegal moves', () => {
    const m = new DamasMatch(first, [0, 1]);
    expect(() => m.move(1, sq(2, 1), [sq(3, 0)])).toThrow('Não é a sua vez');
    expect(() => m.move(0, sq(5, 0), [sq(3, 2)])).toThrow(DomainError);
  });

  it('explains a missing mandatory capture', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({
        w: [
          [5, 2],
          [6, 7],
        ],
        b: [[4, 3]],
      }),
    );
    expect(() => m.move(0, sq(6, 7), [sq(5, 6)])).toThrow(
      'Captura obrigatória',
    );
  });

  it('wins when the opponent has no pieces left', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({ w: [[5, 2]], b: [[4, 3]] }),
    );
    m.move(0, sq(5, 2), [sq(3, 4)]);
    expect(m.phase).toBe('OVER');
    expect(m.result).toEqual({ winner: 0, reason: 'no_pieces' });
  });

  it('wins when the opponent cannot move', () => {
    // The black man on (6,1) is boxed in: every step and every jump is blocked.
    const m = new DamasMatch(
      first,
      [0, 1],
      board({
        w: [
          [7, 0],
          [7, 2],
          [5, 0],
          [5, 2],
          [4, 3],
          [3, 6],
        ],
        b: [[6, 1]],
      }),
    );
    expect(m.publicView().moves.every((mv) => mv.captures.length === 0)).toBe(
      true,
    );
    m.move(0, sq(3, 6), [sq(2, 7)]);
    expect(m.result).toEqual({ winner: 0, reason: 'blocked' });
  });

  it('draws after the king-only move limit', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({ W: [[7, 0]], B: [[0, 1]] }),
    );
    for (let i = 0; i < 2 * DAMAS_DRAW_MOVES && m.phase === 'PLAYING'; i++) {
      const seat = m.turnSeat;
      const white = seat === 0;
      const at = m.publicView().board.indexOf(white ? 'W' : 'B');
      const back = white
        ? at === sq(7, 0)
          ? sq(6, 1)
          : sq(7, 0)
        : at === sq(0, 1)
          ? sq(1, 0)
          : sq(0, 1);
      m.move(seat, at, [back]);
    }
    expect(m.result).toEqual({ winner: null, reason: 'draw_moves' });
  });

  it('resets the king-only counter when a man moves', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({ W: [[7, 0]], b: [[0, 1]] }),
    );
    m.move(0, sq(7, 0), [sq(6, 1)]);
    expect(m.publicView().quietMoves).toBe(1);
    m.move(1, sq(0, 1), [sq(1, 0)]);
    expect(m.publicView().quietMoves).toBe(0);
  });

  it('plays a random legal move on timeout and loses after too many in a row', () => {
    const m = new DamasMatch(first, [0, 1]);
    const out = m.timeout();
    expect(out.map((a) => a.event)).toEqual([
      'damas:turn_timed_out',
      'damas:moved',
    ]);
    expect(m.publicView().timeouts).toEqual([1, 0]);
    for (
      let i = 1;
      i < DAMAS_MAX_TIMEOUTS * 2 - 1 && m.phase === 'PLAYING';
      i++
    )
      m.timeout();
    expect(m.result).toEqual({ winner: 1, reason: 'timeout' });
  });

  it('clears the timeout streak when the player moves again', () => {
    const m = new DamasMatch(first, [0, 1]);
    m.timeout();
    const reply = m.publicView().moves[0];
    m.move(1, reply.from, reply.path);
    const mine = m.publicView().moves[0];
    m.move(0, mine.from, mine.path);
    expect(m.publicView().timeouts).toEqual([0, 0]);
  });

  it('ends on resignation and on abandonment', () => {
    const a = new DamasMatch(first, [0, 1]);
    a.resign(0);
    expect(a.result).toEqual({ winner: 1, reason: 'resign' });
    expect(() => a.resign(1)).toThrow('A partida já terminou');
    const b = new DamasMatch(first, [0, 1]);
    b.removePlayer(1);
    expect(b.result).toEqual({ winner: 0, reason: 'abandoned' });
    expect(b.removePlayer(0)).toEqual([]);
  });

  it('handles draw offers: accept, decline, implicit decline and no spam', () => {
    const m = new DamasMatch(first, [0, 1]);
    expect(m.offerDraw(0)).toEqual([
      { event: 'damas:draw_offered', payload: { seat: 0 } },
    ]);
    expect(() => m.offerDraw(1)).toThrow('Já existe');
    expect(() => m.answerDraw(0, true)).toThrow('Não há proposta');
    expect(m.answerDraw(1, false)).toEqual([
      { event: 'damas:draw_declined', payload: { seat: 1 } },
    ]);
    expect(() => m.offerDraw(0)).toThrow('Jogue um lance');
    const move = m.publicView().moves[0];
    m.move(0, move.from, move.path);
    m.offerDraw(0);
    const reply = m.publicView().moves[0];
    m.move(1, reply.from, reply.path);
    expect(m.publicView().drawOffer).toBeNull();
    m.offerDraw(1);
    m.answerDraw(0, true);
    expect(m.result).toEqual({ winner: null, reason: 'draw_agreed' });
  });

  it('changes the turn token on every move and at the end', () => {
    const m = new DamasMatch(first, [0, 1]);
    const t0 = m.turnToken;
    const move = m.publicView().moves[0];
    m.move(0, move.from, move.path);
    expect(m.turnToken).not.toBe(t0);
    const t1 = m.turnToken;
    m.resign(1);
    expect(m.turnToken).not.toBe(t1);
    expect(m.publicView().moves).toEqual([]);
  });

  it('accepts black starting in custom positions', () => {
    const m = new DamasMatch(
      first,
      [0, 1],
      board({ w: [[7, 0]], b: [[0, 1]] }),
      BLACK,
    );
    expect(m.turnSeat).toBe(1);
  });
});
