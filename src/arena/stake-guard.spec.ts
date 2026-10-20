import { stakeLevel, stakeOptions } from '../contracts';
import { checkStake } from './stake-guard';

describe('stake levels', () => {
  it('are multiples of the game minimum, cheapest first', () => {
    expect(stakeOptions('TRUCO').map((o) => o.stake)).toEqual([
      40, 80, 200, 400, 1000,
    ]);
    expect(stakeLevel('BINGO', 20)?.id).toBe('AMISTOSA');
    expect(stakeLevel('BINGO', 21)).toBeUndefined();
  });
});

describe('checkStake', () => {
  it('passes with enough coins and league', () => {
    expect(() =>
      checkStake('UNO', 150, { coins: 150, points: 150 }),
    ).not.toThrow();
  });

  it('counts the extra (bingo card) on top of the stake', () => {
    expect(() =>
      checkStake('BINGO', 20, { coins: 24, points: 0 }, 'Você', 5),
    ).toThrow('Você precisa de 25 moedas para esta mesa');
  });

  it('checks the league before the balance', () => {
    expect(() =>
      checkStake('UNO', 150, { coins: 0, points: 0 }, 'Ana'),
    ).toThrow('Ana precisa da liga Prata para a mesa Alta');
  });
});
