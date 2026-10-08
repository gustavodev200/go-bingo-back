import {
  CHARACTER_IDS,
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
    expect(updateProfileSchema.safeParse({ character: 'c01' }).success).toBe(
      true,
    );
    expect(
      updateProfileSchema.safeParse({ nickname: 'Ana', character: 'c16' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty patch and unknown characters', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ character: 'c99' }).success).toBe(
      false,
    );
  });

  it('keeps character ids unique', () => {
    expect(new Set(CHARACTER_IDS).size).toBe(CHARACTER_IDS.length);
  });
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
