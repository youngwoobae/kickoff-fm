/**
 * 2.1.0 피라미드 규칙 (D3: 5티어 × 1리그 × 14팀, 메인 결정 U-1: T3↔T4·T4↔T5 경계 3팀, T1~T3 사이 2팀).
 * M3.1: 규칙 상수·커리어. M3.2: GameState.leagues 조회 도우미. 실제 승강은 M3.3.
 */
import type { CareerRecord, CareerSeason, ClubId, GameState, LeagueId, LeagueInfo, LeagueState, Pyramid, SeasonOutcome, Tier } from '../../types';

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

/** 구단 → 리그 ID */
export function clubLeagueMap(state: Pick<GameState, 'leagues' | 'clubs' | 'settings'>): Map<ClubId, LeagueId> {
  const m = new Map<ClubId, LeagueId>();
  for (const l of leaguesOf(state)) for (const id of l.clubIds) m.set(id, l.id);
  return m;
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
