import type { ClubId, Day, Kc, SeasonNo } from './common';
import type { Tier } from './league';

/** 7.4.1 + 7.4.2 티어별 수치 (KC 정수) */
export interface TierEconomy {
  tier: Tier;
  seasonBudget: Kc;
  salaryCap: Kc;
  winBonus: Kc;
  drawBonus: Kc;
  lossBonus: Kc;
  /** 이월 상한 비율 (0.2) */
  carryRate: number;
  /** 순위 상금 비율: 1위, 2~3위, 4~6위, 7~10위, 11~14위 */
  prizeRates: { p1: number; p2to3: number; p4to6: number; p7to10: number; p11to14: number };
  championRate: number;
}

export type LedgerKind =
  | 'SEASON_BUDGET'
  | 'SALARY'
  | 'MATCH_WIN'
  | 'MATCH_DRAW'
  | 'MATCH_LOSS'
  | 'PRIZE'
  | 'CHAMPION_BONUS'
  | 'CARRY_EXCESS_SPLIT'
  | 'TRANSFER_BUDGET_EXPIRED'
  /** 2.1.1 (M3.3, 경제 설계 4.2 K4): 승격 보너스(새 배정금 30%, Day 1) */
  | 'PROMOTION_BONUS'
  /** 2.1.1: 강등 연봉 전용 계정(Finance.parachute)이 새 캡 초과 연봉을 대신 낸 금액 (+) */
  | 'PARACHUTE';

/** @deprecated 2.1.1 에서 LedgerKind 에 합쳤다. 기존 코드 컴파일용 별칭 */
export type PromotionLedgerKind = 'PROMOTION_BONUS' | 'PARACHUTE';

export interface LedgerEntry {
  season: SeasonNo;
  day: Day;
  kind: LedgerKind;
  /** 수입 +, 지출 − */
  amount: Kc;
  memo?: string;
}

export interface Finance {
  clubId: ClubId;
  /** KC 일반 잔액 */
  balance: Kc;
  /** 이월 상한 초과분 (이적창 한정 예산). Phase 0 은 표시만, Day 3 에 소멸(LP) */
  transferOnlyBudget: Kc;
  ledger: LedgerEntry[];
  /**
   * 2.1.1 (M3.3): 강등 시즌 연봉 전용 계정 잔액. Day 1 = (이전 배정금 − 새 배정금) × 50%,
   * 새 캡을 넘는 연봉분만 일할로 대신 내고 Day 28 소멸. 이월 계산 제외. 없으면 0
   */
  parachute?: Kc;
}

export interface CarryOverResult {
  /** R = 잔액 (+ 예약액, Phase 0 은 0) */
  total: Kc;
  /** C = 다음 시즌 배정금 × 20% */
  cap: Kc;
  carried: Kc;
  excess: Kc;
}

/** 재정 화면(11 C04)용 요약 */
export interface FinanceSummary {
  clubId: ClubId;
  tier: Tier;
  balance: Kc;
  transferOnlyBudget: Kc;
  /** 지출 가능액 B (7.2 시즌 중 정의) */
  spendable: Kc;
  salaryTotal: Kc;
  salaryCap: Kc;
  /** salaryTotal / salaryCap */
  capUsage: number;
  seasonIncome: Kc;
  seasonExpense: Kc;
  /** 지금 시즌이 끝나면 예상되는 이월 판정 */
  projectedCarry: CarryOverResult;
  recent: LedgerEntry[];
}
