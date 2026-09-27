/** 14팀 더블 라운드로빈 26경기일 (서클 방식, 후반 13라운드 홈/원정 반전). 소유: A. */
import type { ClubId, Fixture, MatchId, SeasonNo } from '../../types';
import type { Rng } from '../../engine';

export function makeMatchId(season: SeasonNo, day: number, homeId: ClubId, awayId: ClubId): MatchId {
  return `s${season}-d${day}-${homeId}-${awayId}`;
}

export function parseMatchId(id: MatchId): { season: SeasonNo; day: number; homeId: ClubId; awayId: ClubId } | null {
  const m = /^s(\d+)-d(\d+)-([^-]+)-([^-]+)$/.exec(id);
  if (!m) return null;
  return { season: Number(m[1]), day: Number(m[2]), homeId: m[3]!, awayId: m[4]! };
}

export function generateDoubleRoundRobin(clubIds: readonly ClubId[], season: SeasonNo, rng: Rng): Fixture[] {
  // 시드로 팀 순서를 섞어 매 시즌 대진이 달라지게 한다
  const teams = [...clubIds];
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [teams[i], teams[j]] = [teams[j]!, teams[i]!];
  }
  if (teams.length % 2 === 1) teams.push('__BYE__');
  const n = teams.length;
  const rounds = n - 1;
  const half: [ClubId, ClubId][][] = [];
  const rot = teams.slice(1);
  for (let r = 0; r < rounds; r++) {
    const circle = [teams[0]!, ...rot];
    const pairs: [ClubId, ClubId][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i]!;
      const b = circle[n - 1 - i]!;
      if (a === '__BYE__' || b === '__BYE__') continue;
      // 홈/원정 교대: 라운드·자리 짝홀로 뒤집어 연속 홈을 줄인다
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    half.push(pairs);
    rot.unshift(rot.pop()!);
  }
  const fixtures: Fixture[] = [];
  half.forEach((pairs, r) => {
    const day = r + 1;
    for (const [h, a] of pairs) fixtures.push({ id: makeMatchId(season, day, h, a), season, day, homeId: h, awayId: a, played: false });
  });
  half.forEach((pairs, r) => {
    const day = rounds + r + 1;
    for (const [h, a] of pairs) fixtures.push({ id: makeMatchId(season, day, a, h), season, day, homeId: a, awayId: h, played: false });
  });
  return fixtures;
}
