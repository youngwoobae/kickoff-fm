import type { Lane, Step } from './common';
import type { AttrKey, Position } from './player';

/** MVP 포메이션 6종 (4.4-1). '4-4-2D' = 4-4-2 다이아몬드 */
export type FormationId = '4-4-2' | '4-4-2D' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2';

/** MVP 역할 14개 (4.4-2) */
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
  | 'ST_FALSE_NINE';

export interface RoleDef {
  id: RoleId;
  position: Position;
  label: string;
  keyAttrs: AttrKey[];
  summary: string;
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
  /** R7 중원 수적 우위 계산용 (DM+CM+중앙 AM) */
  centralMidfielders: number;
  backLine: 3 | 4 | 5;
  /** R4 발동 조건(3백·다이아몬드)용 */
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

export type PresetId = 'BALANCED' | 'POSSESSION' | 'COUNTER' | 'HIGH_PRESS' | 'LOW_BLOCK';

export interface PresetDef {
  id: PresetId;
  label: string;
  instructions: TeamInstructions;
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
export type TacticCap = 0.25 | 0.35 | 0.5;

/** 봇 전술 성향 (6.6): 점유·역습·전방압박·잠그기·측면 */
export type BotStyleTag = 'POSSESSION' | 'COUNTER' | 'HIGH_PRESS' | 'LOW_BLOCK' | 'WIDE';
