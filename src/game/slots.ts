export function firstFreeSlot(
  taken: ReadonlySet<number>,
  max: number,
): number | null {
  for (let slot = 0; slot < max; slot++) if (!taken.has(slot)) return slot;
  return null;
}
