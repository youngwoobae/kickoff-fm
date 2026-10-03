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
  | 'TRANSFER_BUDGET_EXPIRED';

/**
 * 2.1.0 (경제 설계 4.2·14장): 승격 보너스, 강등 낙하산(연봉 전용 계정).
 * 아직 LedgerKind 에 합치지 않는다 — UI `LEDGER_LABEL: Record<LedgerKind, string>`(src/ui/format.ts)이 키 누락으로
 * 컴파일 실패하기 때문. 처음 기록하는 단위(M3.3)가 UI 라벨 두 줄(M3.5 소유)과 같은 변경에서
 * `LedgerKind = … | PromotionLedgerKind` 로 합친다(아키텍처 16장 2.1.0).
 */
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
