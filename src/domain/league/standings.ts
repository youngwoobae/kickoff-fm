/** 순위 결정 (6.2): 승점 → 득실차 → 다득점 → 승자승 → 승자승 득실 → 누적 xG 차 → 추첨(시드). 소유: A. */
import type { ClubId, MatchSummary, SeasonNo, StandingRow } from '../../types';

export function computeStandings(
  _clubIds: readonly ClubId[],
  _summaries: readonly MatchSummary[],
  _season: SeasonNo,
  _tieBreakSeed: number,
): StandingRow[] {
  throw new Error('TODO');
}
