import { addWeeks, weekKey, weekStart } from './week';

describe('weekStart', () => {
  it('goes back to Monday 00:00 in São Paulo', () => {
    // Quarta 14/10/2026 15:00 UTC → segunda 12/10 00:00 -03 = 03:00 UTC.
    expect(weekStart(new Date('2026-10-14T15:00:00Z')).toISOString()).toBe(
      '2026-10-12T03:00:00.000Z',
    );
  });

  it('keeps Monday itself and treats Sunday as the end of the previous week', () => {
    expect(weekStart(new Date('2026-10-12T03:00:00Z')).toISOString()).toBe(
      '2026-10-12T03:00:00.000Z',
    );
    // Domingo 18/10 23:30 em SP (02:30 UTC de segunda) ainda é a semana de 12/10.
    expect(weekStart(new Date('2026-10-19T02:30:00Z')).toISOString()).toBe(
      '2026-10-12T03:00:00.000Z',
    );
  });

  it('moves by whole weeks and exposes the DATE key', () => {
    const start = weekStart(new Date('2026-10-14T15:00:00Z'));
    expect(addWeeks(start, -1).toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(weekKey(start).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });
});
