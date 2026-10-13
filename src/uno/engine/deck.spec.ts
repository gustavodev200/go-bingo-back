import { cardPoints, UNO_COLORS } from '../../contracts';
import { canPlayOn, newUnoDeck } from './deck';
import { card } from './test-cards';

describe('UNO deck', () => {
  const deck = newUnoDeck();

  it('has the 108 official cards', () => {
    expect(deck).toHaveLength(108);
    for (const color of UNO_COLORS) {
      const ofColor = deck.filter((c) => c.color === color);
      expect(ofColor).toHaveLength(25);
      expect(ofColor.filter((c) => c.value === '0')).toHaveLength(1);
      expect(ofColor.filter((c) => c.value === '7')).toHaveLength(2);
      expect(ofColor.filter((c) => c.value === 'skip')).toHaveLength(2);
      expect(ofColor.filter((c) => c.value === 'reverse')).toHaveLength(2);
      expect(ofColor.filter((c) => c.value === 'draw2')).toHaveLength(2);
    }
    expect(deck.filter((c) => c.value === 'wild')).toHaveLength(4);
    expect(deck.filter((c) => c.value === 'wild4')).toHaveLength(4);
  });

  it('scores cards by the official values', () => {
    expect(cardPoints(card('r7'))).toBe(7);
    expect(cardPoints(card('b0'))).toBe(0);
    expect(cardPoints(card('gS'))).toBe(20);
    expect(cardPoints(card('yR'))).toBe(20);
    expect(cardPoints(card('r+2'))).toBe(20);
    expect(cardPoints(card('w'))).toBe(50);
    expect(cardPoints(card('w+4'))).toBe(50);
  });

  it('matches by color, by value or with a wild card', () => {
    const top = card('r5');
    expect(canPlayOn(card('r9'), top, 'red')).toBe(true);
    expect(canPlayOn(card('b5'), top, 'red')).toBe(true);
    expect(canPlayOn(card('b6'), top, 'red')).toBe(false);
    expect(canPlayOn(card('w'), top, 'red')).toBe(true);
    expect(canPlayOn(card('w+4'), top, 'red')).toBe(true);
    expect(canPlayOn(card('gS'), card('rS'), 'red')).toBe(true);
  });

  it('follows the chosen color after a wild card', () => {
    expect(canPlayOn(card('g2'), card('w'), 'green')).toBe(true);
    expect(canPlayOn(card('r2'), card('w'), 'green')).toBe(false);
  });
});
