/** xG 기반 기대 승점 (독립 포아송 0~10골 근사, 8.8 시즌 기대 승점). 소유: A. */

function poissonPmf(lambda: number, maxGoals: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= maxGoals; k++) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return out;
}

export function expectedPoints(xgFor: number, xgAgainst: number): number {
  const a = poissonPmf(Math.max(0, xgFor), 10);
  const b = poissonPmf(Math.max(0, xgAgainst), 10);
  let win = 0;
  let draw = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = a[i]! * b[j]!;
      if (i > j) win += p;
      else if (i === j) draw += p;
    }
  }
  return 3 * win + draw;
}
