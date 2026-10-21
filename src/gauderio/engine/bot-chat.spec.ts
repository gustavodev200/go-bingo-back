import type {
  GaudCard,
  GaudMatchView,
  GaudPrivateHand,
  GaudRank,
} from '../../contracts';
import { opponentReply, partnerReply } from './bot-chat';

const SUIT = { e: 'espadas', p: 'paus', c: 'copas', o: 'ouros' } as const;
const c = (s: string): GaudCard => ({
  rank: Number(s.slice(0, -1)) as GaudRank,
  suit: SUIT[s.slice(-1) as keyof typeof SUIT],
});

function hand(cards: string[], over: Partial<GaudPrivateHand> = {}) {
  return {
    handNumber: 1,
    cards: cards.map((x, i) => ({ id: `c${i}`, card: c(x) })),
    envido: 30,
    envidoCards: [],
    flor: false,
    actions: {
      canPlay: false,
      canHide: false,
      canFold: false,
      calls: [],
      canAccept: false,
      canDecline: false,
      envidoNote: null,
    },
    votes: null,
    ...over,
  } satisfies GaudPrivateHand;
}

function view(over: Partial<GaudMatchView> = {}): GaudMatchView {
  return {
    handNumber: 1,
    dealer: 3,
    mano: 0,
    phase: 'AWAITING_PLAY',
    turn: 0,
    trucoValue: 1,
    trucoLastRaiseTeam: null,
    pending: null,
    trucoOnHold: false,
    envidoClosed: false,
    sideResults: [],
    rounds: [{ plays: [], result: null, winningSeat: null }],
    cardsLeft: [3, 3, 3, 3],
    lastHandResult: null,
    ...over,
  };
}

const random = () => 0;
// Lugar 2 é a CPU parceira do lugar 0.
const ask = (
  key: Parameters<typeof partnerReply>[0],
  cards: string[],
  v = view(),
  h = {},
) => partnerReply(key, 2, hand(cards, h), v, random);

describe('partnerReply (CPU parceira, honesta)', () => {
  it('diz se faz a primeira olhando a própria mão e a mesa', () => {
    expect(ask('first', ['1e', '4c', '5o']).text).toBe(
      'Faço sim, tenho o Espadão!',
    );
    expect(ask('first', ['3e', '4c', '5o']).text).toBe(
      'Acho que faço, tenho um 3.',
    );
    expect(ask('first', ['4e', '5c', '6o']).text).toMatch(/não garanto/);
    const onTable = view({
      rounds: [
        {
          plays: [{ seat: 1, card: c('3o'), hidden: false }],
          result: null,
          winningSeat: null,
        },
      ],
    });
    expect(ask('first', ['7e', '4c', '5o'], onTable).text).toBe(
      'Essa eu mato, deixa comigo!',
    );
    expect(ask('first', ['2e', '4c', '5o'], onTable).text).toMatch(
      /não consigo/,
    );
    const later = view({
      rounds: [
        { plays: [], result: 0, winningSeat: 2 },
        { plays: [], result: null, winningSeat: null },
      ],
    });
    expect(ask('first', ['4e'], later).text).toBe('A primeira já é nossa!');
  });

  it('conta as cartas, o envido, a flor e opina no truco', () => {
    expect(ask('cards', ['1p', '3c', '4o']).text).toBe(
      'Tenho o Bastião e mais 1 boa!',
    );
    expect(ask('cards', ['4e', '5c', '6o']).text).toMatch(/sem carta/);
    expect(ask('envido', ['4e'], view(), { envido: 31 }).text).toBe(
      'Tenho 31 de envido, pode pedir!',
    );
    expect(ask('envido', ['4e'], view({ envidoClosed: true })).text).toMatch(
      /já passou/,
    );
    expect(ask('flor', ['4e'], view(), { flor: true }).text).toMatch(
      /Tenho flor/,
    );
    expect(ask('truco', ['1e', '3c', '4o']).text).toBe('Pede que eu seguro!');
    expect(ask('truco', ['4e', '5c', '6o']).text).toMatch(/Melhor não/);
  });

  it('"joga baixo" e "mata essa" viram ordem para a próxima carta', () => {
    expect(ask('low', ['1e', '4c'])).toEqual({
      text: 'Beleza, jogo baixo.',
      order: 'low',
    });
    expect(ask('kill', ['1e', '4c'])).toEqual({
      text: 'Deixa comigo!',
      order: 'kill',
    });
    const theirs = view({
      rounds: [
        {
          plays: [{ seat: 1, card: c('1e'), hidden: false }],
          result: null,
          winningSeat: null,
        },
      ],
    });
    expect(ask('kill', ['3e', '4c'], theirs).order).toBeUndefined();
  });
});

describe('opponentReply (CPU adversária)', () => {
  it('provoca com mão forte e às vezes blefa', () => {
    expect(opponentReply('taunt', hand(['1e', '3c', '4o']), () => 1).text).toBe(
      'Pede truco se for homem!',
    );
    expect(
      opponentReply('cards', hand(['4e', '5c', '6o']), () => 1).text,
    ).toMatch(/sei não|adivinhar/);
    expect(opponentReply('gg', hand([]), random).text).toMatch(/Bom jogo/);
  });
});
