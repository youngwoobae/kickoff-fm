/**
 * 이적 도메인 기초 (M4.3): 상수·창 일정(D16)·평가가치 V(경제 6.1)·계약 도우미(5.1)·해시 균등값(7장).
 * 순수 함수만. 게임 상태 연결은 M4.4.
 */
import type { GameTime, Kc, Player, ScoutGrade, SeasonNo, TransferWindow, WindowKind } from '../../types';
import { hashString } from '../../engine';
import { baseSalary, SEASON_DAYS } from '../economy/economy';

/** [PH] 경제 설계 6·7장 수치 */
export const TRANSFER = {
  window: {
    MID: { openDay: 11, settleDay: 15, npcPerTier: 2 },
    REGULAR: { openDay: 25, settleDay: 2, npcPerTier: 6 },
  },
  valueMult: 5,
  ageCoef: [[21, 1.3], [27, 1.0], [30, 0.8], [Infinity, 0.5]] as const,
  potCoefPerOvr: 0.03,
  potCoefMax: 0.45,
  contractCoef: { 1: 0.6, 2: 0.85 } as Record<number, number>,
  maxMult: 1.3,
  clubMinMult: 0.7,
  taxRate: 0.1,
  faCompareSalaryRate: 0.5,
  faBonusMaxRate: 1.0,
  signingLimit: 8,
  promotedSigningLimit: 12,
  maxSquad: 25,
  npcOvrHalf: 4,
  npcAge: [19, 30] as const,
  newContractMaxSeasons: 3,
  forcedSaleRate: 0.5,
  /** 음수 첫날 처리 = 1일째. 3일째 처리 뒤(since + 2)에도 음수면 강제 매각 */
  forcedSaleAfterDays: 2,
  /** D17: 동률 시 최상위 티어보다 낮은 티어 구단 가중 */
  lowerTierWeight: 2,
  /** 동률 판정 단위 */
  tieUnit: 1000,
} as const;

/** scoutRange 등급 → OVR 구간 [PH]. scoutGrade 경계(50·58·65·72·80)와 맞춤, 바깥 끝은 40·90 */
const GRADE_BAND: Record<ScoutGrade, [number, number]> = {
  E: [40, 49], D: [50, 57], C: [58, 64], B: [65, 71], A: [72, 79], S: [80, 90],
};

/** 해시 균등값 h(keys) ∈ [0, 1) (경제 7장: 순서 무관 결정) */
export function h(...keys: readonly (string | number)[]): number {
  return hashString(keys.join('|')) / 0x100000000;
}

export const round1k = (x: number): Kc => Math.round(x / 1000) * 1000;

/** 금액 표시 (메시지용, UI formatKc 도 services 경유로 이것을 쓴다) — 12.75M, 1M 미만은 40K, 음수는 − */
export const fmtM = (kc: Kc): string => {
  const a = Math.abs(kc);
  const s = kc < 0 ? '−' : '';
  return a >= 1_000_000 ? `${s}${(a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 2)}M` : a >= 1_000 ? `${s}${(a / 1_000).toFixed(0)}K` : `${s}${a}`;
};

// ── 창 일정 (D16) ──

export function windowOf(season: SeasonNo, kind: WindowKind): TransferWindow {
  const w = TRANSFER.window[kind];
  return { kind, season, openDay: w.openDay, settleDay: w.settleDay, settleSeason: kind === 'REGULAR' ? season + 1 : season };
}

export function isSettleDay(t: GameTime, w: TransferWindow): boolean {
  return t.season === w.settleSeason && t.day === w.settleDay;
}

/** 정산 뒤 그 시즌에 남은 일수 (FA 예약 연봉 일할) */
export function daysAfterSettle(w: TransferWindow): number {
  return SEASON_DAYS - w.settleDay;
}

// ── 평가가치 V (6.1) ──

/** 공개 잠재력 추정 = scoutRange 등급 구간의 중간값 (숨김 potential 은 쓰지 않는다) */
export function potentialEstimate(range: readonly [ScoutGrade, ScoutGrade]): number {
  return (GRADE_BAND[range[0]][0] + GRADE_BAND[range[1]][1]) / 2;
}

export function ageCoef(age: number): number {
  return TRANSFER.ageCoef.find(([max]) => age <= max)![1];
}

export function potentialCoef(ovr: number, potEstimate: number): number {
  return 1 + Math.min(TRANSFER.potCoefMax, TRANSFER.potCoefPerOvr * Math.max(0, potEstimate - ovr));
}

/** 계약 잔여 계수. FA·NPC 는 seasonsLeft 3 으로 넘긴다 */
export function contractCoef(seasonsLeft: number): number {
  return TRANSFER.contractCoef[seasonsLeft] ?? 1.0;
}

export interface ValueInput {
  ovr: number;
  age: number;
  seasonsLeft: number;
  potEstimate: number;
}

/** V = 5 × S(ovr) × 나이 × 잠재력 × 계약잔여, 1,000 KC 반올림 */
export function valueOf(x: ValueInput): Kc {
  return round1k(TRANSFER.valueMult * baseSalary(x.ovr) * ageCoef(x.age) * potentialCoef(x.ovr, x.potEstimate) * contractCoef(x.seasonsLeft));
}

/** 선수의 V. free = FA·NPC(계약 잔여 3시즌 취급) */
export function playerValue(p: Pick<Player, 'ovr' | 'age' | 'scoutRange' | 'contract'>, free = false): Kc {
  return valueOf({ ovr: p.ovr, age: p.age, seasonsLeft: free ? 3 : p.contract.seasonsLeft, potEstimate: potentialEstimate(p.scoutRange) });
}

/**
 * 지출 가능액 B (경제 7.2). 시즌 중: incoming 0, salaryDebt = 남은 연봉.
 * 오프시즌(정규 창): incoming = 다음 배정금 + 승격 보너스(Day 1 전), salaryDebt = 이번 시즌 남은 연봉 + 다음 시즌 연봉 부채.
 * reserved 는 넣지 않는다(입찰 검증·정산이 따로 뺀다).
 */
export function budgetB(x: { balance: Kc; transferOnly?: Kc; incoming?: Kc; salaryDebt: Kc; penalties?: Kc }): Kc {
  return x.balance + (x.transferOnly ?? 0) + (x.incoming ?? 0) - x.salaryDebt - (x.penalties ?? 0);
}
