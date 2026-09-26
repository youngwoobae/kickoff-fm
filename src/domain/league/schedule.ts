/** 14팀 더블 라운드로빈 26경기일 (서클 방식, 후반 13라운드 홈/원정 반전). 소유: A. */
import type { ClubId, Fixture, MatchId, SeasonNo } from '../../types';
import type { Rng } from '../../engine';

export function makeMatchId(season: SeasonNo, day: number, homeId: ClubId, awayId: ClubId): MatchId {
  return `s${season}-d${day}-${homeId}-${awayId}`;
}

export function generateDoubleRoundRobin(_clubIds: readonly ClubId[], _season: SeasonNo, _rng: Rng): Fixture[] {
  throw new Error('TODO');
}
