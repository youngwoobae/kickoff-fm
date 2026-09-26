/**
 * 4.7 플랜 결정 규칙 (단일 정의). 마감 처리와 홈 카드 미리보기가 같은 함수를 쓴다. 소유: A.
 * ① 확정본 → 기본 플랜 → 직전 사용 플랜(맞춤 지시 제거) → 시스템 기본(감독 AI)
 * ② 맞춤 지시 검증 → 출전 불가 대체 → 자동 로테이션(<70) → 유효성 보정 → 참조 끊긴 조건부 지시 비활성
 */
import type { Club, ClubPlanState, Fixture, MatchPlan, PlanValidationIssue, Player, ResolvedPlan } from '../../types';

export interface ResolvePlanContext {
  club: Club;
  fixture: Fixture;
  planState: ClubPlanState | undefined;
  players: Readonly<Record<string, Player>>;
  opponentPlayerIds: readonly string[];
}

export function resolvePlan(_ctx: ResolvePlanContext): ResolvedPlan {
  throw new Error('TODO');
}

export function validatePlan(_plan: MatchPlan, _club: Club, _players: Readonly<Record<string, Player>>): PlanValidationIssue[] {
  throw new Error('TODO');
}
