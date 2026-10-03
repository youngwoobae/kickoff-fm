/** M3.2 도메인: 70구단 생성(D14·K2·K3), 경량 시뮬 분포(D7), 하루 진행 구조적 공유 */
import { describe, expect, it } from 'vitest';
import {
  QUICK_SIM,
  TIER_ECONOMY,
  TIER_REFERENCE_OVR,
  advanceDayState,
  baseSalary,
  createInitialState,
  dailySalary,
  quickSimScore,
  salaryTotal,
  startingBalance,
  starterOvr,
  clubPlayers,
} from '../../src/domain';
import { mulberry32 } from '../../src/engine';
import type { GameState } from '../../src/types';

const fresh = (tier: 'T1' | 'T3' | 'T5' = 'T5') => createInitialState(77, { clubName: '피라미드 FC', tier, devMode: true }, 'now');

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

describe('70구단 생성 (M3.2)', () => {
  it('5리그 × 14, 사용자 리그 = c01~c14, 이름 70개 서로 다름, 선수 1,540', () => {
    const s = fresh('T5');
    expect(s.leagues!.map((l) => [l.id, l.tier, l.clubIds.length])).toEqual([
      ['L-T1', 'T1', 14],
      ['L-T2', 'T2', 14],
      ['L-T3', 'T3', 14],
      ['L-T4', 'T4', 14],
      ['L-T5', 'T5', 14],
    ]);
    expect(s.leagues![4]!.clubIds).toEqual(Array.from({ length: 14 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`));
    expect(new Set(Object.values(s.clubs).map((c) => c.name)).size).toBe(70);
    expect(Object.keys(s.players)).toHaveLength(1540);
    expect(s.fixtures).toHaveLength(910);
  });

  it('D14: 구단 주전 OVR 이 티어 대역(ref ± 6) 안, 티어 평균 ref ± 2', () => {
    const s = fresh('T3');
    for (const l of s.leagues!) {
      const ref = TIER_REFERENCE_OVR[l.tier];
      const strs = l.clubIds.map((id) => starterOvr(clubPlayers(s, id)));
      for (const x of strs) expect(Math.abs(x - ref)).toBeLessThanOrEqual(7); // 생성 반올림 여유 1
      expect(Math.abs(strs.reduce((a, b) => a + b, 0) / strs.length - ref)).toBeLessThanOrEqual(2);
    }
  });

  it('K1·K2: S(OVR) 표, 선수 연봉 = S × U(0.9, 1.1), 기준 스쿼드 캡 사용률 약 80~95%', () => {
    expect(baseSalary(60)).toBe(3_000_000);
    expect(baseSalary(66)).toBe(4_650_000);
    expect(baseSalary(48)).toBe(1_249_000); // 문서 1.25 (반올림 표기)
    const s = fresh('T5');
    for (const p of Object.values(s.players)) {
      const S = baseSalary(p.ovr);
      expect(p.contract.salary).toBeGreaterThanOrEqual(S * 0.9 - 1000);
      expect(p.contract.salary).toBeLessThanOrEqual(S * 1.1 + 1000);
    }
    for (const l of s.leagues!) {
      const cap = TIER_ECONOMY[l.tier].salaryCap;
      const use = l.clubIds.map((id) => salaryTotal(s, id) / cap).reduce((a, b) => a + b, 0) / 14;
      expect(use).toBeGreaterThan(0.75);
      expect(use).toBeLessThan(1.0);
    }
  });

  it('K3: 시작 잔액 = 자기 티어 배정금 × 20% (+ Day 1 배정금 − 1일차 연봉)', () => {
    const s = fresh('T5');
    for (const l of s.leagues!) {
      const econ = TIER_ECONOMY[l.tier];
      for (const id of l.clubIds) {
        expect(s.finances[id]!.balance).toBe(startingBalance(econ) + econ.seasonBudget - dailySalary(salaryTotal(s, id), 1));
      }
    }
    // 원장은 사용자 리그만
    expect(s.finances[s.leagues![0]!.clubIds[0]!]!.ledger).toEqual([]);
    expect(s.finances.c02!.ledger.length).toBeGreaterThan(0);
  });
});

describe('경량 시뮬 (D7)', () => {
  it('LEAGUE_REALISM 범위: 경기당 득점 2.6~3.0, 홈 승 42~47% (같은 리그 전력 분포 sd 2.5)', () => {
    const rng = mulberry32(2026);
    const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
    let goals = 0;
    let homeWins = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) {
      const r = quickSimScore(rng, 60 + g() * 2.5, 60 + g() * 2.5);
      goals += r.home + r.away;
      if (r.home > r.away) homeWins++;
    }
    expect(goals / N).toBeGreaterThanOrEqual(2.6);
    expect(goals / N).toBeLessThanOrEqual(3.0);
    expect(homeWins / N).toBeGreaterThanOrEqual(0.42);
    expect(homeWins / N).toBeLessThanOrEqual(0.47);
  });

  it('OVR 10 차 → 강팀 승률 55~70% (엔진 OVR_DIFF_10 ≈ 62%)', () => {
    const rng = mulberry32(7);
    let strongWins = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const home = i % 2 === 0;
      const r = quickSimScore(rng, home ? 65 : 55, home ? 55 : 65);
      if (home ? r.home > r.away : r.away > r.home) strongWins++;
    }
    expect(strongWins / N).toBeGreaterThan(0.55);
    expect(strongWins / N).toBeLessThan(0.7);
    expect(QUICK_SIM.perOvr).toBeGreaterThan(0);
  });
});

describe('하루 진행 (M3.2)', () => {
  it('깊게 얼린 입력으로 한 시즌 진행 — 제자리 수정 없음(구조적 공유), 결정적', () => {
    let s: GameState = fresh('T5');
    const twin = advanceDayState(s, 'now').state;
    for (let d = 0; d < 28; d++) s = advanceDayState(deepFreeze(s), 'now').state;
    expect(s.phase).toBe('SEASON_OVER');
    expect(s.fixtures.every((f) => f.played && f.score)).toBe(true);
    expect(JSON.stringify(advanceDayState(fresh('T5'), 'now').state)).toBe(JSON.stringify(twin));
  });
});
