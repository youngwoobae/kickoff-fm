/**
 * 시즌 판정 (6.2, 6.5 ①②③). Phase 0: 사람 팀 1개 → 봇 비율 > 40% 규칙에 따라
 * 전체 1·2위일 때만 PROMOTED, 전체 11~14위면 RELEGATED (T5 는 강등 없음). 실제 티어 이동 없음. 소유: A.
 */
import type { Club, SeasonNo, SeasonOutcome, StandingRow, Tier } from '../../types';

export function judgeSeason(
  _season: SeasonNo,
  _tier: Tier,
  _finalTable: readonly StandingRow[],
  _clubs: Readonly<Record<string, Club>>,
): SeasonOutcome {
  throw new Error('TODO');
}
