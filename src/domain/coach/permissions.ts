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

export function checkAction(_m: Membership, _action: ActionKind, _ctx: PermissionContext): PermissionResult {
  throw new Error('TODO');
}
