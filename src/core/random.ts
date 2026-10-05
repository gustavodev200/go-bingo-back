import { randomInt } from 'node:crypto';

/** Inteiro uniforme em [min, maxExclusive). Injetável para testes determinísticos. */
export type RandomInt = (min: number, maxExclusive: number) => number;
export const RANDOM_INT = Symbol('RANDOM_INT');
export const cryptoRandomInt: RandomInt = (min, maxExclusive) =>
  randomInt(min, maxExclusive);
