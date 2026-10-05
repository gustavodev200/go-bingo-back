import { createRoomSchema, roomCodeSchema } from './room';

describe('roomCodeSchema', () => {
  it('normalizes to uppercase', () => {
    expect(roomCodeSchema.parse('ab3k9z')).toBe('AB3K9Z');
  });

  it.each(['ABC12', 'ABCDEFG', 'ABCD0E', 'ABCDOE', 'ABCD1E', 'ABCDIE'])(
    'rejects %s',
    (code) => {
      expect(roomCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});

describe('createRoomSchema', () => {
  it('accepts a valid room', () => {
    expect(
      createRoomSchema.parse({
        name: ' Amigos ',
        maxPlayers: 15,
        isPublic: true,
      }),
    ).toEqual({
      name: 'Amigos',
      maxPlayers: 15,
      isPublic: true,
    });
  });

  it.each([
    { name: 'ab', maxPlayers: 15, isPublic: true },
    { name: 'a'.repeat(25), maxPlayers: 15, isPublic: true },
    { name: 'Amigos', maxPlayers: 12, isPublic: true },
    { name: 'Amigos', maxPlayers: 15, isPublic: '1' },
  ])('rejects %o', (input) => {
    expect(createRoomSchema.safeParse(input).success).toBe(false);
  });
});
