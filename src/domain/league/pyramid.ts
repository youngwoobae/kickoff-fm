/**
 * 2.1.0 피라미드 규칙 (D3: 5티어 × 1리그 × 14팀, 메인 결정 U-1: T3↔T4·T4↔T5 경계 3팀, T1~T3 사이 2팀).
 * M3.1: 규칙 상수·커리어. M3.2: GameState.leagues 조회 도우미. M3.3: 리그 순위표·승강 이동 계산·적용.
 */
import type { CareerRecord, CareerSeason, ClubId, ClubMovement, GameState, LeagueId, LeagueInfo, LeagueState, Pyramid, SeasonOutcome, StandingRow, Tier } from '../../types';
import { hashString } from '../../engine';
import { computeStandings, resultsOfFixtures } from './standings';

/** 위(T1) → 아래(T5) */
export const TIERS: readonly Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

/** 기획서 6.1 명칭 */
export const TIER_NAMES: Readonly<Record<Tier, string>> = {
  T1: '프리미어 디비전',
  T2: '디비전 1',
  T3: '디비전 2',
  T4: '디비전 3',
  T5: '루키 리그',
};

/** 경계별 승강 인원: key = 위 티어 (T1 = T1↔T2 경계). [PH] */
export const BOUNDARY_MOVES: Readonly<Record<'T1' | 'T2' | 'T3' | 'T4', number>> = { T1: 2, T2: 2, T3: 3, T4: 3 };

/** 새 게임 기본 시작 티어(D4). 단일 리그 상태에서는 newGame 이 아직 T3 를 기본으로 쓴다(M3.2 가 이 값으로 바꾼다) */
export const DEFAULT_START_TIER: Tier = 'T5';

export function leagueIdOf(tier: Tier): LeagueId {
  return `L-${tier}`;
}

/** 이 티어에서 올라가는 팀 수 / 내려가는 팀 수 */
export function movesOf(tier: Tier): { promote: number; relegate: number } {
  const i = TIERS.indexOf(tier);
  const above = TIERS[i - 1] as keyof typeof BOUNDARY_MOVES | undefined;
  return { promote: above ? BOUNDARY_MOVES[above] : 0, relegate: tier === 'T5' ? 0 : BOUNDARY_MOVES[tier as keyof typeof BOUNDARY_MOVES] };
}

export function leagueInfo(tier: Tier, clubIds: readonly ClubId[], isUserLeague: boolean): LeagueInfo {
  const m = movesOf(tier);
  return {
    id: leagueIdOf(tier),
    tier,
    name: TIER_NAMES[tier],
    clubIds: [...clubIds].sort(),
    promoteCount: m.promote,
    relegateCount: m.relegate,
    isUserLeague,
  };
}

/** 상태의 리그 목록. 단일 리그 세이브(leagues 없음)는 clubs 전부 = 사용자 리그 하나 */
export function leaguesOf(state: Pick<GameState, 'leagues' | 'clubs' | 'settings'>): LeagueState[] {
  return state.leagues ?? [{ id: leagueIdOf(state.settings.tier), tier: state.settings.tier, clubIds: Object.keys(state.clubs).sort() }];
}

export function userLeagueOf(state: Pick<GameState, 'leagues' | 'clubs' | 'settings' | 'userClubId'>): LeagueState {
  const ls = leaguesOf(state);
  return ls.find((l) => l.clubIds.includes(state.userClubId)) ?? ls[0]!;
}

export function findLeague(state: Pick<GameState, 'leagues' | 'clubs' | 'settings'>, id: LeagueId): LeagueState | undefined {
  return leaguesOf(state).find((l) => l.id === id);
}

/** 구단 → 티어 (경제 수치 기준). 리그에 없는 구단은 사용자 티어 */
export function clubTierMap(state: Pick<GameState, 'leagues' | 'clubs' | 'settings'>): Map<ClubId, Tier> {
  const m = new Map<ClubId, Tier>();
  for (const l of leaguesOf(state)) for (const id of l.clubIds) m.set(id, l.tier);
  return m;
}

type TableState = Pick<GameState, 'leagues' | 'clubs' | 'settings' | 'userClubId' | 'time' | 'gameSeed' | 'summaries' | 'fixtures'>;

/**
 * 리그 순위표 (현재 시즌). 사용자 리그 = 엔진 요약(xG 포함), 다른 리그 = 경량 시뮬 스코어(D7).
 * 타이브레이크 시드: 사용자 리그 `${seed}|tiebreak|${season}`, 다른 리그는 뒤에 `|${leagueId}`. 구역은 리그별 승강 인원.
 */
export function leagueTable(state: TableState, league: LeagueState): StandingRow[] {
  const season = state.time.season;
  const moves = movesOf(league.tier);
  if (league.id === userLeagueOf(state).id) {
    return computeStandings([...league.clubIds].sort(), Object.values(state.summaries), season, hashString(`${state.gameSeed}|tiebreak|${season}`), moves);
  }
  const res = resultsOfFixtures(state.fixtures.filter((f) => f.leagueId === league.id && f.season === season));
  return computeStandings(league.clubIds, res, season, hashString(`${state.gameSeed}|tiebreak|${season}|${league.id}`), moves);
}

/** 시즌 최종 순위표 → 경계별 승강 이동 (BOUNDARY_MOVES). 위 리그 하위 n팀 ↓, 아래 리그 상위 n팀 ↑. 단일 리그 = [] */
export function seasonMovements(state: TableState, tables: ReadonlyMap<LeagueId, readonly StandingRow[]>): ClubMovement[] {
  const ls = [...leaguesOf(state)].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  const out: ClubMovement[] = [];
  const mv = (r: StandingRow, from: Tier, to: Tier, kind: ClubMovement['kind']): ClubMovement => ({
    clubId: r.clubId,
    from,
    to,
    kind,
    position: r.position,
    isHuman: !!state.clubs[r.clubId]?.isHuman,
  });
  for (let i = 0; i + 1 < ls.length; i++) {
    const up = ls[i]!;
    const down = ls[i + 1]!;
    const n = BOUNDARY_MOVES[up.tier as keyof typeof BOUNDARY_MOVES];
    const upT = tables.get(up.id) ?? [];
    const downT = tables.get(down.id) ?? [];
    for (const r of upT.slice(upT.length - n)) out.push(mv(r, up.tier, down.tier, 'RELEGATED'));
    for (const r of downT.slice(0, n)) out.push(mv(r, down.tier, up.tier, 'PROMOTED'));
  }
  return out;
}

/** 이동을 리그 구성에 반영 (새 배열, clubIds 정렬) */
export function applyMovements(leagues: readonly LeagueState[], movements: readonly ClubMovement[]): LeagueState[] {
  const to = new Map(movements.map((m) => [m.clubId, m.to]));
  return leagues.map((l) => ({
    ...l,
    clubIds: [
      ...l.clubIds.filter((id) => !to.has(id)),
      ...movements.filter((m) => m.to === l.tier).map((m) => m.clubId),
    ].sort(),
  }));
}

export function buildPyramid(state: Pick<GameState, 'leagues' | 'clubs' | 'settings' | 'userClubId' | 'time'>): Pyramid {
  const user = userLeagueOf(state);
  const leagues = leaguesOf(state)
    .map((l) => leagueInfo(l.tier, l.clubIds, l.id === user.id))
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  return { season: state.time.season, leagues, userLeagueId: user.id };
}

/** 판정 끝난 시즌들(오래된 순)로 사용자 구단 커리어를 만든다. 순위표에 없는 시즌은 건너뛴다 */
export function buildCareer(clubId: ClubId, outcomes: readonly SeasonOutcome[], startTier: Tier, currentTier: Tier): CareerRecord {
  const seasons: CareerSeason[] = [];
  for (const o of outcomes) {
    const r = o.finalTable.find((x) => x.clubId === clubId);
    if (!r) continue;
    seasons.push({
      season: o.season,
      tier: o.tier,
      leagueId: o.leagueId ?? leagueIdOf(o.tier),
      position: r.position,
      points: r.points,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      label: o.labels[clubId] ?? 'STAYED',
      champion: o.championId === clubId,
    });
  }
  const tiers = [startTier, currentTier, ...seasons.map((x) => x.tier)];
  return {
    clubId,
    startTier,
    currentTier,
    seasons,
    trophies: seasons.filter((x) => x.champion).map((x) => ({ season: x.season, tier: x.tier, kind: 'LEAGUE_TITLE' as const })),
    highestTier: TIERS.find((t) => tiers.includes(t)) ?? currentTier,
  };
}
