import { isNicknameAllowed, nicknameSchema } from './profile';

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
