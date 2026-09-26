import type { ClubId, GameTimestamp, Lane, MatchId, PlayerId, UserId } from './common';
import type { SlotKey } from './tactics';

/** 조건부 지시 조건 (4.5). 최대 2개 AND */
export type TriggerCondition =
  | { kind: 'TIME'; after: 'HT' | 45 | 60 | 75 }
  | { kind: 'SCORE'; state: 'LEAD' | 'DRAW' | 'TRAIL'; minDiff?: number };

/** 조건부 지시 행동 (4.5). 지시당 1개 */
export type TriggerAction =
  | { kind: 'SWITCH_SLOT'; slot: SlotKey }
  /** 현재 공격 성향 값에 더한 뒤 −2..+2 로 자른다 */
  | { kind: 'MENTALITY_DELTA'; delta: -2 | -1 | 1 | 2 }
  /** TIME=HT 조건과만 조합 가능 */
  | { kind: 'HT_ADJUST'; target: 'tempo' | 'press'; delta: -1 | 1 };

export interface ConditionalOrder {
  id: string;
  conditions: TriggerCondition[];
  action: TriggerAction;
  /** 4.7 ②-5 에 의해 비활성화될 수 있다 */
  enabled: boolean;
}

/** 상대 맞춤 지시 (R9 집중 마크, R10 공략 측면). Phase 0 선택 기능 */
export interface OpponentOrders {
  /** 이 지시를 작성할 때 기준으로 삼은 상대. 오늘 상대와 다르면 초기화(4.7 ②-1) */
  opponentId: ClubId;
  markTarget?: PlayerId;
  marker?: PlayerId;
  attackSide?: Exclude<Lane, 'C'>;
}

export interface Lineup {
  /** 길이 11. 인덱스 = 시작 슬롯 포메이션의 FormationSlot.index */
  starters: PlayerId[];
  /** 최대 7 */
  bench: PlayerId[];
}

/** 경기 플랜 = 매일 제출 단위 (4.5) */
export interface MatchPlan {
  clubId: ClubId;
  /** 기본 플랜(상대 무관)은 null */
  matchId: MatchId | null;
  lineup: Lineup;
  startSlot: SlotKey;
  opponentOrders?: OpponentOrders;
  /** 최대 3개, 위에서부터 우선 */
  conditionals: ConditionalOrder[];
  /** 자동 교체 컨디션 임계치 (기본 55) */
  autoSubThreshold: number;
  /** 자동 로테이션(경기 전 컨디션 < 70 선발 대체), 기본 ON */
  autoRotation: boolean;
  setPieceTaker?: PlayerId;
}

export type PlanStatus = 'DRAFT' | 'CONFIRMED';

export interface PlanRecord {
  plan: MatchPlan;
  status: PlanStatus;
  updatedBy: UserId;
  updatedAt: GameTimestamp;
  /** 제안 승인으로 확정된 경우 */
  sourceProposalId?: string;
}

/** 4.7 ① 적용 플랜 후보 출처 (예약 플랜은 Phase 0 제외) */
export type PlanSource = 'CONFIRMED' | 'DEFAULT' | 'LAST_USED' | 'SYSTEM';

export type PlanAdjustmentKind =
  | 'OPP_ORDERS_CLEARED'
  | 'UNAVAILABLE_REPLACED'
  | 'AUTO_ROTATION'
  | 'VALIDITY_FIX'
  | 'CONDITIONAL_DISABLED';

export interface PlanAdjustment {
  kind: PlanAdjustmentKind;
  playerOut?: PlayerId;
  playerIn?: PlayerId;
  conditionalId?: string;
  note: string;
}

/** 4.7 규칙을 적용한 최종 플랜. 홈 카드 "지금 마감되면 적용될 플랜"도 이 타입 */
export interface ResolvedPlan {
  plan: MatchPlan;
  source: PlanSource;
  adjustments: PlanAdjustment[];
}
