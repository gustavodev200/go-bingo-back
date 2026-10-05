import { ROOM_CODE_ALPHABET } from '../contracts';
import type { RandomInt } from '../core/random';

export function generateRoomCode(random: RandomInt): string {
  let code = '';
  for (let i = 0; i < 6; i++)
    code += ROOM_CODE_ALPHABET[random(0, ROOM_CODE_ALPHABET.length)];
  return code;
}
