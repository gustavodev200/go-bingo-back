import {
  envidoBest,
  envidoPoints,
  florPoints,
  gaudStrength,
  hasFlor,
  type GaudCard,
  type GaudRank,
  type GaudSeat,
  type GaudSettings,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { GaudMatch, handWinner, newDeck, shuffle } from './match';

const SUIT = { e: 'espadas', p: 'paus', c: 'copas', o: 'ouros' } as const;
/** '7e' = 7 de espadas, '12o' = rei de ouros. */
const c = (s: string): GaudCard => ({
  rank: Number(s.slice(0, -1)) as GaudRank,
  suit: SUIT[s.slice(-1) as keyof typeof SUIT],
});
const hand = (...s: string[]) => s.map(c);

/** Baralho com as mãos pedidas na frente (lugar 0 primeiro) e o resto depois. */
function deckOf(hands: string[][]): () => GaudCard[] {
  const front = hands.flat().map(c);
  const key = (x: GaudCard) => `${x.rank}${x.suit}`;
  const used = new Set(front.map(key));
  const rest = newDeck().filter((x) => !used.has(key(x)));
  return () => [...front, ...rest];
}

const random = () => 0;
const TWO: GaudSettings = { size: 2, target: 12, flor: true };
const FOUR: GaudSettings = { size: 4, target: 12, flor: true };

/** Partida com o lugar 0 como mão (quem dá é o último lugar). */
function match(
  hands: string[][],
  settings: GaudSettings = TWO,
  scores?: [number, number],
) {
  const m = new GaudMatch(random, settings, {
    dealer: (settings.size - 1) as GaudSeat,
    deck: deckOf(hands),
    scores,
  });
  m.deal();
  return m;
}

const cardId = (m: GaudMatch, seat: GaudSeat, card: string) => {
  const want = c(card);
  const found = m
    .privateView(seat)!
    .cards.find((x) => x.card.rank === want.rank && x.card.suit === want.suit);
  if (!found) throw new Error(`no ${card} at ${seat}`);
  return found.id;
};
const play = (m: GaudMatch, seat: GaudSeat, card: string, hidden = false) =>
  m.play(seat, cardId(m, seat, card), hidden);

function expectDomain(fn: () => unknown, message?: RegExp) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    if (message) expect((e as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected DomainError');
}

describe('cartas', () => {
  it('ordena as manilhas e as comuns', () => {
    const order = [
      '1e',
      '1p',
      '7e',
      '7o',
      '3c',
      '2o',
      '1c',
      '12p',
      '11e',
      '10o',
      '7p',
      '6c',
      '5e',
      '4o',
    ].map((x) => gaudStrength(c(x)));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
    expect(gaudStrength(c('3e'))).toBe(gaudStrength(c('3o')));
    expect(gaudStrength(c('1c'))).toBe(gaudStrength(c('1o')));
    expect(gaudStrength(c('7c'))).toBe(gaudStrength(c('7p')));
  });

  it('conta o envido como no regulamento', () => {
    expect(envidoPoints(hand('1c', '7c', '6p'))).toBe(28);
    expect(envidoPoints(hand('1p', '3e', '4o'))).toBe(4);
    expect(envidoPoints(hand('6o', '7o', '12p'))).toBe(33);
    expect(envidoPoints(hand('10e', '12e', '1c'))).toBe(20);
    expect(envidoPoints(hand('10e', '12p', '11c'))).toBe(0);
    // Três do mesmo naipe: vale a melhor dupla.
    expect(envidoPoints(hand('7e', '6e', '5e'))).toBe(33);
  });

  it('figuras (10, 11, 12) valem zero no envido', () => {
    expect(envidoPoints(hand('10e', '6e', '1c'))).toBe(26);
    expect(envidoPoints(hand('10e', '11e', '1c'))).toBe(20);
    expect(envidoPoints(hand('10e', '7e', '4c'))).toBe(27);
    expect(envidoPoints(hand('10e', '11o', '12c'))).toBe(0);
    expect(envidoBest(hand('10e', '7e', '4c')).cards).toEqual(
      hand('10e', '7e'),
    );
    expect(envidoBest(hand('1p', '3e', '4o')).cards).toEqual(hand('4o'));
  });

  it('reconhece a flor e conta seus pontos', () => {
    expect(hasFlor(hand('7e', '6e', '5e'))).toBe(true);
    expect(hasFlor(hand('7e', '6e', '5o'))).toBe(false);
    expect(florPoints(hand('7e', '6e', '12e'))).toBe(33);
  });

  it('embaralha sem perder cartas', () => {
    const deck = shuffle(
      newDeck(),
      (min, max) => min + ((max * 7) % (max - min)),
    );
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((x) => `${x.rank}${x.suit}`)).size).toBe(40);
  });
});

describe('handWinner', () => {
  it.each([
    [[0, 0], 0],
    [[0, 1], undefined],
    [['tie', 1], 1],
    [[1, 'tie'], 1],
    [['tie', 'tie'], undefined],
    [['tie', 'tie', 0], 0],
    [[0, 1, 'tie'], 0],
    [['tie', 'tie', 'tie'], 1],
  ] as const)('%j → %s (mão é a dupla 1)', (results, expected) => {
    expect(handWinner(results, 1)).toBe(expected);
  });
});

describe('GaudMatch mano a mano', () => {
  const A = ['3e', '2o', '12p']; // envido 3 (sem naipe repetido) → 3
  const B = ['1e', '4c', '5c']; // envido 29

  it('joga as rodadas e dá 1 ponto a quem ganha duas', () => {
    const m = match([A, B]);
    expect(m.publicView()!.turn).toBe(0);
    play(m, 0, '3e');
    play(m, 1, '1e'); // 1 de espadas mata
    expect(m.publicView()!.turn).toBe(1);
    play(m, 1, '4c');
    play(m, 0, '2o');
    play(m, 0, '12p');
    const out = play(m, 1, '5c');
    expect(out.map((a) => a.event)).toContain('gauderio:hand_ended');
    expect(m.scores).toEqual([1, 0]);
  });

  it('empate na primeira: a segunda decide', () => {
    const m = match([
      ['3e', '4o', '5o'],
      ['3c', '6p', '12e'],
    ]);
    play(m, 0, '3e');
    play(m, 1, '3c');
    expect(m.publicView()!.rounds[0].result).toBe('tie');
    play(m, 0, '4o');
    play(m, 1, '6p');
    expect(m.scores).toEqual([0, 1]);
  });

  it('truco aceito vale 2; não quero entrega o valor anterior', () => {
    const m = match([A, B]);
    m.call(0, 'truco');
    expect(m.publicView()!.phase).toBe('AWAITING_RESPONSE');
    expectDomain(() => play(m, 0, '3e'), /Responda/);
    m.respond(1, true);
    expect(m.publicView()!.trucoValue).toBe(2);
    // Quem pediu não aumenta de novo.
    expect(m.callError(0, 'retruco')).toMatch(/só o adversário/);
    play(m, 0, '3e');
    m.call(1, 'retruco');
    m.call(0, 'vale4');
    const out = m.respond(1, false);
    expect(out.map((a) => a.event)).toContain('gauderio:hand_ended');
    expect(m.scores).toEqual([3, 0]);
  });

  it('não quero no primeiro truco dá 1 ponto', () => {
    const m = match([A, B]);
    m.call(0, 'truco');
    m.respond(1, false);
    expect(m.scores).toEqual([1, 0]);
  });

  it('envido aceito: vence quem tem mais pontos', () => {
    const m = match([A, B]);
    m.call(0, 'envido');
    const out = m.respond(1, true);
    const side = out.find((a) => a.event === 'gauderio:side_resolved')!;
    expect(side.payload).toMatchObject({
      kind: 'envido',
      winnerTeam: 1,
      points: 2,
      teamPoints: [3, 29],
    });
    expect(m.scores).toEqual([0, 2]);
    expect(m.publicView()!.envidoClosed).toBe(true);
    expect(m.callError(0, 'envido')).not.toBeNull();
    expect(m.publicView()!.phase).toBe('AWAITING_PLAY');
  });

  it('envido empatado fica com o mão', () => {
    const m = match(
      [
        ['7e', '6e', '1c'],
        ['7c', '6c', '1o'],
      ],
      { ...TWO, flor: false },
    );
    m.call(0, 'envido');
    m.respond(1, true);
    expect(m.scores).toEqual([2, 0]);
  });

  it('envido → real envido → não quero dá 2; real envido sozinho recusado dá 1', () => {
    const m = match([A, B]);
    m.call(0, 'envido');
    m.call(1, 'real_envido');
    m.respond(0, false);
    expect(m.scores).toEqual([0, 2]);

    const m2 = match([A, B]);
    m2.call(0, 'real_envido');
    expect(m2.callError(1, 'envido')).not.toBeNull();
    m2.respond(1, false);
    expect(m2.scores).toEqual([1, 0]);
  });

  it('envido + real envido aceitos valem 5; falta envido vale a falta', () => {
    const m = match([A, B]);
    m.call(0, 'envido');
    m.call(1, 'real_envido');
    m.respond(0, true);
    expect(m.scores).toEqual([0, 5]);

    const m2 = match([A, B], TWO, [3, 8]);
    m2.call(0, 'envido');
    m2.call(1, 'real_envido');
    m2.call(0, 'falta_envido');
    expect(m2.callError(1, 'envido')).not.toBeNull();
    const out = m2.respond(1, true);
    // Falta = 12 − 8 (quem está ganhando) = 4 → a dupla 1 fecha 12.
    expect(m2.scores).toEqual([3, 12]);
    expect(out.map((a) => a.event)).toContain('gauderio:match_over');
    expect(m2.winner).toBe(1);
  });

  it('falta envido recusado depois de envido + real envido entrega 5', () => {
    const m = match([A, B]);
    m.call(0, 'envido');
    m.call(1, 'real_envido');
    m.call(0, 'falta_envido');
    m.respond(1, false);
    expect(m.scores).toEqual([5, 0]);
  });

  it('o envido responde ao truco e depois o truco volta a esperar resposta', () => {
    const m = match([A, B]);
    m.call(0, 'truco');
    m.call(1, 'envido');
    expect(m.publicView()!.trucoOnHold).toBe(true);
    m.respond(0, true);
    const view = m.publicView()!;
    expect(view.pending).toMatchObject({
      kind: 'truco',
      call: 'truco',
      team: 0,
    });
    expect(view.phase).toBe('AWAITING_RESPONSE');
    m.respond(1, true);
    expect(m.publicView()!.trucoValue).toBe(2);
  });

  it('a mão privada mostra as cartas do envido e o motivo quando não dá para pedir', () => {
    const m = match([['10e', '6e', '1c'], B]);
    expect(m.privateView(0)!).toMatchObject({
      envido: 26,
      envidoCards: hand('10e', '6e'),
    });
    expect(m.privateView(0)!.actions.envidoNote).toBeNull();
    m.call(0, 'truco');
    m.respond(1, true);
    expect(m.privateView(0)!.actions.envidoNote).toMatch(/truco aceito/);
    play(m, 0, '1c');
    expect(m.privateView(0)!.actions.envidoNote).toBeNull();
  });

  it('não tem envido depois de jogar a carta nem depois do truco aceito', () => {
    const m = match([A, B]);
    play(m, 0, '3e');
    expect(m.callError(1, 'envido')).toBeNull();
    m.call(1, 'truco');
    m.respond(0, true);
    expect(m.callError(1, 'envido')).toMatch(/truco aceito/);
  });

  it('flor sem flor do outro lado vale 3 e conta quem cantou', () => {
    const m = match([['7e', '6e', '12e'], B]);
    const mine = m.privateView(0)!;
    expect(mine.flor).toBe(true);
    expect(mine.actions.canPlay).toBe(true);
    expect(mine.actions.calls).toEqual(
      expect.arrayContaining(['flor', 'envido', 'truco']),
    );
    const out = m.call(0, 'flor');
    expect(
      out.find((a) => a.event === 'gauderio:side_resolved')!.payload,
    ).toMatchObject({
      kind: 'flor',
      seat: 0,
      chain: ['flor'],
      points: 3,
      outcome: 'uncontested',
    });
    expect(m.scores).toEqual([3, 0]);
    expect(m.publicView()!.envidoClosed).toBe(true);
    play(m, 0, '7e');
  });

  it('a flor é opcional: jogar sem cantar perde a flor', () => {
    const m = match([
      ['7e', '6e', '12e'],
      ['1c', '2c', '3c'],
    ]);
    play(m, 0, '7e');
    expect(m.privateView(0)!.flor).toBe(false);
    // O adversário canta a flor e ganha 3 (a do lugar 0 não conta mais).
    m.call(1, 'flor');
    expect(m.scores).toEqual([0, 3]);
  });

  it('com flor dá para pedir envido em vez de cantar', () => {
    const m = match([['7e', '6e', '12e'], B]);
    m.call(0, 'envido');
    m.respond(1, true);
    // 33 contra 29.
    expect(m.scores).toEqual([2, 0]);
    // Envido disputado: a flor não pode mais ser cantada.
    expect(m.callError(0, 'flor')).not.toBeNull();
  });

  it('a partida fechada pela flor diz como acabou', () => {
    const m = match([['7e', '6e', '12e'], B], TWO, [10, 4]);
    const out = m.call(0, 'flor');
    expect(m.winner).toBe(0);
    expect(m.finish).toMatchObject({
      by: 'flor',
      points: 3,
      side: { seat: 0 },
    });
    expect(
      out.find((a) => a.event === 'gauderio:match_over')!.payload,
    ).toMatchObject({ finish: { by: 'flor' } });
  });

  it('a flor anula o envido cantado', () => {
    const m = match([A, ['7c', '6c', '12c']]);
    m.call(0, 'envido');
    // Quem tem flor escolhe: aceitar o envido ou cantar a flor.
    expect(m.respondError(1, true)).toBeNull();
    m.call(1, 'flor');
    expect(m.scores).toEqual([0, 3]);
    expect(m.publicView()!.pending).toBeNull();
  });

  it('flor contra flor: contra-flor aceita vale 6 para a maior', () => {
    const m = match([
      ['7e', '6e', '12e'],
      ['1c', '2c', '3c'],
    ]);
    m.call(0, 'flor');
    expect(m.scores).toEqual([0, 0]);
    expect(m.respondError(1, true)).toMatch(/contra-flor/);
    m.call(1, 'contraflor');
    m.respond(0, true);
    // 33 contra 26.
    expect(m.scores).toEqual([6, 0]);
  });

  it('fugir da flor entrega 4; fugir da contra-flor e o resto depois da contra-flor entrega 6', () => {
    const m = match([
      ['7e', '6e', '12e'],
      ['1c', '2c', '3c'],
    ]);
    m.call(0, 'flor');
    m.respond(1, false);
    expect(m.scores).toEqual([4, 0]);

    const m2 = match([
      ['7e', '6e', '12e'],
      ['1c', '2c', '3c'],
    ]);
    m2.call(0, 'flor');
    m2.call(1, 'contraflor');
    m2.call(0, 'contraflor_resto');
    m2.respond(1, false);
    expect(m2.scores).toEqual([6, 0]);
  });

  it('sem a regra da flor, três do mesmo naipe é envido comum', () => {
    const m = match([['7e', '6e', '12e'], B], { ...TWO, flor: false });
    expect(m.privateView(0)!.flor).toBe(false);
    expect(m.callError(0, 'flor')).not.toBeNull();
    play(m, 0, '7e');
  });

  it('carta escondida só da segunda rodada e não ganha de nada', () => {
    const m = match([A, B]);
    expectDomain(() => play(m, 0, '3e', true), /segunda rodada/);
    play(m, 0, '3e');
    play(m, 1, '4c');
    expect(m.privateView(0)!.actions.canHide).toBe(true);
    const out = play(m, 0, '2o', true);
    expect(out[0].payload).toMatchObject({ card: null, hidden: true });
    expect(m.publicView()!.rounds[1].plays[0].card).toBeNull();
    play(m, 1, '5c');
    expect(m.publicView()!.rounds[1].result).toBe(1);
  });

  it('ir ao baralho entrega o valor atual', () => {
    const m = match([A, B]);
    m.call(0, 'truco');
    m.respond(1, true);
    play(m, 0, '3e');
    m.fold(1);
    expect(m.scores).toEqual([2, 0]);
    expect(() => m.fold(0)).toThrow(DomainError);
  });

  it('gira quem dá e o mão a cada mão', () => {
    const m = match([A, B]);
    m.call(0, 'truco');
    m.respond(1, false);
    m.deal();
    expect(m.publicView()!).toMatchObject({ dealer: 0, mano: 1, turn: 1 });
  });

  it('W.O. encerra a partida', () => {
    const m = match([A, B]);
    const out = m.abandon(0);
    expect(m.winner).toBe(1);
    expect(out[0].event).toBe('gauderio:match_over');
    expect(m.abandon(1)).toEqual([]);
    expect(m.privateView(0)!.actions.calls).toEqual([]);
  });
});

describe('GaudMatch em duplas', () => {
  const hands = [
    ['3e', '4o', '5p'], // 0 (mão)
    ['4e', '5o', '6p'], // 1
    ['2e', '6o', '7p'], // 2 (parceiro do 0)
    ['10e', '11o', '12c'], // 3
  ];

  it('a vez gira pelos quatro e parceiros somam a rodada', () => {
    const m = match(hands, FOUR);
    play(m, 0, '3e');
    play(m, 1, '4e');
    play(m, 2, '2e');
    const out = play(m, 3, '10e');
    expect(
      out.find((a) => a.event === 'gauderio:round_ended')!.payload,
    ).toMatchObject({
      result: 0,
      winningSeat: 0,
    });
    expect(m.publicView()!.cardsLeft).toEqual([2, 2, 2, 2]);
  });

  it('qualquer um pede envido na sua vez, antes de jogar a carta', () => {
    const m = match(hands, FOUR);
    expect(m.callError(0, 'envido')).toBeNull();
    expect(m.privateView(1)!.actions.envidoNote).toMatch(/na sua vez/);
    play(m, 0, '3e');
    expect(m.callError(1, 'envido')).toBeNull();
    play(m, 1, '4e');
    expect(m.callError(2, 'envido')).toBeNull();
    m.call(2, 'envido');
    // A dupla vota: só decide com os dois votos.
    const voted = m.respond(3, true);
    expect(voted.map((a) => a.event)).toEqual(['gauderio:voted']);
    expect(m.publicView()!.pending!.votes).toBe(1);
    expect(m.privateView(1)!.votes).toEqual({ mine: null, partner: 'accept' });
    expect(m.privateView(0)!.votes).toBeNull();
    m.respond(1, true);
    // Dupla 0: 7 (lugar 2); dupla 1: 6 (lugar 1).
    expect(m.scores).toEqual([2, 0]);
  });

  it('votação da dupla: o voto mais ousado vale, e dá para trocar o voto', () => {
    const m = match(hands, FOUR);
    m.call(0, 'truco');
    m.respond(1, false);
    m.respond(1, true); // trocou o voto
    expect(m.privateView(3)!.votes).toEqual({ mine: null, partner: 'accept' });
    m.respond(3, false);
    // aceitar > não quero
    expect(m.publicView()!.trucoValue).toBe(2);
    expect(m.publicView()!.pending).toBeNull();

    const m2 = match(hands, FOUR);
    m2.call(0, 'truco');
    m2.respond(1, true);
    m2.call(3, 'retruco');
    // aumentar > aceitar: agora a dupla 0 responde o retruco.
    expect(m2.publicView()!.pending).toMatchObject({
      call: 'retruco',
      team: 1,
    });
    expect(m2.publicView()!.trucoValue).toBe(2);
  });

  it('votação: os dois não querem → a mão vai para quem pediu', () => {
    const m = match(hands, FOUR);
    m.call(0, 'truco');
    m.respond(1, false);
    m.respond(3, false);
    expect(m.scores).toEqual([1, 0]);
  });

  it('voto solo e parceiro que sai decidem sem esperar', () => {
    const m = match(hands, FOUR);
    m.call(0, 'truco');
    m.respond(1, true, true);
    expect(m.publicView()!.trucoValue).toBe(2);

    const m2 = match(hands, FOUR);
    m2.call(0, 'truco');
    expect(m2.resolveVotes(3)).toEqual([]);
    m2.respond(1, false);
    m2.resolveVotes(3);
    expect(m2.scores).toEqual([1, 0]);
  });
});
