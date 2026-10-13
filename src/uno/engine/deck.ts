import {
  UNO_COLORS,
  type UnoCard,
  type UnoColor,
  type UnoValue,
} from '../../contracts';

const NUMBERS: UnoValue[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTIONS: UnoValue[] = ['skip', 'reverse', 'draw2'];

/** Official 108-card deck: per color one 0 and two of 1–9, skip, reverse and +2; four wilds and four +4. */
export function newUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const color of UNO_COLORS) {
    deck.push({ color, value: '0' });
    for (const value of [...NUMBERS, ...ACTIONS])
      deck.push({ color, value }, { color, value });
  }
  for (let i = 0; i < 4; i++)
    deck.push(
      { color: 'wild', value: 'wild' },
      { color: 'wild', value: 'wild4' },
    );
  return deck;
}

/** A card fits when it is wild, has the color to follow or the same value as the top card. */
export function canPlayOn(
  card: UnoCard,
  top: UnoCard,
  color: UnoColor,
): boolean {
  return (
    card.color === 'wild' || card.color === color || card.value === top.value
  );
}
