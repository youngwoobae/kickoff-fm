/**
 * 5.0 MVP 비동기 제안형 코치. Phase 0 은 로컬 역할 전환(OWNER ↔ COACH)으로 시연한다.
 */
import type { ClubId, Day, GameTimestamp, MatchId, ProposalId, SeasonNo, UserId } from './common';
import type { ConditionalOrder, Lineup, OpponentOrders } from './plan';
import type { SlotKey, TeamInstructions } from './tactics';
import type { BidInput } from './transfer';

export type Seat = 'OWNER' | 'COACH' | 'COACH_SPECTATOR';
export type RoleLabel = 'TAC' | 'SCT' | 'SQD' | 'ANL' | 'FIN';

export interface Membership {
  clubId: ClubId;
  userId: UserId;
  seat: Seat;
  roleLabel?: RoleLabel;
  joinedAt: GameTimestamp;
  hasOwnClub: boolean;
  /**
   * 2.5.0 (로컬 프로필): 한 기기 핫시트 멤버 식별. 이전 세이브에는 없다 —
   * getActor()·listMembers() 는 기본값(역할 이름·기본 이모지)을 채워 돌려준다.
   */
  name?: string;
  /** 색 이모지 등 1글자 식별자 (예: '🟦') */
  emoji?: string;
  /** 보조 역할 (코치만, roleLabel 과 달라야 함). 보조 역할의 제안 영역도 쓸 수 있다 */
  subRole?: RoleLabel;
}

/** 2.5.0: getActor()·listMembers() 반환 — 표시 필드가 항상 채워진 멤버. memberId = userId */
export interface ClubMember extends Membership {
  name: string;
  emoji: string;
}

/** 2.5.0: updateMember() 패치. subRole: null = 보조 역할 해제. 구단주의 role·subRole 은 무시 */
export interface MemberPatch {
  name?: string;
  emoji?: string;
  role?: RoleLabel;
  subRole?: RoleLabel | null;
}

/** Phase 0 에서 실제로 생성 가능한 것은 PLAN_CHANGE 뿐. 나머지는 계약 유지용 */
export type ProposalKind = 'PLAN_CHANGE' | 'TRANSFER_BID' | 'PLAYER_SELL' | 'PLAYER_RELEASE' | 'TRAINING' | 'RENEWAL';

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
  /** 2.5.0: 반응 시점 멤버 이름 (멤버가 나가도 표시용으로 남는다) */
  name?: string;
}

export interface Proposal {
  id: ProposalId;
  clubId: ClubId;
  authorId: UserId;
  authorRole?: RoleLabel;
  /** 2.5.0: 작성 시점 멤버 이름·이모지 (멤버가 나가도 남는다) */
  authorName?: string;
  authorEmoji?: string;
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

/**
 * 2.5.0: 이적·재계약 제안 (5.0.2 "이적 입찰", 재계약). 플랜 제안(Proposal)과 따로 저장·조회한다
 * — Proposal.payload 를 넓히면 기존 UI 의 p.payload.patch 접근이 깨지기 때문.
 * 승인 = 구단주 명의로 placeBid / offerRenewal 실행. 실패(창 닫힘·잔액·선수 거절)는 STALE.
 */
export type DealPayload =
  | { kind: 'TRANSFER_BID'; bid: BidInput }
  | { kind: 'RENEWAL'; playerId: string; salary: number; seasons: number };

export interface DealProposal extends Omit<Proposal, 'kind' | 'payload' | 'diff' | 'supersededBy'> {
  kind: 'TRANSFER_BID' | 'RENEWAL';
  payload: DealPayload;
  /** 카드 표시용 요약 (예: '홍길동 입찰 1,200,000 KC') */
  summary: string;
}

export interface DealProposalInput {
  payload: DealPayload;
  reason: string;
}

export type DealApproveResult =
  | { ok: true; proposal: DealProposal }
  | { ok: false; proposal: DealProposal; reason: 'STALE'; details: string[] };

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

/** 2.5.0: ROLE_AREA = 코치 역할의 제안 영역 밖 (예: 전술 코치의 이적 제안) */
export type PermissionDenyCode = 'NOT_OWNER' | 'NOT_COACH' | 'SPECTATOR' | 'NEW_COACH_LOCK' | 'WRONG_CLUB' | 'ROLE_AREA';

export type PermissionResult = { ok: true } | { ok: false; code: PermissionDenyCode; message: string };

export type ApproveResult =
  | { ok: true; proposal: Proposal; superseded: ProposalId[] }
  | { ok: false; proposal: Proposal; reason: 'STALE'; details: string[] };
