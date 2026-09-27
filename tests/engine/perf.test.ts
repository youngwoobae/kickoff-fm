/** 성능 게이트: 다른 무거운 테스트와 같은 파일에 두면 힙 상태에 따라 흔들리므로 별도 파일(별도 워커) */
import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../../src/engine';
import { config, makeTeam } from '../helpers';

describe('성능', () => {
  it('1,000경기 시뮬 < 5초', () => {
    const A = makeTeam(11, 'ha', 60, 'HIGH_PRESS');
    const B = makeTeam(22, 'aw', 60, 'COUNTER');
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) simulateMatch({ matchId: `p${i}`, seed: i, home: A.input, away: { ...B.input, isHome: false }, config: config() });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
