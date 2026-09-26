/** ResolvedPlan + 구단·선수 상태 → EngineTeamInput 변환 (도메인 → 엔진 경계). 소유: A. */
import type { Club, EngineTeamInput, Player, ResolvedPlan } from '../../types';

export function toEngineTeamInput(
  _club: Club,
  _resolved: ResolvedPlan,
  _players: Readonly<Record<string, Player>>,
  _isHome: boolean,
): EngineTeamInput {
  throw new Error('TODO');
}
