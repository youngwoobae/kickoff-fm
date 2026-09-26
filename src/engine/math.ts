export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => Math.log(p / (1 - p));
