/**
 * 결정적 RNG. 엔진 안에서 Math.random 사용 금지 (tests/architecture.test.ts 가 검사).
 * 서버 단계에서는 seed = HMAC_SHA256(secret, matchId + engineVersion) 로 바뀌지만 인터페이스는 같다.
 */

export type Rng = () => number;

/** mulberry32: 32bit 시드 → [0, 1) */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32bit 문자열 해시 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 경기 시드 = hash(gameSeed | matchId | engineVersion) */
export function seedFrom(gameSeed: number, matchId: string, engineVersion: string): number {
  return hashString(`${gameSeed >>> 0}|${matchId}|${engineVersion}`);
}

/** 가중치 배열에서 인덱스 선택 (합이 1 일 필요 없음) */
export function pickWeighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
