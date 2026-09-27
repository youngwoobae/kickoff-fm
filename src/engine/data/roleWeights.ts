/**
 * 역할 정의(4.4-2)와 유닛 가중치 파일(8.3-2, 기획서의 roleWeights.json 에 해당). 소유: A.
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

/** 역할 × 유닛 가중치 (예시 가중치 8.3 표 기반 [PH]) */
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
};

/** 박스투박스 체력 소모 가산 (4.2 역할 보정) */
export const ROLE_EXTRA_DRAIN: Partial<Record<RoleId, number>> = { CM_BOX_TO_BOX: 3 };

/** DP3 역할 보정 (8.5): 역할 1명당 가산, 유형별 최대 ±0.3 [PH] */
export const CHANCE_ROLE_ADJ: Record<OpenPlayChance, Partial<Record<RoleId, number>>> = {
  CROSS: { W_WINGER: 0.1, FB_OVERLAPPING: 0.08, ST_TARGET: 0.12 },
  THROUGH: { ST_POACHER: 0.15, ST_FALSE_NINE: 0.05 },
  CUTBACK: { W_INSIDE_FORWARD: 0.12, W_WINGER: 0.04 },
  LONG: { AM_PLAYMAKER: 0.15, CM_BOX_TO_BOX: 0.05 },
  SOLO: {},
};
export const CHANCE_ROLE_ADJ_MAX = 0.3;
/** 개인 돌파: 최고 드리블 능력치가 기준을 넘는 만큼 가산 */
export const SOLO_DRIBBLE_THRESHOLD = 14;
export const SOLO_PER_POINT = 0.06;
/** 중앙 측면 선택 시 크로스·컷백 억제 (구조 보정, 전술 아님) */
export const CENTRAL_SIDE_ADJ: Partial<Record<OpenPlayChance, number>> = { CROSS: -0.4, CUTBACK: -0.2 };

/** 슈터 선택 가중치 (찬스 유형 × 역할) */
export const SHOOTER_ROLE_WEIGHT: Record<'CROSS' | 'THROUGH' | 'CUTBACK' | 'LONG' | 'SOLO' | 'COUNTER' | 'CORNER', Partial<Record<RoleId, number>>> = {
  CROSS: { ST_TARGET: 3, ST_POACHER: 2, ST_FALSE_NINE: 1.2, W_WINGER: 0.6, W_INSIDE_FORWARD: 1, AM_PLAYMAKER: 0.6, CM_BOX_TO_BOX: 0.6, CB_STOPPER: 0.3, CB_BALL_PLAYING: 0.2 },
  THROUGH: { ST_POACHER: 4, ST_TARGET: 1.5, ST_FALSE_NINE: 2, W_INSIDE_FORWARD: 2, W_WINGER: 1.2, AM_PLAYMAKER: 1, CM_BOX_TO_BOX: 0.4 },
  CUTBACK: { ST_POACHER: 2, ST_TARGET: 1.5, ST_FALSE_NINE: 2, W_INSIDE_FORWARD: 2, W_WINGER: 1, AM_PLAYMAKER: 1.5, CM_BOX_TO_BOX: 0.8 },
  LONG: { AM_PLAYMAKER: 2.5, CM_BOX_TO_BOX: 2, W_INSIDE_FORWARD: 1.2, W_WINGER: 0.8, DM_ANCHOR: 0.8, ST_FALSE_NINE: 1, ST_TARGET: 0.5, ST_POACHER: 0.6, FB_OVERLAPPING: 0.3 },
  SOLO: { W_INSIDE_FORWARD: 2.5, W_WINGER: 2, AM_PLAYMAKER: 1.5, ST_FALSE_NINE: 1.5, ST_POACHER: 1.5, ST_TARGET: 0.6, CM_BOX_TO_BOX: 0.5, FB_OVERLAPPING: 0.3 },
  COUNTER: { ST_POACHER: 3, ST_TARGET: 1.5, ST_FALSE_NINE: 2, W_WINGER: 2, W_INSIDE_FORWARD: 2.2, AM_PLAYMAKER: 1, CM_BOX_TO_BOX: 0.5 },
  CORNER: { CB_STOPPER: 2, CB_BALL_PLAYING: 1.5, ST_TARGET: 2.5, ST_POACHER: 1.2, ST_FALSE_NINE: 0.8, DM_ANCHOR: 0.8, CM_BOX_TO_BOX: 0.8, FB_DEFENSIVE: 0.3, FB_OVERLAPPING: 0.3, W_WINGER: 0.3, W_INSIDE_FORWARD: 0.5, AM_PLAYMAKER: 0.4 },
};

export const ROLES: Record<RoleId, RoleDef> = {
  GK_TRADITIONAL: { id: 'GK_TRADITIONAL', position: 'GK', label: '전통형 키퍼', keyAttrs: ['reflexes', 'aerialCommand'], summary: '선방과 공중볼 장악에 집중' },
  GK_SWEEPER: { id: 'GK_SWEEPER', position: 'GK', label: '스위퍼 키퍼', keyAttrs: ['kicking', 'pace'], summary: '빌드업 참여, 상대 롱볼 우회(R2) 효과 절반' },
  CB_STOPPER: { id: 'CB_STOPPER', position: 'CB', label: '스토퍼', keyAttrs: ['tackling', 'physical'], summary: '박스 수비·공중전 강화' },
  CB_BALL_PLAYING: { id: 'CB_BALL_PLAYING', position: 'CB', label: '볼플레잉 CB', keyAttrs: ['passing', 'composure'], summary: '빌드업 가중 ↑, 상대 압박(R1) 파훼' },
  FB_DEFENSIVE: { id: 'FB_DEFENSIVE', position: 'FB', label: '수비형 풀백', keyAttrs: ['tackling', 'positioning'], summary: '측면 수비 강화, 상대 폭 공략(R4) 대응' },
  FB_OVERLAPPING: { id: 'FB_OVERLAPPING', position: 'FB', label: '오버래핑 풀백', keyAttrs: ['pace', 'crossing'], summary: '크로스 찬스 ↑, 측면 공격 기여' },
  DM_ANCHOR: { id: 'DM_ANCHOR', position: 'DM', label: '앵커', keyAttrs: ['positioning', 'tackling'], summary: '역습 처벌(R5) 효과 × 0.6, 집중 마크 마커 적합' },
  CM_BOX_TO_BOX: { id: 'CM_BOX_TO_BOX', position: 'CM', label: '박스투박스', keyAttrs: ['workRate', 'passing'], summary: '전진·압박 기여, 체력 소모 +3' },
  AM_PLAYMAKER: { id: 'AM_PLAYMAKER', position: 'AM', label: '공격형 플레이메이커', keyAttrs: ['vision', 'passing'], summary: '찬스메이킹 가중 ↑, 중거리 찬스 ↑' },
  W_WINGER: { id: 'W_WINGER', position: 'W', label: '윙어', keyAttrs: ['pace', 'crossing'], summary: '크로스 비중 ↑, 측면 공격' },
  W_INSIDE_FORWARD: { id: 'W_INSIDE_FORWARD', position: 'W', label: '인사이드 포워드', keyAttrs: ['dribbling', 'finishing'], summary: '컷백·컷인 슈팅 ↑' },
  ST_TARGET: { id: 'ST_TARGET', position: 'ST', label: '타깃맨', keyAttrs: ['physical'], summary: '공중전 강화, 낮은 블록(R3) 파훼' },
  ST_POACHER: { id: 'ST_POACHER', position: 'ST', label: '침투형', keyAttrs: ['pace', 'positioning'], summary: '스루패스·역습 ↑, 오프사이드 트랩(R6) 대상' },
  ST_FALSE_NINE: { id: 'ST_FALSE_NINE', position: 'ST', label: '가짜 9번', keyAttrs: ['vision', 'passing'], summary: '찬스메이킹 참여, 오프사이드 트랩(R6) 파훼' },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
