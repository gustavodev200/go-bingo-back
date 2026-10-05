import { ROOM_CODE_ALPHABET, roomCodeSchema } from '../contracts';
import { generateRoomCode } from './room-code';

describe('generateRoomCode', () => {
  it('produces valid 6-char codes from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(
        (min, max) => min + Math.floor(Math.random() * (max - min)),
      );
      expect(roomCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('uses the injected random source', () => {
    expect(generateRoomCode(() => 0)).toBe(ROOM_CODE_ALPHABET[0].repeat(6));
    expect(generateRoomCode((_, max) => max - 1)).toBe(
      ROOM_CODE_ALPHABET.at(-1)!.repeat(6),
    );
  });
});
