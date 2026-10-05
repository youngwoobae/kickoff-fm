/**
 * 5.0.4 권한 체크 단일 함수. services 의 모든 변경 메서드가 가장 먼저 호출한다. 소유: A.
 */
import type { ActionKind, GameTime, Membership, PermissionResult, ProposalKind, RoleLabel } from '../../types';

export interface PermissionContext {
  now: GameTime;
  /** 오늘 경기 마감이 지났는가 (Phase 0: advanceDay 도중에만 true) */
  pastDeadline: boolean;
  /** 대상 구단 */
  clubId: string;
}

const deny = (code: Exclude<PermissionResult, { ok: true }>['code'], message: string): PermissionResult => ({ ok: false, code, message });
const OK: PermissionResult = { ok: true };

/** 합류 24시간 이내 (Phase 0: 하루 = 경기일 1일) */
export function isNewCoach(m: Membership, now: GameTime): boolean {
  if (m.joinedAt.season !== now.season) return m.joinedAt.season > now.season;
  return now.day - m.joinedAt.day < 1;
}

export function checkAction(m: Membership, action: ActionKind, ctx: PermissionContext): PermissionResult {
  if (m.clubId !== ctx.clubId) return deny('WRONG_CLUB', '이 구단의 멤버가 아니에요');
  switch (action) {
    case 'ADVANCE_DAY':
      return OK;
    case 'VIEW_TODAY_PLAN':
      if (m.seat === 'OWNER') return OK;
      if (m.seat === 'COACH_SPECTATOR') return deny('SPECTATOR', '관전 전용 코치는 당일 플랜을 볼 수 없어요');
      if (isNewCoach(m, ctx.now) && !ctx.pastDeadline) return deny('NEW_COACH_LOCK', '합류 24시간 이내 코치는 마감 후에만 당일 플랜을 볼 수 있어요');
      return OK;
    case 'EDIT_PLAN':
    case 'SUBMIT_PLAN':
    case 'EDIT_TACTIC':
    case 'SET_DEFAULT_PLAN':
    case 'APPROVE':
    case 'REJECT':
      return m.seat === 'OWNER' ? OK : deny('NOT_OWNER', '구단주만 실행할 수 있어요. 코치는 제안 카드를 써 보세요');
    case 'PROPOSE':
    case 'REACT':
      if (m.seat === 'COACH') return OK;
      if (m.seat === 'COACH_SPECTATOR') return deny('SPECTATOR', '관전 전용 코치는 제안할 수 없어요');
      return deny('NOT_COACH', '제안·반응은 코치만 할 수 있어요 (구단주는 직접 편집)');
  }
}

/**
 * 2.5.0: 코치 역할별 제안 영역 (5.4 매트릭스에서 그 역할이 E 이거나 담당인 영역만).
 * 보조 역할의 영역도 더한다. 역할 없는 코치(이전 세이브)는 플랜 변경만.
 */
export const PROPOSAL_AREAS: Record<RoleLabel, readonly ProposalKind[]> = {
  TAC: ['PLAN_CHANGE'],
  ANL: ['PLAN_CHANGE'],
  SQD: ['PLAN_CHANGE', 'RENEWAL'],
  SCT: ['TRANSFER_BID'],
  FIN: ['TRANSFER_BID', 'RENEWAL'],
};

export function proposalAreas(m: Membership): ProposalKind[] {
  if (!m.roleLabel) return ['PLAN_CHANGE'];
  return [...new Set([...PROPOSAL_AREAS[m.roleLabel], ...(m.subRole ? PROPOSAL_AREAS[m.subRole] : [])])];
}

const KIND_NAMES: Partial<Record<ProposalKind, string>> = { PLAN_CHANGE: '플랜·전술', TRANSFER_BID: '이적 입찰', RENEWAL: '재계약' };

/** PROPOSE 권한 + 역할 영역. 구단주·관전 코치는 checkAction 결과 그대로 */
export function checkProposeKind(m: Membership, kind: ProposalKind, ctx: PermissionContext): PermissionResult {
  const r = checkAction(m, 'PROPOSE', ctx);
  if (!r.ok) return r;
  return proposalAreas(m).includes(kind) ? OK : deny('ROLE_AREA', `${KIND_NAMES[kind] ?? kind} 제안은 담당 역할이 아니에요`);
}
