/**
 * 8.3 유닛 레이팅 계산. 소유: A.
 * eff(attr) = attr × 5 × FIT_MULT[fit] × conditionEfficiency(condition)
 * 유닛 = 역할 가중치(data/roleWeights.ts)로 가중 평균 → 0~100
 */
import type { EnginePlayer, EngineTacticSlot, Units } from '../types';

export function conditionEfficiency(_condition: number): number {
  throw new Error('TODO');
}

export function computeUnits(_onPitch: readonly EnginePlayer[], _slot: EngineTacticSlot, _redCards: number): Units {
  throw new Error('TODO');
}
