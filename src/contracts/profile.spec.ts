import {
  CHARACTER_FACES,
  JERSEY_IDS,
  encodeCharacter,
  parseCharacter,
  isNicknameAllowed,
  nicknameSchema,
  profileSchema,
  updateProfileSchema,
} from './profile';

describe('nicknameSchema', () => {
  it.each(['Ana', 'João_10', 'Maria Clara', 'abcdefghijklmnop'])(
    'accepts %s',
    (nick) => {
      expect(nicknameSchema.safeParse(nick).success).toBe(true);
    },
  );

  it.each(['ab', 'abcdefghijklmnopq', '<script>', 'ana!', ''])(
    'rejects %s',
    (nick) => {
      expect(nicknameSchema.safeParse(nick).success).toBe(false);
    },
  );

  it('trims spaces before validating', () => {
    expect(nicknameSchema.parse('  Ana  ')).toBe('Ana');
  });
});

describe('isNicknameAllowed', () => {
  it('blocks words from the blocklist ignoring case and accents', () => {
    expect(isNicknameAllowed('Caralho123')).toBe(false);
    expect(isNicknameAllowed('PÚTA')).toBe(false);
  });

  it('allows normal nicknames', () => {
    expect(isNicknameAllowed('Gustavo')).toBe(true);
  });
});

describe('updateProfileSchema', () => {
  it('accepts a nickname, a character, or both', () => {
    expect(updateProfileSchema.safeParse({ nickname: 'Ana' }).success).toBe(
      true,
    );
    expect(updateProfileSchema.safeParse({ character: 'afla10' }).success).toBe(
      true,
    );
    expect(
      updateProfileSchema.safeParse({ nickname: 'Ana', character: 'lbol22' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty patch and unknown characters', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ character: 'c01' }).success).toBe(
      false,
    );
  });

  it('keeps face and jersey ids unique and 1/3 letters long', () => {
    expect(new Set(CHARACTER_FACES).size).toBe(CHARACTER_FACES.length);
    expect(new Set(JERSEY_IDS).size).toBe(JERSEY_IDS.length);
    expect(CHARACTER_FACES.every((f) => /^[a-z]$/.test(f))).toBe(true);
    expect(JERSEY_IDS.every((j) => /^[a-z]{3}$/.test(j))).toBe(true);
  });
});

describe('character codes', () => {
  it('round-trips face, jersey and number and fits the 8-char column', () => {
    const code = encodeCharacter({ face: 'd', jersey: 'vas', number: 7 });
    expect(code).toBe('dvas07');
    expect(code.length).toBeLessThanOrEqual(8);
    expect(parseCharacter(code)).toEqual({
      face: 'd',
      jersey: 'vas',
      number: 7,
    });
  });

  it('clamps the number to 0..99', () => {
    expect(encodeCharacter({ face: 'a', jersey: 'fla', number: 150 })).toBe(
      'afla99',
    );
    expect(encodeCharacter({ face: 'a', jersey: 'fla', number: -3 })).toBe(
      'afla00',
    );
  });

  it.each(['c01', 'zfla10', 'axxx10', 'afla1', 'AFLA10', '', null, 42])(
    'rejects %s',
    (code) => {
      expect(parseCharacter(code)).toBeNull();
    },
  );
});

describe('profileSchema', () => {
  it('accepts a profile from an API that predates the character field', () => {
    const old = {
      id: '00000000-0000-4000-8000-000000000001',
      nickname: 'Ana',
      isGuest: false,
      points: 0,
      coins: 0,
    };
    expect(profileSchema.safeParse(old).success).toBe(true);
  });
});

describe('profileSchema (legacy characters)', () => {
  it('turns a character saved before the football players (c01..c17) into null', () => {
    const parsed = profileSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      nickname: 'Ana',
      isGuest: false,
      points: 0,
      coins: 0,
      character: 'c05',
    });
    expect(parsed.character).toBeNull();
  });
});
