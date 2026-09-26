/** 제안 카드 수명 주기 (5.0.2). 순수 함수 — 영속화·권한은 services. 소유: A. */
import type {
  ClubPlanState,
  GameTimestamp,
  MatchPlan,
  Membership,
  PlanChangePatch,
  Proposal,
  ProposalDiffItem,
  ProposalInput,
  SlotKey,
  TacticSlot,
} from '../../types';

export const MAX_OPEN_PER_COACH = 5;
export const MAX_REASON_LENGTH = 80;

/**
 * 제안이 바꿀 수 있는 대상 묶음. 팀 지시는 MatchPlan 이 아니라 Club.tactics 슬롯에 있으므로 함께 다룬다.
 * 팀 지시만 바꾸는 승인은 숙련도를 떨어뜨리지 않는다(4.4-4).
 */
export interface PlanBundle {
  plan: MatchPlan;
  tactics: Record<SlotKey, TacticSlot>;
}

export function createProposal(
  _input: ProposalInput,
  _author: Membership,
  _existing: readonly Proposal[],
  _base: PlanBundle,
  _at: GameTimestamp,
  _id: string,
): Proposal {
  throw new Error('TODO');
}

export function applyPatch(_base: PlanBundle, _patch: PlanChangePatch): PlanBundle {
  throw new Error('TODO');
}

export function diffBundles(_before: PlanBundle, _after: PlanBundle): ProposalDiffItem[] {
  throw new Error('TODO');
}

/** 같은 필드(path)를 바꾸는 다른 OPEN 제안 → 승인 시 SUPERSEDED */
export function findConflicting(_target: Proposal, _open: readonly Proposal[]): Proposal[] {
  throw new Error('TODO');
}

/** 적용 기준 플랜: 확정본 > 초안 > 4.7 미리보기 플랜(fallback) */
export function pickBasePlan(_state: ClubPlanState | undefined, _fallback: MatchPlan): MatchPlan {
  throw new Error('TODO');
}
