/**
 * 엔진 상수 (기획서 4.2, 4.4, 8.1~8.6 제안 기본값 [PH]). 소유: A.
 * 모든 튜닝 값은 여기(또는 data/ 의 다른 파일)에만 둔다. 로직 파일에 매직 넘버 금지.
 * 값을 바꾸면 ENGINE_VERSION 을 올리고 VALUE 테이블을 다시 만든다(8.7, 8.8).
 */
import type { BinaryDP, ChanceType, DP, FitLevel, OpenPlayChance, RuleId } from '../../types';

export const ENGINE_VERSION = '0.5.0';

/** 8.4 */
export const K = 0.017;
/** 0.5.0: 전술 영향(교차검증 최선−최악) 15~30%p 목표로 0.5 → 0.7. 새 게임·엔진 설정·sim-batch 기본값 (docs/시뮬레이션_검증.md) */
export const DEFAULT_TAC_CAP = 0.7;
export const P_MIN = 0.05;
export const P_MAX = 0.95;
export const HOME_MOD = 0.11;

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
/** 0.4.0: 100 → 73. 0.5.0: 71.5 (오픈 플레이 xG × 0.915 와 함께 리그 득점 2.6~3.0 유지) */
export const BASE_SEQUENCES = 71.5;
/**
 * 0.4.0 추가시간: 세그먼트 9(40-45)·18(85-90)의 시퀀스 배수 (1 + 추가 분/5). 이벤트는 "45+2", "90+4" 로 표기
 */
export const STOPPAGE: Record<number, number> = { 8: 1 + 2.5 / 5, 17: 1 + 5.5 / 5 };
/** 0.4.0 후반 개방도: 세그먼트 s(1-based) ≥ 10 에서 DP4·DP7 BASE + perSeg × (s − 9) */
export const LATE_DRIFT = { fromSeg: 10, perSeg: 0.035 } as const;
/** 0.4.0 경기 흐름: 60분 이후 지는 팀 공격 DP +trail, 상대 역습(DP6·7) +trail, 이기는 팀 공격 DP +lead. 2골 차 이상 × multiGoal */
export const STATE_MOD = { fromMinute: 60, trail: 0.04, counterVsTrail: 0.06, lead: -0.04, multiGoal: 0.5 } as const;
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
  CROSS: 0.0549,
  THROUGH: 0.1894,
  CUTBACK: 0.1244,
  LONG: 0.0256,
  SOLO: 0.0805,
  COUNTER: 0.1528,
  CORNER: 0.07,
  FK: 0.09,
  PK: 0.72,
};
/** 중거리 DP4 BASE 보정 */
export const LONG_SHOT_DP4_BONUS = 0.6;
/** 박스 내 찬스 중 PK 비율 */
export const PK_SHARE_IN_BOX = 0.028;
/** DP5: logit(xG) + FIN_GK_K × (FIN − GK) */
export const FIN_GK_K = 0.015;
export const GOAL_P_MIN = 0.01;
export const GOAL_P_MAX = 0.85;

/** 0.4.0 표시 판정 (별도 RNG, 결과 불변): 비골 슈팅의 유효슈팅 확률 */
export const SOT_Q: Record<ChanceType, number> = {
  CROSS: 0.22,
  THROUGH: 0.38,
  CUTBACK: 0.3,
  LONG: 0.26,
  SOLO: 0.3,
  COUNTER: 0.34,
  CORNER: 0.18,
  FK: 0.28,
  PK: 0.9,
};
/** 표시 판정: 빗나간 슈팅이 코너가 되는 확률, 실패한 스루·역습의 오프사이드 표기 확률 */
export const DISPLAY = { blockedCorner: 0.25, throughOffside: 0.35, counterOffside: 0.2 } as const;
/** 표시 판정: 시간 가중 점유 = 1 + reset × 리셋 + advance × 성공 전진, 패스 길게 × (1 − direct × directness), 짧게 × (1 + short × |directness|) */
export const POSSESSION_WEIGHT = { reset: 3, advance: 0.5, direct: 0.2, short: 0.15, mentality: 0.12 } as const;
/** 0.4.0 경고: 파울 기회(수비 성공한 DP1·DP2·DP4·DP7)마다 p = base × 역할 경고 배수 × (1 + press × max(압박,0)) × 지는 팀(60분+) × 원정 */
export const CARD = { base: 0.039, perPress: 0.15, trailing: 1.2, away: 1.1, booked: 0.3, spread: 0.4 } as const;

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
  /** 0.4.0 스타일 체력 공식: + tempo × max(템포,0) − lowPress × max(−압박,0) − lowLine × max(−라인,0) */
  tempoDrainPerStep: 1,
  lowPressRelief: 1,
  lowLineRelief: 1,
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
  redCardPerTeamMatch: 0.02,
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

/** 8.6 규칙 수치 (0.5.0 재보정: cap 0.7, 9×9 스타일 행렬 2,000경기/쌍 탐색, 실축구_전술설계 2.2) */
export const RULES = {
  R1: { perPressStep: -0.051, max: -1.0, dp8PerPress: -0.277, dp6CounterBonus: 0.542, resistPer: 0.143, resistMax: 3, threeBackMult: 0.7, pressingFwdPrs: 3, pressingFwdDp6: 0.1, dp5Counter: 0.09, pressingFwdDp1: 0 },
  R2: { perDirectStep: 2.044, max: 0.952, dp3Through: 0.319, paceScale: 4, paceMin: 0.3, paceMax: 1.6, sweeperFast: 0.5, sweeperSlow: 0.75, sweeperFastPace: 10, threeBackMult: 0.894, deepBlockPerStep: -0.04, dp5: 0.342 },
  R3: { dp4: -4.625, compBase: 0.6, compScale: 25, compMin: 0.4, compMax: 1.2, dp3LongCross: 3.461, crossAer: 6.512, aerScale: 10, dp5Long: 0.3, dp2PerDeepLine: 0.443, dp5Box: 1.89 },
  R4: { dp3: 0.1, dp4: 0.7, negMult: 0.11, threshold: 0.2, widthStep: 0.4, narrowStep: 0.25, dp5: 0.48 },
  R5: { dp6: 1.905, dp7: 3.415, paceScale: 2.5, dp4PerMentality: 0.234, anchor: 0.487, ballWinner: 0.2, inverted: 0.15, rdMin: 0.4, dp5: 0.14 },
  R6: { dp4Through: -3.93, dp5Bonus: 0.4, dp5Pace: 15, deepMult: 0.6, slowCbMult: 0.5, cbPaceOk: 13 },
  R7: { dp2: 0.427, dp8: 0.09, scale: 1.137, coverShadow: 0.366, coverShadowPress: 0.7, narrowWideMid: 0.5, compression: 0.332, fitBU: 65 },
  R9: { perMarkFit: -0.6, minUnitWeight: 0.15, markerOtherUnitMult: 0.8 },
  R10: { dp4: 0.7, tanhScale: 10 },
  R11: { dp2: 0.096, dp3: 0.2, dp4: 0.171, offset: 0.904, fiveBack: 2.298, threeBack: 0.227, cfScale: 60, cfMin: 0.5, dp5: 0.283, doublePivot: 0.877 },
  R12: { dp7: 1.927, dp4: 0.32, d1Scale: 3, wbDefHigh: 0.4, d1Offset: 2.422, dp5: 0.263, wbMult: 2 },
  R13: { dp1: 0.248, dp2: 0.384, scale: 10, vsPress: 2.5, sbPerRole: 5, threeBackMult: 0.676, aerOffset: 0.86, dp5: 0.226 },
  TEMPO: { dp8PerStep: 0.1 },
  LINE_FIT: { penalty: -0.972, paceDRequired: 60, cbPaceRequired: 11 },
} as const;

/** 8.3-4 스쿼드-전술 적합도 요구치 (StyleDef.requirements 와 같은 값) */
export const FIT_REQUIREMENTS = {
  pressPlus2PRS: 65,
  linePlus2PACE_D: 60,
  passShortBU: 60,
  widthPlus2Side: 60,
  positionalBU: 65,
  lowBlockBOX: 65,
} as const;

/** DP 별로 어떤 규칙이 개입할 수 있는가 (0.5.0: DP5 찬스 질 규칙 추가) — rules.ts 구현과 테스트의 기준 */
export const RULES_BY_DP: Record<DP, RuleId[]> = {
  DP1: ['R1', 'R2', 'R13'],
  DP2: ['R2', 'R3', 'R7', 'R9', 'R11', 'R13'],
  DP3: ['R2', 'R3', 'R4', 'R11'],
  DP4: ['R3', 'R4', 'R5', 'R6', 'R9', 'R10', 'R11', 'R12', 'LINE_FIT'],
  DP5: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R11', 'R12', 'R13'],
  DP6: ['R1', 'R5'],
  DP7: ['R5', 'R12', 'LINE_FIT'],
  DP8: ['R1', 'R7', 'TEMPO'],
};

export const TAC_CAP_OPTIONS = [0.25, 0.35, 0.5, 0.6, 0.7] as const;
