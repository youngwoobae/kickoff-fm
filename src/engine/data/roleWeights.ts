/**
 * 역할 정의(4.4-2, 실축구_전술설계 3장)와 유닛 가중치 파일(8.3-2, 기획서의 roleWeights.json 에 해당). 소유: A.
 * 유닛 = Σ(역할 가중치 × 선수 유효 능력 믹스) / Σ 역할 가중치  → 0~100
 */
import type { AttrKey, OpenPlayChance, RoleDef, RoleId, UnitKey } from '../../types';

export type AttrMix = Partial<Record<AttrKey, number>>;

/** 좌우가 없는 유닛. SIDE_A/SIDE_D 는 레인별로 따로 계산, GK/SPA/SPD 는 별도 공식 */
export type CoreUnit = Exclude<UnitKey, 'SIDE_A_L' | 'SIDE_A_R' | 'SIDE_D_L' | 'SIDE_D_R' | 'GK' | 'SPA' | 'SPD'>;
export type WeightedUnit = CoreUnit | 'SIDE_A' | 'SIDE_D';

/** 유닛별 능력치 믹스 (필드 선수) */
export const UNIT_MIX: Record<WeightedUnit, AttrMix> = {
  BU: { passing: 0.45, composure: 0.3, vision: 0.25 },
  PRG: { passing: 0.35, vision: 0.25, dribbling: 0.25, pace: 0.15 },
  CRE: { vision: 0.3, passing: 0.25, dribbling: 0.25, crossing: 0.2 },
  FIN: { finishing: 0.5, composure: 0.3, positioning: 0.2 },
  PRS: { workRate: 0.4, pace: 0.3, tackling: 0.3 },
  MID: { tackling: 0.4, positioning: 0.35, workRate: 0.25 },
  BOX: { tackling: 0.35, positioning: 0.35, physical: 0.3 },
  CTRL: { passing: 0.5, vision: 0.3, composure: 0.2 },
  AER_A: { physical: 0.7, positioning: 0.3 },
  AER_D: { physical: 0.6, positioning: 0.4 },
  PACE_A: { pace: 0.8, dribbling: 0.2 },
  PACE_D: { pace: 0.7, positioning: 0.3 },
  SIDE_A: { pace: 0.4, dribbling: 0.3, crossing: 0.3 },
  SIDE_D: { pace: 0.4, tackling: 0.3, positioning: 0.3 },
};

/** GK 가 참여하는 유닛은 GK 전용 믹스를 쓴다 */
export const GK_UNIT_MIX: Partial<Record<WeightedUnit, AttrMix>> = {
  BU: { kicking: 0.7, composure: 0.3 },
  BOX: { aerialCommand: 0.5, positioning: 0.5 },
  AER_D: { aerialCommand: 1 },
  PACE_D: { pace: 0.6, kicking: 0.4 },
  CTRL: { kicking: 1 },
};

export const GK_SAVE_MIX: AttrMix = { reflexes: 0.7, positioning: 0.3 };
/** DP5 슈터 마무리 능력 FIN_슈터 (8.4) */
export const SHOOTER_MIX: AttrMix = { finishing: 0.5, composure: 0.3, positioning: 0.2 };
/** 세트피스: SPA = 키커 크로스 × 0.5 + AER_A × 0.5, SPD = AER_D × 0.6 + GK 공중 장악 × 0.4 */
export const SET_PIECE = { takerShare: 0.5, spdAerShare: 0.6 } as const;

/** 역할 × 유닛 가중치 (8.3 표 + 실축구_전술설계 3.2 [PH]) */
export const ROLE_UNIT_WEIGHTS: Record<RoleId, Partial<Record<WeightedUnit, number>>> = {
  GK_TRADITIONAL: { BU: 0.25, BOX: 0.2, AER_D: 0.5 },
  GK_SWEEPER: { BU: 0.45, BOX: 0.15, AER_D: 0.35, PACE_D: 0.3 },
  CB_STOPPER: { BU: 0.6, MID: 0.15, BOX: 1.0, CTRL: 0.1, AER_D: 1.0, PACE_D: 1.0, SIDE_D: 0.3 },
  CB_BALL_PLAYING: { BU: 1.0, PRG: 0.2, BOX: 0.85, CTRL: 0.3, AER_D: 0.8, PACE_D: 1.0, SIDE_D: 0.3 },
  FB_DEFENSIVE: { BU: 0.4, PRG: 0.2, PRS: 0.3, BOX: 0.7, CTRL: 0.1, AER_D: 0.3, PACE_D: 0.8, SIDE_A: 0.4, SIDE_D: 1.0 },
  FB_OVERLAPPING: { BU: 0.4, PRG: 0.6, CRE: 0.3, PRS: 0.4, BOX: 0.4, PACE_A: 0.3, PACE_D: 0.6, SIDE_A: 1.0, SIDE_D: 0.6 },
  DM_ANCHOR: { BU: 0.8, PRG: 0.3, MID: 1.0, BOX: 0.4, CTRL: 0.8, PRS: 0.3, AER_D: 0.3, PACE_D: 0.2 },
  CM_BOX_TO_BOX: { BU: 0.4, PRG: 1.0, CRE: 0.3, FIN: 0.2, MID: 0.8, CTRL: 0.8, PRS: 0.6 },
  AM_PLAYMAKER: { PRG: 0.8, CRE: 1.0, FIN: 0.4, CTRL: 0.6, PRS: 0.4 },
  W_WINGER: { PRG: 0.5, CRE: 0.8, FIN: 0.3, PRS: 0.6, PACE_A: 0.8, SIDE_A: 1.0, SIDE_D: 0.3 },
  W_INSIDE_FORWARD: { PRG: 0.5, CRE: 0.8, FIN: 0.7, PRS: 0.6, PACE_A: 0.6, SIDE_A: 0.7, SIDE_D: 0.2 },
  ST_TARGET: { CRE: 0.3, FIN: 1.0, PRS: 0.6, AER_A: 1.0, PACE_A: 0.3 },
  ST_POACHER: { CRE: 0.3, FIN: 1.0, PRS: 0.6, AER_A: 0.5, PACE_A: 1.0 },
  ST_FALSE_NINE: { PRG: 0.4, CRE: 0.8, FIN: 0.7, PRS: 0.6, CTRL: 0.3, AER_A: 0.3, PACE_A: 0.5 },
  // ── 0.4.0 새 역할 ──
  CB_COVER: { BU: 0.6, PRG: 0.1, MID: 0.2, BOX: 0.9, CTRL: 0.1, AER_D: 0.7, PACE_D: 1.3, SIDE_D: 0.4 },
  FB_INVERTED: { BU: 0.8, PRG: 0.5, CRE: 0.1, PRS: 0.3, MID: 0.4, BOX: 0.5, CTRL: 0.5, AER_D: 0.2, PACE_D: 0.6, SIDE_A: 0.3, SIDE_D: 0.7 },
  WB_WINGBACK: { BU: 0.3, PRG: 0.7, CRE: 0.5, FIN: 0.1, PRS: 0.4, BOX: 0.3, AER_D: 0.2, PACE_A: 0.4, PACE_D: 0.5, SIDE_A: 1.2, SIDE_D: 0.7 },
  DM_REGISTA: { BU: 1.2, PRG: 0.6, CRE: 0.3, PRS: 0.2, MID: 0.5, BOX: 0.3, CTRL: 1.0, AER_D: 0.2, PACE_D: 0.1 },
  DM_BALL_WINNER: { BU: 0.4, PRG: 0.2, PRS: 0.8, MID: 1.2, BOX: 0.5, CTRL: 0.3, AER_D: 0.4, PACE_D: 0.3, SIDE_D: 0.2 },
  CM_MEZZALA: { BU: 0.3, PRG: 1.1, CRE: 0.7, FIN: 0.3, PRS: 0.5, MID: 0.4, CTRL: 0.5, PACE_A: 0.2, SIDE_A: 0.3, SIDE_D: 0.2 },
  CM_DEEP_PLAYMAKER: { BU: 1.0, PRG: 0.8, CRE: 0.3, FIN: 0.1, PRS: 0.3, MID: 0.5, BOX: 0.2, CTRL: 1.0 },
  AM_TREQUARTISTA: { PRG: 0.8, CRE: 1.3, FIN: 0.5, PRS: 0.1, CTRL: 0.5, PACE_A: 0.3 },
  AM_SHADOW_STRIKER: { PRG: 0.4, CRE: 0.6, FIN: 1.0, PRS: 0.5, CTRL: 0.2, AER_A: 0.3, PACE_A: 0.7 },
  AM_ENGANCHE: { PRG: 0.6, CRE: 1.3, FIN: 0.3, CTRL: 0.8 },
  W_INVERTED_WINGER: { PRG: 0.6, CRE: 1.0, FIN: 0.5, PRS: 0.5, CTRL: 0.3, PACE_A: 0.5, SIDE_A: 0.8, SIDE_D: 0.2 },
  W_WIDE_MIDFIELDER: { BU: 0.2, PRG: 0.5, CRE: 0.5, FIN: 0.2, PRS: 0.7, MID: 0.4, BOX: 0.2, CTRL: 0.2, PACE_A: 0.5, PACE_D: 0.2, SIDE_A: 0.8, SIDE_D: 0.9 },
  ST_PRESSING_FORWARD: { PRG: 0.2, CRE: 0.3, FIN: 0.8, PRS: 1.2, MID: 0.2, AER_A: 0.4, PACE_A: 0.6 },
  ST_ADVANCED_FORWARD: { PRG: 0.3, CRE: 0.4, FIN: 1.0, PRS: 0.3, AER_A: 0.4, PACE_A: 1.1 },
};

/**
 * 역할 형태값 (실축구_전술설계 3.3 [PH]). 엔진 내부 데이터.
 * cA/cD 중앙 공격 점유·수비 커버, wA/wD 측면 공격·수비 인원(슬롯 레인에만, 중앙 레인은 양쪽에 절반),
 * hs/hsC 하프스페이스 점유·커버, run 러너(뒷공간 침투), deep 2선 침투, drain 체력 추가, card 경고 배수
 */
export interface RoleShape {
  cA: number;
  cD: number;
  wA: number;
  wD: number;
  hs: number;
  hsC: number;
  run: 0 | 1;
  deep: 0 | 1;
  drain: number;
  card: number;
}

function sh(cA: number, cD: number, wA: number, wD: number, hs: number, hsC: number, run: 0 | 1, deep: 0 | 1, drain: number, card: number): RoleShape {
  return { cA, cD, wA, wD, hs, hsC, run, deep, drain, card };
}

export const ROLE_SHAPE: Record<RoleId, RoleShape> = {
  GK_TRADITIONAL: sh(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3),
  GK_SWEEPER: sh(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3),
  CB_STOPPER: sh(0, 0.2, 0, 0.1, 0, 0, 0, 0, 0, 1.2),
  CB_BALL_PLAYING: sh(0.1, 0.2, 0, 0.1, 0, 0, 0, 0, 0, 1.0),
  CB_COVER: sh(0, 0.2, 0, 0.2, 0, 0.3, 0, 0, 0, 1.0),
  FB_DEFENSIVE: sh(0, 0.1, 0.3, 1.0, 0, 0, 0, 0, 0, 1.0),
  FB_OVERLAPPING: sh(0, 0, 0.9, 0.6, 0, 0, 0, 0, 1, 1.0),
  FB_INVERTED: sh(0.6, 0.3, 0.2, 0.7, 0.5, 0.2, 0, 0, 0, 1.0),
  WB_WINGBACK: sh(0, 0, 1.0, 0.7, 0, 0, 0, 0, 3, 1.0),
  DM_ANCHOR: sh(0.8, 1.0, 0, 0, 0, 1.0, 0, 0, 0, 1.1),
  DM_REGISTA: sh(1.0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.9),
  DM_BALL_WINNER: sh(0.5, 1.0, 0, 0.1, 0, 0.8, 0, 0, 2, 1.4),
  CM_BOX_TO_BOX: sh(1.0, 0.8, 0, 0.1, 0.3, 0.3, 0, 1, 3, 1.1),
  CM_MEZZALA: sh(0.7, 0.5, 0.2, 0.2, 1.0, 0.2, 0, 1, 1, 1.0),
  CM_DEEP_PLAYMAKER: sh(1.0, 0.6, 0, 0, 0.2, 0.3, 0, 0, 0, 0.9),
  AM_PLAYMAKER: sh(1.0, 0.3, 0, 0, 0.5, 0, 0, 0, 0, 0.8),
  AM_TREQUARTISTA: sh(1.0, 0.1, 0, 0, 0.7, 0, 0, 0, -1, 0.7),
  AM_SHADOW_STRIKER: sh(0.6, 0.2, 0, 0, 1.0, 0, 1, 1, 1, 0.9),
  AM_ENGANCHE: sh(1.2, 0, 0, 0, 0.3, 0, 0, 0, -1, 0.7),
  W_WINGER: sh(0.1, 0.1, 1.0, 0.4, 0, 0, 1, 0, 1, 0.8),
  W_INSIDE_FORWARD: sh(0.2, 0.1, 0.6, 0.2, 1.0, 0, 1, 0, 1, 0.8),
  W_INVERTED_WINGER: sh(0.3, 0.1, 0.7, 0.3, 0.6, 0, 0, 0, 1, 0.8),
  W_WIDE_MIDFIELDER: sh(0.1, 0.2, 0.8, 1.048, 0, 0, 0, 0, 2, 1.0),
  ST_POACHER: sh(0, 0, 0, 0, 0.2, 0, 1, 0, 0, 0.7),
  ST_TARGET: sh(0, 0.1, 0, 0, 0, 0, 0, 0, 0, 1.1),
  ST_FALSE_NINE: sh(0.6, 0.1, 0, 0, 0.5, 0, 0, 0, 0, 0.7),
  ST_PRESSING_FORWARD: sh(0, 0.3, 0, 0, 0, 0, 0, 0, 3, 1.2),
  ST_ADVANCED_FORWARD: sh(0, 0, 0, 0, 0.3, 0, 1, 0, 0, 0.8),
};

/** 역할별 경기당 체력 소모 가산 (4.2 역할 보정, 3.3 표의 체력 추가) */
export const ROLE_EXTRA_DRAIN: Partial<Record<RoleId, number>> = Object.fromEntries(
  (Object.keys(ROLE_SHAPE) as RoleId[]).filter((r) => ROLE_SHAPE[r].drain !== 0).map((r) => [r, ROLE_SHAPE[r].drain]),
);

/** R1 압박 저항 역할 (빌드업에서 압박을 푸는 역할) */
export const PRESS_RESIST_ROLES: readonly RoleId[] = ['GK_SWEEPER', 'CB_BALL_PLAYING', 'DM_REGISTA', 'CM_DEEP_PLAYMAKER', 'FB_INVERTED'];
/** R12 공격 주체가 되는 측면 역할 */
/** (와이드 미드필더는 1:1 돌파형이 아니라 R12 의 대응 역할이라 제외) */
export const WIDE_ATTACK_ROLES: readonly RoleId[] = ['W_WINGER', 'W_INSIDE_FORWARD', 'W_INVERTED_WINGER'];
/** R12 노출: 올라가는 측면 수비 역할 */
export const ADVANCING_FB_ROLES: readonly RoleId[] = ['WB_WINGBACK', 'FB_OVERLAPPING'];
/** R7 커버 섀도·R5 잔류 수비에 쓰는 피벗 역할 */
export const PIVOT_ROLES: readonly RoleId[] = ['DM_ANCHOR', 'DM_REGISTA', 'DM_BALL_WINNER'];

/** DP3 역할 보정 (8.5): 역할 1명당 가산, 유형별 최대 ±0.3 [PH] */
export const CHANCE_ROLE_ADJ: Record<OpenPlayChance, Partial<Record<RoleId, number>>> = {
  CROSS: { W_WINGER: 0.1, FB_OVERLAPPING: 0.08, ST_TARGET: 0.12, WB_WINGBACK: 0.08, W_WIDE_MIDFIELDER: 0.04, FB_INVERTED: -0.05, W_INSIDE_FORWARD: -0.04 },
  THROUGH: { ST_POACHER: 0.15, ST_FALSE_NINE: 0.05, DM_REGISTA: 0.08, CM_MEZZALA: 0.06, AM_ENGANCHE: 0.12, W_INVERTED_WINGER: 0.05, ST_ADVANCED_FORWARD: 0.1, AM_SHADOW_STRIKER: 0.05 },
  CUTBACK: { W_INSIDE_FORWARD: 0.12, W_WINGER: 0.04, CM_MEZZALA: 0.06, W_INVERTED_WINGER: 0.06, AM_SHADOW_STRIKER: 0.04 },
  LONG: { AM_PLAYMAKER: 0.15, CM_BOX_TO_BOX: 0.05, CM_DEEP_PLAYMAKER: 0.05, W_INVERTED_WINGER: 0.06 },
  SOLO: { AM_TREQUARTISTA: 0.1, ST_ADVANCED_FORWARD: 0.05 },
};
export const CHANCE_ROLE_ADJ_MAX = 0.3;
/** 개인 돌파: 최고 드리블 능력치가 기준을 넘는 만큼 가산 */
export const SOLO_DRIBBLE_THRESHOLD = 14;
export const SOLO_PER_POINT = 0.06;
/** 중앙 측면 선택 시 크로스·컷백 억제 (구조 보정, 전술 아님) */
export const CENTRAL_SIDE_ADJ: Partial<Record<OpenPlayChance, number>> = { CROSS: -0.4, CUTBACK: -0.2 };

/** 슈터 선택 가중치 (찬스 유형 × 역할). 표에 없는 역할은 0.2 */
export const SHOOTER_ROLE_WEIGHT: Record<'CROSS' | 'THROUGH' | 'CUTBACK' | 'LONG' | 'SOLO' | 'COUNTER' | 'CORNER', Partial<Record<RoleId, number>>> = {
  CROSS: { ST_TARGET: 3, ST_POACHER: 2, ST_FALSE_NINE: 1.2, ST_ADVANCED_FORWARD: 1.8, ST_PRESSING_FORWARD: 1.8, AM_SHADOW_STRIKER: 1.2, W_WINGER: 0.6, W_INSIDE_FORWARD: 1, W_INVERTED_WINGER: 0.8, W_WIDE_MIDFIELDER: 0.5, AM_PLAYMAKER: 0.6, CM_BOX_TO_BOX: 0.6, CM_MEZZALA: 0.6, CB_STOPPER: 0.3, CB_BALL_PLAYING: 0.2 },
  THROUGH: { ST_POACHER: 4, ST_TARGET: 1.5, ST_FALSE_NINE: 2, ST_ADVANCED_FORWARD: 3.5, ST_PRESSING_FORWARD: 2.5, AM_SHADOW_STRIKER: 3, W_INSIDE_FORWARD: 2, W_WINGER: 1.2, W_INVERTED_WINGER: 1.2, AM_PLAYMAKER: 1, CM_MEZZALA: 1.2, CM_BOX_TO_BOX: 0.4 },
  CUTBACK: { ST_POACHER: 2, ST_TARGET: 1.5, ST_FALSE_NINE: 2, ST_ADVANCED_FORWARD: 2, ST_PRESSING_FORWARD: 1.8, AM_SHADOW_STRIKER: 2.2, W_INSIDE_FORWARD: 2, W_WINGER: 1, W_INVERTED_WINGER: 1.2, AM_PLAYMAKER: 1.5, AM_TREQUARTISTA: 1.5, CM_MEZZALA: 1.4, CM_BOX_TO_BOX: 0.8 },
  LONG: { AM_PLAYMAKER: 2.5, AM_TREQUARTISTA: 2, AM_ENGANCHE: 1.8, CM_BOX_TO_BOX: 2, CM_MEZZALA: 1.6, CM_DEEP_PLAYMAKER: 1.5, W_INSIDE_FORWARD: 1.2, W_INVERTED_WINGER: 1.6, W_WINGER: 0.8, DM_ANCHOR: 0.8, DM_REGISTA: 1, ST_FALSE_NINE: 1, ST_TARGET: 0.5, ST_POACHER: 0.6, FB_OVERLAPPING: 0.3 },
  SOLO: { W_INSIDE_FORWARD: 2.5, W_WINGER: 2, W_INVERTED_WINGER: 2, AM_PLAYMAKER: 1.5, AM_TREQUARTISTA: 2.5, AM_SHADOW_STRIKER: 1.5, ST_FALSE_NINE: 1.5, ST_POACHER: 1.5, ST_ADVANCED_FORWARD: 2, ST_TARGET: 0.6, CM_MEZZALA: 1, CM_BOX_TO_BOX: 0.5, FB_OVERLAPPING: 0.3 },
  COUNTER: { ST_POACHER: 3, ST_TARGET: 1.5, ST_FALSE_NINE: 2, ST_ADVANCED_FORWARD: 3, ST_PRESSING_FORWARD: 2, AM_SHADOW_STRIKER: 2.2, W_WINGER: 2, W_INSIDE_FORWARD: 2.2, W_INVERTED_WINGER: 1.5, W_WIDE_MIDFIELDER: 1, AM_PLAYMAKER: 1, CM_BOX_TO_BOX: 0.5, WB_WINGBACK: 0.4 },
  CORNER: { CB_STOPPER: 2, CB_BALL_PLAYING: 1.5, CB_COVER: 1.2, ST_TARGET: 2.5, ST_POACHER: 1.2, ST_FALSE_NINE: 0.8, ST_ADVANCED_FORWARD: 1.2, ST_PRESSING_FORWARD: 1.4, DM_ANCHOR: 0.8, DM_BALL_WINNER: 0.9, CM_BOX_TO_BOX: 0.8, FB_DEFENSIVE: 0.3, FB_OVERLAPPING: 0.3, W_WINGER: 0.3, W_INSIDE_FORWARD: 0.5, AM_PLAYMAKER: 0.4 },
};

type RoleText = [position: RoleDef['position'], label: string, keyAttrs: AttrKey[], summary: string, effect: string, fitsIn: string];

/** 역할 28종 설명 (실축구_전술설계 3.1). effect = "경기에서 하는 일" (UI 역할 시트) */
const ROLE_TEXT: Record<RoleId, RoleText> = {
  GK_TRADITIONAL: ['GK', '전통형 키퍼', ['reflexes', 'aerialCommand'], '선방과 공중볼 장악에 집중', '박스 안 공중볼·코너 수비가 단단해진다', '모든 포메이션, 로우 블록'],
  GK_SWEEPER: ['GK', '스위퍼 키퍼', ['kicking', 'pace', 'composure'], '빌드업 참여, 뒷공간 커버', '라인 뒤 롱볼·침투를 먼저 걷어낸다(상대 뒷공간 공략 약화). 압박을 푸는 빌드업 기점', '하이 라인, 포지셔널'],
  CB_STOPPER: ['CB', '스토퍼', ['tackling', 'physical'], '박스 수비·공중전 강화', '공중전으로 상대 타깃맨 롱볼을 막는다. 거친 수비로 경고가 조금 많다', '로우 블록, 3백 중앙'],
  CB_BALL_PLAYING: ['CB', '볼플레잉 CB', ['passing', 'composure', 'vision'], '빌드업 가중 ↑, 상대 압박 파훼', '뒤에서 패스를 뿌려 상대 전방 압박을 푼다', '포지셔널, 하이 라인'],
  CB_COVER: ['CB', '커버 CB', ['pace', 'positioning'], '빠른 발로 라인 뒤 커버', '가장 느린 수비수 대신 뒷공간을 책임진다. 빠른 공격수·역습·오프사이드 트랩 실패 위험을 줄인다', '하이 라인, 게겐프레싱, 3백 측면'],
  FB_DEFENSIVE: ['FB', '수비형 풀백', ['tackling', 'positioning'], '측면 수비 강화', '측면 2 대 1 과 윙어 1:1 을 막는다. 3·5백에서는 수비형 윙백', '로우 블록(5백), 미드 블록'],
  FB_OVERLAPPING: ['FB', '공격형 풀백', ['pace', 'crossing', 'workRate'], '오버래핑으로 측면 과부하', '윙어 바깥으로 올라가 크로스를 늘린다. 뒤 공간을 윙어에게 내준다. 체력 +1', '윙 플레이, 4백'],
  FB_INVERTED: ['FB', '인버티드 풀백', ['passing', 'composure', 'positioning'], '중원으로 좁혀 3-2 빌드업', '공격 때 중앙 미드필더가 하나 늘고 하프스페이스를 채운다. 압박을 풀고 역습 위험이 줄지만 크로스는 준다', '포지셔널 (4백 전용)'],
  WB_WINGBACK: ['FB', '윙백', ['pace', 'crossing', 'stamina'], '측면 전체를 오르내림', '공격 때 측면 폭을 혼자 맡아 크로스를 늘린다. 뒤 공간이 윙어에게 노출되고 체력 소모가 크다(+3)', '3백·5백 전용'],
  DM_ANCHOR: ['DM', '앵커', ['positioning', 'tackling'], '포백 앞 지킴이', '중앙과 하프스페이스를 막고 역습 위험을 크게 줄인다. 집중 마크 마커에 적합', '모든 포메이션 1피벗'],
  DM_REGISTA: ['DM', '레지스타', ['passing', 'vision', 'composure'], '낮은 위치의 플레이메이커', '빌드업과 점유를 주도하고 압박을 푼다. 스루패스 기점이지만 수비 커버는 약하다', '포지셔널, 3백'],
  DM_BALL_WINNER: ['DM', '볼 위닝 MF', ['tackling', 'workRate', 'physical'], '공을 뺏는 파이터', '중원 경합·세컨드볼을 따내고 역습 위험을 줄인다. 경고가 많고 체력 +2', '게겐프레싱, 다이렉트, 미드 블록'],
  CM_BOX_TO_BOX: ['CM', '박스투박스', ['workRate', 'passing', 'stamina'], '공수 전역 가담', '전진·압박·세컨드볼에 모두 가담하고 2선에서 침투해 오프사이드 트랩을 피한다. 체력 +3', '모든 3미들, 4-4-2'],
  CM_MEZZALA: ['CM', '메짤라', ['dribbling', 'vision', 'pace'], '하프스페이스 공격 미드필더', '측면과 중앙 사이 공간에서 컷백·스루 찬스를 만들고 2선 침투로 트랩을 피한다', '4-3-3, 3-5-2 좌우 CM'],
  CM_DEEP_PLAYMAKER: ['CM', '딥 플레이메이커', ['passing', 'vision', 'composure'], '뒤에서 템포를 조율', '빌드업·점유를 안정시키고 압박을 푼다. 중거리 기회가 조금 늘어난다', '포지셔널, 윙 플레이'],
  AM_PLAYMAKER: ['AM', '어드밴스드 플레이메이커', ['vision', 'passing'], '찬스메이킹 가중 ↑', '상대 진영에서 찬스를 만들고 중거리 슈팅이 늘어난다', '4-2-3-1 AM, 다이아몬드 AM'],
  AM_TREQUARTISTA: ['AM', '트레콰르티스타', ['dribbling', 'vision', 'composure'], '수비 부담 없는 창조자', '개인 돌파와 찬스메이킹이 최고지만 수비·압박에 가담하지 않는다. 체력 −1', '4-2-3-1, 4-3-1-2'],
  AM_SHADOW_STRIKER: ['AM', '섀도 스트라이커', ['finishing', 'positioning', 'pace'], '2선에서 박스로 침투', '하프스페이스로 늦게 뛰어들어 스루·컷백 슈팅을 맡고 오프사이드 트랩을 피한다', '3-4-3 의 2 AM, 4-2-3-1 AM'],
  AM_ENGANCHE: ['AM', '엔간체', ['passing', 'vision'], '고정형 10번', '중앙에서 스루패스를 뿌려 찬스를 만든다. 압박·수비 가담은 없다. 체력 −1', '4-3-1-2, 다이아몬드 AM'],
  W_WINGER: ['W', '전통 윙어', ['pace', 'crossing', 'dribbling'], '측면을 벌리는 크로서', '측면을 넓게 벌려 크로스를 올리고 상대 윙백 뒤 1:1 을 노린다', '윙 플레이, 4-4-2'],
  W_INSIDE_FORWARD: ['W', '인사이드 포워드', ['dribbling', 'finishing', 'pace'], '안으로 파고드는 득점원', '하프스페이스로 들어와 컷백·컷인 슈팅을 늘린다. 뒷공간 러너', '4-3-3, 게겐프레싱'],
  W_INVERTED_WINGER: ['W', '인버티드 윙어', ['passing', 'dribbling', 'vision'], '안쪽으로 감는 크로스·패스', '인스윙 크로스와 안쪽 패스로 컷백·중거리·스루 찬스를 조금씩 늘린다', '포지셔널, 4-2-3-1'],
  W_WIDE_MIDFIELDER: ['W', '와이드 미드필더', ['workRate', 'crossing', 'tackling'], '측면을 지키는 미드필더', '측면 수비에 성실히 가담해 상대 측면 과부하·윙어 1:1 을 막는다. 체력 +2', '4-4-2, 5-4-1, 미드 블록'],
  ST_POACHER: ['ST', '포처', ['positioning', 'finishing', 'pace'], '박스 안 마무리', '스루패스·역습 슈팅을 많이 맡는다. 오프사이드 트랩의 표적', '2톱, 역습'],
  ST_TARGET: ['ST', '타깃맨', ['physical', 'positioning'], '공중전의 기둥', '롱볼을 머리로 따내 압박을 건너뛰고(패스 길게일 때) 크로스·코너 헤더를 맡는다', '다이렉트, 윙 플레이'],
  ST_FALSE_NINE: ['ST', '폴스9', ['vision', 'passing', 'dribbling'], '내려와서 만드는 9번', '중원으로 내려와 중앙 인원을 늘리고 2선 침투 공간을 만들어 오프사이드 트랩을 피한다', '포지셔널, 4-3-3'],
  ST_PRESSING_FORWARD: ['ST', '프레싱 포워드', ['workRate', 'pace', 'tackling'], '최전방 1차 수비수', '상대 빌드업을 가장 먼저 압박하고 단일 피벗을 지운다. 역압박 전환 ↑, 체력 +3', '게겐프레싱, 하이 라인, 4-4-2'],
  ST_ADVANCED_FORWARD: ['ST', '어드밴스드 포워드', ['pace', 'finishing', 'dribbling'], '라인 뒤를 파는 공격수', '빠른 침투로 뒷공간·역습을 노리고 스루·돌파 찬스를 늘린다', '미드 블록 역습, 4-2-3-1'],
};

export const ROLES = Object.fromEntries(
  (Object.keys(ROLE_TEXT) as RoleId[]).map((id) => {
    const [position, label, keyAttrs, summary, effect, fitsIn] = ROLE_TEXT[id];
    const def: RoleDef = { id, position, label, keyAttrs, summary, effect, fitsIn, drainExtra: ROLE_SHAPE[id].drain };
    return [id, def];
  }),
) as Record<RoleId, RoleDef>;

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
