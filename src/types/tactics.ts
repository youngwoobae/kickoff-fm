import type { Lane, Step } from './common';
import type { AttrKey, Position } from './player';
import type { DP, RuleId } from './engine';

/** 포메이션 9종 (4.4-1). '4-4-2D' = 4-4-2 다이아몬드. 계약 1.2.0: '4-1-4-1' · '3-4-3' · '5-4-1' 추가 */
export type FormationId = '4-4-2' | '4-4-2D' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-1-4-1' | '3-4-3' | '5-4-1';

/** 역할 28개 (4.4-2, 실축구_전술설계 3장). 계약 1.2.0: 14종 추가, 기존 14종 ID 유지 */
export type RoleId =
  | 'GK_TRADITIONAL'
  | 'GK_SWEEPER'
  | 'CB_STOPPER'
  | 'CB_BALL_PLAYING'
  | 'FB_DEFENSIVE'
  | 'FB_OVERLAPPING'
  | 'DM_ANCHOR'
  | 'CM_BOX_TO_BOX'
  | 'AM_PLAYMAKER'
  | 'W_WINGER'
  | 'W_INSIDE_FORWARD'
  | 'ST_TARGET'
  | 'ST_POACHER'
  | 'ST_FALSE_NINE'
  // ── 1.2.0 추가 ──
  | 'CB_COVER'
  | 'FB_INVERTED'
  | 'WB_WINGBACK'
  | 'DM_REGISTA'
  | 'DM_BALL_WINNER'
  | 'CM_MEZZALA'
  | 'CM_DEEP_PLAYMAKER'
  | 'AM_TREQUARTISTA'
  | 'AM_SHADOW_STRIKER'
  | 'AM_ENGANCHE'
  | 'W_INVERTED_WINGER'
  | 'W_WIDE_MIDFIELDER'
  | 'ST_PRESSING_FORWARD'
  | 'ST_ADVANCED_FORWARD';

export interface RoleDef {
  id: RoleId;
  position: Position;
  label: string;
  keyAttrs: AttrKey[];
  summary: string;
  /** 1.2.0: "경기에서 하는 일" 한 줄 (엔진 효과를 사람 말로) */
  effect?: string;
  /** 1.2.0: 경기당 체력 소모 가산 (기본 30 에 더함, 음수 가능) */
  drainExtra?: number;
  /** 1.2.0: 어울리는 포메이션·스타일 설명 */
  fitsIn?: string;
}

export interface FormationSlot {
  /** 0..10. MatchPlan.lineup.starters 의 인덱스와 1:1 */
  index: number;
  position: Position;
  lane: Lane;
  allowedRoles: RoleId[];
  defaultRole: RoleId;
}

export interface FormationDef {
  id: FormationId;
  label: string;
  slots: FormationSlot[];
  /** UI 표시 전용 (DM+CM+중앙 AM). 엔진 0.4.0 규칙은 쓰지 않는다(역할 형태값이 대체) */
  centralMidfielders: number;
  backLine: 3 | 4 | 5;
  /** UI 표시 전용. 엔진 0.4.0 R4 는 역할 형태값(측면 인원 차)으로 판정한다 */
  isNarrow: boolean;
}

/** 팀 지시 6개 슬라이더 + 토글 2개 (4.4-3). 엔진 8.3 의 Style 과 동일 구조 */
export interface TeamInstructions {
  mentality: Step;
  press: Step;
  line: Step;
  width: Step;
  tempo: Step;
  directness: Step;
  counter: boolean;
  /** line ≥ +1 일 때만 true 허용 (domain 검증) */
  offsideTrap: boolean;
}

export type Style = TeamInstructions;

/**
 * 기존 프리셋 5종 ID (지시값만). 1.2.0 에서 라벨·값은 실제 스타일로 바뀌었다:
 * POSSESSION = 포지셔널 플레이, COUNTER = 미드 블록 역습, HIGH_PRESS = 게겐프레싱.
 * 새 스타일 전체(9종)는 StyleId / StyleDef 를 쓴다.
 */
export type PresetId = 'BALANCED' | 'POSSESSION' | 'COUNTER' | 'HIGH_PRESS' | 'LOW_BLOCK';

export interface PresetDef {
  id: PresetId;
  label: string;
  instructions: TeamInstructions;
}

/** 1.2.0: 실제 전술 스타일 9종 = 기존 프리셋 5 ID + 새 4종 */
export type StyleId = PresetId | 'DIRECT' | 'WING_PLAY' | 'HIGH_LINE' | 'WINGBACK_3';

/** 1.2.0: 스타일 요구 특성 키. 유닛(0~100) 또는 P_CB_MIN(CB 최저 속도, 1~20) · TARGET_MAN(타깃맨 공중 0~100) · SIDE_A(좌우 측면 공격 평균) */
export type StyleRequirementKey = 'BU' | 'CTRL' | 'PRS' | 'MID' | 'BOX' | 'AER_A' | 'AER_D' | 'PACE_A' | 'PACE_D' | 'SIDE_A' | 'P_CB_MIN' | 'TARGET_MAN';

export interface StyleRequirement {
  key: StyleRequirementKey;
  min: number;
  /** 예: "압박(PRS) 65" */
  label: string;
}

/** 1.2.0: 스타일 = 지시 묶음 + 권장 포메이션 + 권장 역할 + 설명 (TeamInstructions 계약은 불변) */
export interface StyleDef {
  id: StyleId;
  label: string;
  /** 실제 모델 (참고) */
  realModel: string;
  /** 한 줄 원리 */
  summary: string;
  /** 원리 설명 (3줄 이내) */
  principle: string;
  instructions: TeamInstructions;
  formation: FormationId;
  /** 길이 11, formation 슬롯 순 */
  roles: RoleId[];
  requirements: StyleRequirement[];
  /** 이 스타일이 켜는 이득 규칙 */
  strengths: RuleId[];
  /** 이 스타일이 당하는 규칙 */
  weaknesses: RuleId[];
  /** 경기당 체력 추가 소모 (기본 30 대비) */
  drainExtra: number;
  /** 체력 비용 아이콘 1~4 */
  staminaCost: 1 | 2 | 3 | 4;
  /** 기대 상성 상위 2 / 하위 2 (설계 2.5 행렬) */
  goodAgainst: StyleId[];
  badAgainst: StyleId[];
}

export type SlotKey = 'A' | 'B';

export interface TacticSlot {
  key: SlotKey;
  formation: FormationId;
  /** 길이 11, FormationDef.slots 인덱스 순 */
  roles: RoleId[];
  instructions: TeamInstructions;
  /** 숙련도 0~100. 포메이션 변경 시 × 0.5, 사용 +6, 미사용 −2/일 */
  familiarity: number;
}

/** 전술 상한 A/B 테스트 값 (8.1, 12.3 개발자 패널) */
export type TacticCap = 0.25 | 0.35 | 0.5 | 0.6 | 0.7;

/**
 * @deprecated 1.x 표시용 레거시 태그 (5종). 'WIDE' = WING_PLAY.
 * 1.2.0 부터 봇 성향의 원본은 Club.style / OpponentScout.style(BotStyle 8종)이다.
 * 이 태그는 UI 호환을 위해 OpponentScout.botStyle 에서 BotStyle 을 가장 가까운 5종으로 접어 계속 내보낸다.
 */
export type BotStyleTag = 'POSSESSION' | 'COUNTER' | 'HIGH_PRESS' | 'LOW_BLOCK' | 'WIDE';

/** 1.2.0: 봇 전술 성향 8종 (= BALANCED 를 뺀 스타일) */
export type BotStyle = Exclude<StyleId, 'BALANCED'>;

/** 1.2.0: 스쿼드의 스타일 적합도 (UI 표시용, 1.3). fit = min(1, Π 실제/요구) */
export interface StyleFit {
  styleId: StyleId;
  /** 0~1 */
  fit: number;
  /** ≥ 0.95 GOOD(초록), 0.80~0.95 OK(노랑), < 0.80 POOR(빨강). 1.3.0: missing 이 있으면 GOOD 불가(최대 OK) */
  level: 'GOOD' | 'OK' | 'POOR';
  /** 요구치 미달 항목 */
  missing: { key: StyleRequirementKey; label: string; actual: number; required: number }[];
}

/** 1.2.0: 상성 힌트 한 줄 (logit 수치 대신 S/M/L 크기만) */
export interface MatchupRuleHint {
  id: RuleId;
  dp: DP;
  /** +1 = 우리 유리, −1 = 상대 유리 */
  sign: 1 | -1;
  size: 'S' | 'M' | 'L';
  /** 예: "뒷공간: 우리 ST 속도 17 vs 상대 최저 CB 11 (상대 라인 높음)" */
  reason: string;
}

/** 1.2.0: getMatchupPreview 결과. 우리 슬롯 vs 상대 추정 전술의 정적 규칙 평가 (RNG 없음) */
export interface MatchupPreview {
  ourSlot: SlotKey;
  opponentId: string;
  /** 상대 추정 스타일 */
  opponentStyle?: StyleId;
  /** 추정(최근 경기 지시값 기반)이면 true, 봇 성향 원본이면 false */
  opponentStyleEstimated: boolean;
  /** 크기 내림차순, 최대 6개 */
  rules: MatchupRuleHint[];
  /** 전체 판정 −2(크게 불리) ~ +2(크게 유리) */
  styleEdge: -2 | -1 | 0 | 1 | 2;
}
