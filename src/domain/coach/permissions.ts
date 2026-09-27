/**
 * 5.0.4 권한 체크 단일 함수. services 의 모든 변경 메서드가 가장 먼저 호출한다. 소유: A.
 */
import type { ActionKind, GameTime, Membership, PermissionResult } from '../../types';

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
  if (m.clubId !== ctx.clubId) return deny('WRONG_CLUB', '이 구단의 멤버가 아닙니다');
  switch (action) {
    case 'ADVANCE_DAY':
      return OK;
    case 'VIEW_TODAY_PLAN':
      if (m.seat === 'OWNER') return OK;
      if (m.seat === 'COACH_SPECTATOR') return deny('SPECTATOR', '관전 전용 코치는 당일 플랜을 볼 수 없습니다');
      if (isNewCoach(m, ctx.now) && !ctx.pastDeadline) return deny('NEW_COACH_LOCK', '합류 24시간 이내 코치는 마감 후에만 당일 플랜을 볼 수 있습니다');
      return OK;
    case 'EDIT_PLAN':
    case 'SUBMIT_PLAN':
    case 'EDIT_TACTIC':
    case 'SET_DEFAULT_PLAN':
    case 'APPROVE':
    case 'REJECT':
      return m.seat === 'OWNER' ? OK : deny('NOT_OWNER', '구단주만 실행할 수 있습니다. 코치는 제안 카드를 사용하세요');
    case 'PROPOSE':
    case 'REACT':
      if (m.seat === 'COACH') return OK;
      if (m.seat === 'COACH_SPECTATOR') return deny('SPECTATOR', '관전 전용 코치는 제안할 수 없습니다');
      return deny('NOT_COACH', '제안·반응은 코치만 할 수 있습니다 (구단주는 직접 편집)');
  }
}
