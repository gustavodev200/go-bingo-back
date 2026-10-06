export interface DrawTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const DRAW_TIMER = Symbol('DRAW_TIMER');

export const realDrawTimer: DrawTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};
