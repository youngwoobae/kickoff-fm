/**
 * 경량 시뮬 (D7, 2.1.0 M3.2): 사용자 리그가 아닌 4리그 경기를 전력(주전 OVR·컨디션)과 홈 이점으로 푸아송 득점만 뽑는다.
 * 목표(LEAGUE_REALISM): 경기당 득점 2.6~3.0, 홈 승 42~47%. 주전 OVR 10 차 → 강팀 승 ≈ 63% (엔진 OVR_DIFF_10 ≈ 62%).
 * 순수 함수, 주입 rng 만 사용.
 */
import type { Player } from '../../types';
import type { Rng } from '../../engine';

/** [PH] 동률 전력 팀당 기대 득점, 홈 배율, OVR 1 당 로그 득점 기울기, 컨디션 1 부족당 OVR 감점 */
export const QUICK_SIM = { base: 1.4, home: 1.1, perOvr: 0.04, conditionPenalty: 0.1 } as const;

/** 출전 가능한 상위 11명 평균 OVR − 컨디션 부족 보정 */
export function teamStrength(players: readonly Player[]): number {
  const xi = players
    .filter((p) => p.availability.injuryDays <= 0 && p.availability.suspendedMatches <= 0)
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 11);
  if (xi.length === 0) return 0;
  const ovr = xi.reduce((s, p) => s + p.ovr, 0) / xi.length;
  const cond = xi.reduce((s, p) => s + p.condition, 0) / xi.length;
  return ovr - Math.max(0, 100 - cond) * QUICK_SIM.conditionPenalty;
}

function poisson(rng: Rng, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = rng();
  while (p > l) {
    k += 1;
    p *= rng();
  }
  return k;
}

export function quickSimScore(rng: Rng, homeStrength: number, awayStrength: number): { home: number; away: number } {
  const d = QUICK_SIM.perOvr * (homeStrength - awayStrength);
  return {
    home: poisson(rng, QUICK_SIM.base * QUICK_SIM.home * Math.exp(d)),
    away: poisson(rng, (QUICK_SIM.base / QUICK_SIM.home) * Math.exp(-d)),
  };
}
