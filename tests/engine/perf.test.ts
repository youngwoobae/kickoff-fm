/**
 * 성능 게이트: 다른 무거운 테스트와 같은 파일에 두면 힙 상태에 따라 흔들리므로 별도 파일(별도 워커).
 * 전체 실행(npm test)에서는 다른 워커와 CPU 를 나눠 쓰므로 벽시계 총합이 흔들린다(플레이크).
 * 그래서 워밍업 뒤 200경기 묶음 5개를 재고 가장 빠른 묶음 × 5 로 1,000경기 시간을 추정한다
 * (부하 스파이크는 일부 묶음만 늦추고, 엔진이 실제로 느려지면 모든 묶음이 느려진다).
 * M4.8: 벽시계 대신 이 워커 프로세스의 CPU 시간(process.cpuUsage, vitest 기본 pool = forks)으로 잰다.
 * 전체 실행에서 16개 워커가 CPU 를 나눠 쓰면 모든 묶음의 벽시계가 3배 넘게 늘어 최선 묶음도 5초를 넘었다(단독 1.9초).
 */
import { describe, expect, it } from 'vitest';
import { simulateMatch } from '../../src/engine';
import { config, makeTeam } from '../helpers';

describe('성능', () => {
  it('1,000경기 시뮬 < 5초 (최선 묶음 기준 추정)', () => {
    const A = makeTeam(11, 'ha', 60, 'HIGH_PRESS');
    const B = makeTeam(22, 'aw', 60, 'COUNTER');
    const run = (from: number, n: number) => {
      for (let i = from; i < from + n; i++) simulateMatch({ matchId: `p${i}`, seed: i, home: A.input, away: { ...B.input, isHome: false }, config: config() });
    };
    run(10_000, 50); // JIT 워밍업
    const batches: number[] = [];
    for (let b = 0; b < 5; b++) {
      const t0 = process.cpuUsage();
      run(b * 200, 200);
      const d = process.cpuUsage(t0);
      batches.push((d.user + d.system) / 1000);
    }
    expect(Math.min(...batches) * 5).toBeLessThan(5000);
  });
});
