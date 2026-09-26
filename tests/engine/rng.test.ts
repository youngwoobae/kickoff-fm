import { describe, expect, it } from 'vitest';
import { mulberry32, pickWeighted, seedFrom } from '../../src/engine';

describe('rng', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 100 }, () => a());
    const ys = Array.from({ length: 100 }, () => b());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('seedFrom 은 matchId·engineVersion 에 따라 달라진다', () => {
    expect(seedFrom(1, 's1-d1-a-b', '0.1.0')).toBe(seedFrom(1, 's1-d1-a-b', '0.1.0'));
    expect(seedFrom(1, 's1-d1-a-b', '0.1.0')).not.toBe(seedFrom(1, 's1-d1-a-b', '0.1.1'));
    expect(seedFrom(1, 's1-d1-a-b', '0.1.0')).not.toBe(seedFrom(2, 's1-d1-a-b', '0.1.0'));
  });

  it('pickWeighted 는 가중치 비율을 따른다', () => {
    const rng = mulberry32(7);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[pickWeighted(rng, [0.2, 0.3, 0.5])]! += 1;
    expect(counts[0]! / 30_000).toBeCloseTo(0.2, 1);
    expect(counts[2]! / 30_000).toBeCloseTo(0.5, 1);
  });
});
