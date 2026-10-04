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

export const SEASON_DAYS = 28;

/** 경제 설계 3.2 (K1) [PH]: S(OVR) = S_REF × 1.55^((OVR − 60) / TIER_GAP), 1,000 KC 반올림 */
export const S_REF = 3.0 * M;
export const TIER_GAP = 6;
export function baseSalary(ovr: number): Kc {
  return Math.round((S_REF * Math.pow(1.55, (ovr - 60) / TIER_GAP)) / 1000) * 1000;
}

/** 경제 설계 8장 (K14, M5.1) [PH]: 유스 연봉 = max(0.2M, 0.9 × S(OVR)), 1,000 KC 반올림 */
export function youthSalary(ovr: number): Kc {
  return Math.max(0.2 * M, Math.round((0.9 * baseSalary(ovr)) / 1000) * 1000);
}

/** 경제 설계 3.3 (K3): 새 게임 시작 잔액 = 배정금 × 이월 비율(20%), 모든 구단 */
export function startingBalance(econ: TierEconomy): Kc {
  return Math.round(econ.seasonBudget * econ.carryRate);
}

/** 경제 설계 4.2 (K4) [PH]: 승격 보너스 = 새 티어 배정금 × 30% (Day 1) */
export const PROMOTION_BONUS_RATE = 0.3;
/** K4 [PH]: 강등 연봉 전용 계정 = (이전 배정금 − 새 배정금) × 50%, 새 캡 초과 연봉만, Day 28 소멸 */
export const PARACHUTE_RATE = 0.5;

export function promotionBonus(to: Tier): Kc {
  return Math.round(TIER_ECONOMY[to].seasonBudget * PROMOTION_BONUS_RATE);
}

export function parachuteOf(from: Tier, to: Tier): Kc {
  return Math.max(0, Math.round((TIER_ECONOMY[from].seasonBudget - TIER_ECONOMY[to].seasonBudget) * PARACHUTE_RATE));
}

/** 일할 연봉 = round(salaryTotal / 28). 28일 합계 오차는 Day 28 에 보정 */
export function dailySalary(salaryTotal: Kc, day: number): Kc {
  const per = Math.round(salaryTotal / SEASON_DAYS);
  if (day >= SEASON_DAYS) return salaryTotal - per * (SEASON_DAYS - 1);
  return per;
}

export function matchBonus(econ: TierEconomy, goalsFor: number, goalsAgainst: number): Pick<LedgerEntry, 'kind' | 'amount'> {
  if (goalsFor > goalsAgainst) return { kind: 'MATCH_WIN', amount: econ.winBonus };
  if (goalsFor === goalsAgainst) return { kind: 'MATCH_DRAW', amount: econ.drawBonus };
  return { kind: 'MATCH_LOSS', amount: econ.lossBonus };
}

export function prizeRate(econ: TierEconomy, position: number): number {
  const r = econ.prizeRates;
  if (position <= 1) return r.p1;
  if (position <= 3) return r.p2to3;
  if (position <= 6) return r.p4to6;
  if (position <= 10) return r.p7to10;
  return r.p11to14;
}

export function prizeFor(econ: TierEconomy, position: number): { prize: Kc; champion: Kc } {
  return {
    prize: Math.round(econ.seasonBudget * prizeRate(econ, position)),
    champion: position === 1 ? Math.round(econ.seasonBudget * econ.championRate) : 0,
  };
}

/** 6.5 ⑥ 이월 판정: C = 다음 시즌 배정금 × 20% */
export function carryOver(finance: Finance, nextEcon: TierEconomy): CarryOverResult {
  const total = finance.balance;
  const cap = Math.round(nextEcon.seasonBudget * nextEcon.carryRate);
  const carried = Math.min(total, cap);
  return { total, cap, carried, excess: total - carried };
}

/** 7.2 지출 가능액 B (시즌 중): 잔액 − 예약액 − 잔여 연봉 부채 − 확정 위약금 */
export function spendable(balance: Kc, salaryTotal: Kc, daysLeft: number): Kc {
  return balance - Math.round((salaryTotal * Math.max(0, daysLeft)) / SEASON_DAYS);
}

/** 원장 기록 + 잔액 반영 (순수) */
export function postLedger(finance: Finance, entry: LedgerEntry): Finance {
  return { ...finance, balance: finance.balance + entry.amount, ledger: [...finance.ledger, entry] };
}
