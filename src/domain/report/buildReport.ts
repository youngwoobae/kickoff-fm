/** 8.8 리포트 블록 1·2·3·4·5·6·8 조립. 문장 템플릿은 report/templates.ts 로 분리 예정. 소유: A. */
import type { ClubId, MatchExplanation, MatchReport, MatchResult, MatchSummary, RuleId } from '../../types';

export interface LeagueAverages {
  /** Z0, Z1, Z2 통과율 */
  zonePass: [number, number, number];
  /** 팀·경기당 평균 발동 수 */
  ruleFiresPerMatch: Partial<Record<RuleId, number>>;
}

export function buildReport(
  _result: MatchResult,
  _explanation: MatchExplanation,
  _perspective: ClubId,
  _league: LeagueAverages,
  _seasonSoFar: readonly MatchSummary[],
): MatchReport {
  throw new Error('TODO');
}

export function computeLeagueAverages(_summaries: readonly MatchSummary[]): LeagueAverages {
  throw new Error('TODO');
}
