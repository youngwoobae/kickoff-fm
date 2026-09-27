/**
 * 엔진 상수 (기획서 4.2, 4.4, 8.1~8.6 제안 기본값 [PH]). 소유: A.
 * 모든 튜닝 값은 여기(또는 data/ 의 다른 파일)에만 둔다. 로직 파일에 매직 넘버 금지.
 * 값을 바꾸면 ENGINE_VERSION 을 올리고 VALUE 테이블을 다시 만든다(8.7, 8.8).
 */
import type { BinaryDP, ChanceType, DP, FitLevel, OpenPlayChance, RuleId } from '../../types';

export const ENGINE_VERSION = '0.2.0';

/** 8.4 */
export const K = 0.017;
export const DEFAULT_TAC_CAP = 0.35;
export const P_MIN = 0.05;
export const P_MAX = 0.95;
export const HOME_MOD = 0.04;

export const BASE: Record<Exclude<BinaryDP, 'DP5' | 'DP8'>, number> = {
  DP1: 1.1,
  DP2: -0.45,
  DP4: -1.0,
  DP6: -1.7,
  DP7: -0.3,
};
/** DP8 리셋 판정 BASE (구역별) */
export const BASE_RST = { z0: -0.4, z1: -0.62 } as const;
export const MAX_RESETS_PER_SEQUENCE = 2;

/** prepMod = moraleMod + famMod, 범위 [−0.09, +0.04] */
export const MORALE_STEP_MOD = 0.02;
export const FAM_MOD_MAX_PENALTY = 0.05;
/** famCoef = 0.5 + 0.5 × familiarity/100 (긍정 가산치에만) */
export const FAM_COEF_MIN = 0.5;

/** 8.2 경기 구조 */
export const SEGMENTS = 18;
export const SEGMENT_MINUTES = 5;
export const BASE_SEQUENCES = 100;
/** 템포 평균 −2..+2 → 0.85..1.15 */
export const TEMPO_FACTOR_PER_STEP = 0.075;
export const SEQUENCE_JITTER = 0.08;

/** 8.5 찬스 유형 */
export const CHANCE_BASE_WEIGHT: Record<OpenPlayChance, number> = {
  CROSS: 0.25,
  THROUGH: 0.2,
  CUTBACK: 0.2,
  LONG: 0.2,
  SOLO: 0.15,
};
export const CHANCE_XG: Record<ChanceType, number> = {
  CROSS: 0.068,
  THROUGH: 0.235,
  CUTBACK: 0.155,
  LONG: 0.032,
  SOLO: 0.1,
  COUNTER: 0.19,
  CORNER: 0.032,
  FK: 0.05,
  PK: 0.76,
};
/** 중거리 DP4 BASE 보정 */
export const LONG_SHOT_DP4_BONUS = 0.6;
/** 박스 내 찬스 중 PK 비율 */
export const PK_SHARE_IN_BOX = 0.025;
/** DP5: logit(xG) + FIN_GK_K × (FIN − GK) */
export const FIN_GK_K = 0.015;
export const GOAL_P_MIN = 0.01;
export const GOAL_P_MAX = 0.85;

/** Z2(DP4) 실패 분기: 코너 / 프리킥 / 턴오버 (크로스 유형은 코너 ↑) */
export const Z2_FAIL_BRANCH: Record<'DEFAULT' | 'CROSS', { corner: number; freeKick: number; turnover: number }> = {
  DEFAULT: { corner: 0.15, freeKick: 0.05, turnover: 0.8 },
  CROSS: { corner: 0.25, freeKick: 0.05, turnover: 0.7 },
};

/** R10 측면 분배 (좌/중/우) */
export const SIDE_SPLIT_DEFAULT = { L: 0.35, C: 0.3, R: 0.35 } as const;
export const SIDE_SPLIT_TARGETED = { target: 0.55, center: 0.25, opposite: 0.2 } as const;

/** 4.1 포지션 적합도 효율 배수 */
export const FIT_MULT: Record<FitLevel, number> = {
  NATURAL: 1.0,
  ACCOMPLISHED: 0.95,
  CAPABLE: 0.88,
  UNSUITED: 0.75,
};

/** 4.2 컨디션 */
export const CONDITION = {
  fullMatchDrain: 30,
  pressDrainPerStep: 3,
  roleDrainB2B: 3,
  markerExtraDrain: 4,
  dailyRecoveryBase: 14,
  /** 체력 능력치 1..20 → 0..6 */
  dailyRecoveryStaminaMax: 6,
  autoRotationBelow: 70,
  autoSubDefault: 55,
  /** ≥ 90: 1.00, 90→60 선형 1.00→0.85, < 60: 0.80 */
  effFullAt: 90,
  effLinearLowAt: 60,
  effAtLinearLow: 0.85,
  effBelowLow: 0.8,
  injuryBaseRate: 0.008,
  injuryLowConditionMult: 2,
  injuryLowConditionBelow: 60,
  /** [PH] 기획서 미정의: 부상 기간 1~7일 균등 */
  injuryDaysMin: 1,
  injuryDaysMax: 7,
  /** [PH] 기획서 미정의: 팀당 경기당 퇴장 확률 */
  redCardPerTeamMatch: 0.06,
  /** [PH] 퇴장 시 해당 팀 모든 유닛 배수 */
  tenMenUnitMult: 0.9,
} as const;

/** 4.4-4 숙련도 */
export const FAMILIARITY = {
  usedGain: 6,
  unusedDailyDecay: 2,
  formationChangeMult: 0.5,
} as const;

/** 교체 (4.3) */
export const MAX_SUBS = 5;
export const SUB_WINDOWS = 3;

/** 8.6 규칙 수치 */
export const RULES = {
  R1: { perPressStep: -0.2, max: -0.35, dp6CounterBonus: 0.2 },
  R2: { perDirectStep: 0.2, max: 0.35, dp3Through: 0.3, sweeperMult: 0.5 },
  R3: { dp4: -0.35, dp3LongCross: 0.3, targetManCross: 0.2 },
  R4: { dp4: 0.3, dp3: 0.3 },
  R5: { dp6: 0.5, dp7: 0.35, paceScale: 10, anchorMult: 0.6 },
  R6: { dp4Through: -0.35, dp4ThroughSkilled: -0.2, skilledThreshold: 15, dp5Bonus: 0.15 },
  R7: { perMid: 0.05, max: 0.1, dp8Reset: 0.08 },
  R9: { perMarkFit: -0.2, minUnitWeight: 0.15, markerOtherUnitMult: 0.8 },
  R10: { dp4: 0.25, tanhScale: 10 },
  TEMPO: { dp8PerStep: 0.05 },
  LINE_FIT: { penalty: -0.2, paceDRequired: 60 },
} as const;

/** 8.3-4 스쿼드-전술 적합도 요구치 */
export const FIT_REQUIREMENTS = {
  pressPlus2PRS: 65,
  linePlus2PACE_D: 60,
  passShortBU: 60,
  widthPlus2Side: 60,
} as const;

/** DP 별로 어떤 규칙이 개입할 수 있는가 (8.2 표) — rules.ts 구현과 테스트의 기준 */
export const RULES_BY_DP: Record<DP, RuleId[]> = {
  DP1: ['R1', 'R2'],
  DP2: ['R7', 'R9'],
  DP3: ['R2', 'R3', 'R4'],
  DP4: ['R3', 'R4', 'R6', 'R9', 'R10', 'LINE_FIT'],
  DP5: ['R6', 'R9'],
  DP6: ['R1', 'R5'],
  DP7: ['R5', 'LINE_FIT'],
  DP8: ['R7', 'TEMPO'],
};

export const TAC_CAP_OPTIONS = [0.25, 0.35, 0.5] as const;
