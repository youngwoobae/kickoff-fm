/** 최소 경제 (7.4, 7.2, 6.5 ⑥). 소유: A. */
import type { CarryOverResult, Finance, Kc, LedgerEntry, Tier, TierEconomy } from '../../types';

const M = 1_000_000;
const PRIZE_RATES = { p1: 0.2, p2to3: 0.15, p4to6: 0.1, p7to10: 0.06, p11to14: 0.03 };

/** 7.4.1 표 (M KC → KC 정수) */
export const TIER_ECONOMY: Record<Tier, TierEconomy> = {
  T1: { tier: 'T1', seasonBudget: 144.0 * M, salaryCap: 150.0 * M, winBonus: 2.55 * M, drawBonus: 1.02 * M, lossBonus: 0.4 * M, carryRate: 0.2, prizeRates: PRIZE_RATES, championRate: 0.1 },
  T2: { tier: 'T2', seasonBudget: 93.5 * M, salaryCap: 98.0 * M, winBonus: 1.7 * M, drawBonus: 0.68 * M, lossBonus: 0.3 * M, carryRate: 0.2, prizeRates: PRIZE_RATES, championRate: 0.1 },
  T3: { tier: 'T3', seasonBudget: 61.0 * M, salaryCap: 64.0 * M, winBonus: 1.11 * M, drawBonus: 0.43 * M, lossBonus: 0.2 * M, carryRate: 0.2, prizeRates: PRIZE_RATES, championRate: 0.1 },
  T4: { tier: 'T4', seasonBudget: 39.5 * M, salaryCap: 41.0 * M, winBonus: 0.72 * M, drawBonus: 0.3 * M, lossBonus: 0.12 * M, carryRate: 0.2, prizeRates: PRIZE_RATES, championRate: 0.1 },
  T5: { tier: 'T5', seasonBudget: 25.0 * M, salaryCap: 26.0 * M, winBonus: 0.47 * M, drawBonus: 0.17 * M, lossBonus: 0.08 * M, carryRate: 0.2, prizeRates: PRIZE_RATES, championRate: 0.1 },
};

/** 일할 연봉 = round(salaryTotal / 28). 28일 합계 오차는 Day 28 에 보정 */
export function dailySalary(_salaryTotal: Kc, _day: number): Kc {
  throw new Error('TODO');
}

export function matchBonus(_econ: TierEconomy, _goalsFor: number, _goalsAgainst: number): Pick<LedgerEntry, 'kind' | 'amount'> {
  throw new Error('TODO');
}

export function prizeFor(_econ: TierEconomy, _position: number): { prize: Kc; champion: Kc } {
  throw new Error('TODO');
}

/** 6.5 ⑥ 이월 판정: C = 다음 시즌 배정금 × 20% */
export function carryOver(_finance: Finance, _nextEcon: TierEconomy): CarryOverResult {
  throw new Error('TODO');
}

/** 7.2 지출 가능액 B (시즌 중): 잔액 − 예약액 − 잔여 연봉 부채 − 확정 위약금 */
export function spendable(_balance: Kc, _salaryTotal: Kc, _daysLeft: number): Kc {
  throw new Error('TODO');
}
