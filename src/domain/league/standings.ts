/** 순위 결정 (6.2): 승점 → 득실차 → 다득점 → 승자승 → 승자승 득실 → 누적 xG 차 → 추첨(시드). 소유: A. */
import type { ClubId, Fixture, FormLetter, MatchSummary, SeasonNo, StandingRow, TableZone } from '../../types';
import { hashString } from '../../engine';

interface Acc extends Omit<StandingRow, 'position' | 'zone' | 'form'> {
  results: { day: number; letter: FormLetter }[];
}

function blank(clubId: ClubId): Acc {
  return {
    clubId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    xgFor: 0,
    xgAgainst: 0,
    xPts: 0,
    results: [],
  };
}

function zoneFor(position: number, total: number): TableZone {
  if (position <= 2) return 'PROMOTION';
  if (position > total - 4) return 'RELEGATION';
  return 'NONE';
}

/** 순위 계산에 필요한 경기 결과 최소형. MatchSummary 그대로, 또는 경량 시뮬 결과(xg·xPts 없음, 2.1.0 M3.2) */
export interface ResultLike {
  season: SeasonNo;
  day: number;
  home: Pick<MatchSummary['home'], 'clubId' | 'goals'> & Partial<Pick<MatchSummary['home'], 'xg' | 'xPts'>>;
  away: Pick<MatchSummary['away'], 'clubId' | 'goals'> & Partial<Pick<MatchSummary['away'], 'xg' | 'xPts'>>;
}

/** 스코어가 있는 일정 → 순위 계산 입력 (경량 시뮬 리그) */
export function resultsOfFixtures(fixtures: readonly Fixture[]): ResultLike[] {
  const out: ResultLike[] = [];
  for (const f of fixtures) {
    if (f.played && f.score) out.push({ season: f.season, day: f.day, home: { clubId: f.homeId, goals: f.score.home }, away: { clubId: f.awayId, goals: f.score.away } });
  }
  return out;
}

export function computeStandings(
  clubIds: readonly ClubId[],
  summaries: readonly ResultLike[],
  season: SeasonNo,
  tieBreakSeed: number,
): StandingRow[] {
  const acc = new Map<ClubId, Acc>(clubIds.map((id) => [id, blank(id)]));
  const games = summaries.filter((s) => s.season === season);
  for (const s of games) {
    for (const [me, op] of [
      [s.home, s.away],
      [s.away, s.home],
    ] as const) {
      const a = acc.get(me.clubId);
      if (!a) continue;
      a.played += 1;
      a.goalsFor += me.goals;
      a.goalsAgainst += op.goals;
      a.xgFor += me.xg ?? 0;
      a.xgAgainst += op.xg ?? 0;
      a.xPts += me.xPts ?? 0;
      const letter: FormLetter = me.goals > op.goals ? 'W' : me.goals === op.goals ? 'D' : 'L';
      if (letter === 'W') {
        a.won += 1;
        a.points += 3;
      } else if (letter === 'D') {
        a.drawn += 1;
        a.points += 1;
      } else a.lost += 1;
      a.results.push({ day: s.day, letter });
    }
  }
  for (const a of acc.values()) a.goalDiff = a.goalsFor - a.goalsAgainst;

  const primary = (x: Acc, y: Acc) => y.points - x.points || y.goalDiff - x.goalDiff || y.goalsFor - x.goalsFor;
  const sorted = [...acc.values()].sort((x, y) => primary(x, y) || x.clubId.localeCompare(y.clubId));
  // ①~③ 동률 그룹마다 ④ 승자승 ⑤ 승자승 득실 ⑥ 누적 xG 차 ⑦ 추첨
  const out: Acc[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && primary(sorted[i]!, sorted[j]!) === 0) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      const ids = new Set(group.map((g) => g.clubId));
      const h2h = new Map<ClubId, { pts: number; gd: number }>(group.map((g) => [g.clubId, { pts: 0, gd: 0 }]));
      for (const s of games) {
        if (!ids.has(s.home.clubId) || !ids.has(s.away.clubId)) continue;
        const h = h2h.get(s.home.clubId)!;
        const a = h2h.get(s.away.clubId)!;
        h.gd += s.home.goals - s.away.goals;
        a.gd += s.away.goals - s.home.goals;
        if (s.home.goals > s.away.goals) h.pts += 3;
        else if (s.home.goals < s.away.goals) a.pts += 3;
        else {
          h.pts += 1;
          a.pts += 1;
        }
      }
      const lot = (id: ClubId) => hashString(`${tieBreakSeed}|${id}`);
      group.sort(
        (x, y) =>
          h2h.get(y.clubId)!.pts - h2h.get(x.clubId)!.pts ||
          h2h.get(y.clubId)!.gd - h2h.get(x.clubId)!.gd ||
          y.xgFor - y.xgAgainst - (x.xgFor - x.xgAgainst) ||
          lot(x.clubId) - lot(y.clubId),
      );
    }
    out.push(...group);
    i = j;
  }
  return out.map((a, idx) => {
    const { results, ...rest } = a;
    const form = [...results].sort((p, q) => p.day - q.day).slice(-5).map((r) => r.letter);
    return {
      ...rest,
      xgFor: round2(rest.xgFor),
      xgAgainst: round2(rest.xgAgainst),
      xPts: round2(rest.xPts),
      position: idx + 1,
      form,
      zone: zoneFor(idx + 1, out.length),
    };
  });
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
