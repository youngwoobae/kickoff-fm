/**
 * 5.0 MVP 비동기 제안형 코치. Phase 0 은 로컬 역할 전환(OWNER ↔ COACH)으로 시연한다.
 */
import type { ClubId, Day, GameTimestamp, MatchId, ProposalId, SeasonNo, UserId } from './common';
import type { ConditionalOrder, Lineup, OpponentOrders } from './plan';
import type { SlotKey, TeamInstructions } from './tactics';

export type Seat = 'OWNER' | 'COACH' | 'COACH_SPECTATOR';
export type RoleLabel = 'TAC' | 'SCT' | 'SQD' | 'ANL' | 'FIN';

export interface Membership {
  clubId: ClubId;
  userId: UserId;
  seat: Seat;
  roleLabel?: RoleLabel;
  joinedAt: GameTimestamp;
  hasOwnClub: boolean;
}

/** Phase 0 에서 실제로 생성 가능한 것은 PLAN_CHANGE 뿐. 나머지는 계약 유지용 */
export type ProposalKind = 'PLAN_CHANGE' | 'TRANSFER_BID' | 'PLAYER_SELL' | 'PLAYER_RELEASE' | 'TRAINING';

export type ProposalStatus = 'OPEN' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED' | 'STALE';

/** 플랜 변경 패치. 지정한 필드만 덮어쓴다 */
export interface PlanChangePatch {
  lineup?: Lineup;
  startSlot?: SlotKey;
  instructions?: { slot: SlotKey; patch: Partial<TeamInstructions> };
  conditionals?: ConditionalOrder[];
  /** null = 상대 맞춤 지시 제거 */
  opponentOrders?: OpponentOrders | null;
}

export type ProposalPayload = { kind: 'PLAN_CHANGE'; matchId: MatchId; patch: PlanChangePatch };

export interface ProposalDiffItem {
  /** 예: 'instructions.A.press', 'lineup.starters[3]' */
  path: string;
  label: string;
  before: string;
  after: string;
}

export interface ProposalReaction {
  userId: UserId;
  choice: 'FOR' | 'AGAINST';
  reason?: string;
}

export interface Proposal {
  id: ProposalId;
  clubId: ClubId;
  authorId: UserId;
  authorRole?: RoleLabel;
  kind: ProposalKind;
  payload: ProposalPayload;
  /** 필수, 최대 80자 */
  reason: string;
  diff: ProposalDiffItem[];
  reactions: ProposalReaction[];
  createdAt: GameTimestamp;
  /** 대상 경기 마감 = 그 경기일의 advanceDay 시작 시점 */
  expiresAt: { season: SeasonNo; day: Day };
  status: ProposalStatus;
  resolvedBy?: UserId;
  resolvedAt?: GameTimestamp;
  resolutionNote?: string;
  /** SUPERSEDED 인 경우 대체한 제안 */
  supersededBy?: ProposalId;
}

/** propose() 입력 */
export interface ProposalInput {
  payload: ProposalPayload;
  reason: string;
}

/** checkAction 이 판정하는 행동 (5.0.4 + Phase 0 로컬 행동) */
export type ActionKind =
  | 'VIEW_TODAY_PLAN'
  | 'EDIT_PLAN'
  | 'SUBMIT_PLAN'
  | 'EDIT_TACTIC'
  | 'SET_DEFAULT_PLAN'
  | 'PROPOSE'
  | 'REACT'
  | 'APPROVE'
  | 'REJECT'
  | 'ADVANCE_DAY';

export type PermissionDenyCode = 'NOT_OWNER' | 'NOT_COACH' | 'SPECTATOR' | 'NEW_COACH_LOCK' | 'WRONG_CLUB';

export type PermissionResult = { ok: true } | { ok: false; code: PermissionDenyCode; message: string };

export type ApproveResult =
  | { ok: true; proposal: Proposal; superseded: ProposalId[] }
  | { ok: false; proposal: Proposal; reason: 'STALE'; details: string[] };
