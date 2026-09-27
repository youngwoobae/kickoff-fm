/**
 * 하루 진행 상태 머신 (아키텍처 문서 6장). 순수 함수: (state) → (newState, result).
 * services 는 이 결과를 저장·통지만 한다. 소유: A.
 * 구현 메모: 입력 상태를 structuredClone 으로 복제한 뒤 복제본만 수정한다(입력 불변 보장).
 */
import type {
  BotStyleTag,
  Club,
  ClubId,
  DayResult,
  Finance,
  Fixture,
  GameState,
  GameTimestamp,
  LedgerEntry,
  MatchResult,
  MatchSummary,
  Membership,
  Player,
  ResolvedPlan,
  SlotKey,
  StoredMatchRecord,
  TeamMatchStats,
  TeamSummaryLite,
  Tier,
} from '../../types';
import {
  ENGINE_VERSION,
  EngineConstants,
  VALUE_TABLE,
  clamp,
  explainMatch,
  hashString,
  mulberry32,
  seedFrom,
  simulateMatch,
  usedSlotsOf,
  type Rng,
} from '../../engine';
import { buildPlan, humanDefaultTactics } from '../ai/managerAi';
import { TIER_ECONOMY, carryOver, dailySalary, matchBonus, postLedger, prizeFor } from '../economy/economy';
import { DomainError } from '../errors';
import { judgeSeason } from '../league/promotion';
import { generateDoubleRoundRobin } from '../league/schedule';
import { lastTacticOf } from '../league/scout';
import { computeStandings } from '../league/standings';
import { expectedPoints } from '../league/xpts';
import { toEngineTeamInput } from '../plan/engineInput';
import { resolvePlan, stripOpponentOrders } from '../plan/resolvePlan';
import { buildReport, computeLeagueAverages } from '../report/buildReport';
import { applyDailyRecovery, applyMatchLine, applyMoraleResult } from '../squad/condition';
import { TIER_REFERENCE_OVR, botName, createBotClub, generateSquad } from '../squad/generator';
import { OVR_WEIGHTS, computeOvr } from '../squad/ovr';

export const SCHEMA_VERSION = 1;
export const MATCH_DAYS = 26;
export const REVIEW_DAY = 27;
export const SETTLEMENT_DAY = 28;
export const TRANSFER_BUDGET_EXPIRY_DAY = 3;
export const USER_CLUB_ID = 'c01';
export const OWNER_ID = 'u-owner';
export const COACH_ID = 'u-coach';
export const SYSTEM_ACTOR = 'system';
const LEAGUE_SIZE = 14;
/** 봇 13팀 성향 분포: 점유 3 · 역습 3 · 전방압박 3 · 잠그기 2 · 측면 2 */
export const BOT_STYLE_DISTRIBUTION: BotStyleTag[] = [
  'POSSESSION',
  'POSSESSION',
  'POSSESSION',
  'COUNTER',
  'COUNTER',
  'COUNTER',
  'HIGH_PRESS',
  'HIGH_PRESS',
  'HIGH_PRESS',
  'LOW_BLOCK',
  'LOW_BLOCK',
  'WIDE',
  'WIDE',
];
/** 봇 전력 = 사람 팀 주전 평균 OVR × U(0.90, 1.08) [PH] (아키텍처 15장 #2) */
export const BOT_STRENGTH_RANGE: [number, number] = [0.9, 1.08];

export interface AdvanceOutcome {
  state: GameState;
  result: DayResult;
}

// ───────────────────────────────────────────── 공통 도우미

export function clubIdFor(index: number): ClubId {
  return `c${String(index + 1).padStart(2, '0')}`;
}

export function clubPlayers(state: GameState, clubId: ClubId): Player[] {
  const c = state.clubs[clubId];
  return c ? c.playerIds.map((id) => state.players[id]).filter((p): p is Player => !!p) : [];
}

export function salaryTotal(state: GameState, clubId: ClubId): number {
  return clubPlayers(state, clubId).reduce((s, p) => s + p.contract.salary, 0);
}

/** 주전 평균 OVR (상위 11명) */
export function starterOvr(players: readonly Player[]): number {
  const top = [...players].sort((a, b) => b.ovr - a.ovr).slice(0, 11);
  return top.length > 0 ? top.reduce((s, p) => s + p.ovr, 0) / top.length : 0;
}

export function fixtureFor(state: GameState, clubId: ClubId, day: number): Fixture | undefined {
  return state.fixtures.find((f) => f.season === state.time.season && f.day === day && (f.homeId === clubId || f.awayId === clubId));
}

function ts(state: GameState): GameTimestamp {
  return { season: state.time.season, day: state.time.day, seq: state.seq };
}

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function post(state: GameState, clubId: ClubId, entry: Omit<LedgerEntry, 'season' | 'day'>, sink?: LedgerEntry[]): void {
  const f = state.finances[clubId];
  if (!f) return;
  const e: LedgerEntry = { season: state.time.season, day: state.time.day, ...entry };
  state.finances[clubId] = postLedger(f, e);
  if (sink && clubId === state.userClubId) sink.push(e);
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ───────────────────────────────────────────── 생성

function makeBots(
  rng: Rng,
  season: number,
  tier: Tier,
  humanOvr: number,
  ids: ClubId[],
): { clubs: Club[]; players: Player[] } {
  const styles = shuffle(rng, BOT_STYLE_DISTRIBUTION);
  const clubs: Club[] = [];
  const players: Player[] = [];
  ids.forEach((id, k) => {
    const [lo, hi] = BOT_STRENGTH_RANGE;
    const ovr = humanOvr * (lo + rng() * (hi - lo));
    const squadId = season === 1 ? id : `s${season}${id}`;
    const squad = generateSquad(rng, { clubId: squadId, targetOvr: Math.round(ovr * 10) / 10, size: 22, tier }).map((p) => ({ ...p, clubId: id }));
    const style = styles[k % styles.length]!;
    const club = createBotClub(rng, id, style, squad);
    const idx = Number(id.slice(1)) - 2;
    const nm = botName(idx);
    clubs.push({ ...club, name: nm.name, shortName: nm.shortName });
    players.push(...squad);
  });
  return { clubs, players };
}

function emptyFinance(clubId: ClubId): Finance {
  return { clubId, balance: 0, transferOnlyBudget: 0, ledger: [] };
}

/** Day 1 00:00: 기본 배정금 입금 + 1일차 연봉 */
function dayOneProcessing(state: GameState): void {
  const econ = TIER_ECONOMY[state.settings.tier];
  for (const id of Object.keys(state.clubs).sort()) {
    post(state, id, { kind: 'SEASON_BUDGET', amount: econ.seasonBudget, memo: '시즌 기본 배정금' });
    post(state, id, { kind: 'SALARY', amount: -dailySalary(salaryTotal(state, id), 1), memo: '연봉 (1일차)' });
  }
}

export function createInitialState(
  seed: number,
  opts: { clubName: string; tier: Tier; devMode: boolean; tacCap?: 0.25 | 0.35 | 0.5 },
  nowIso: string,
): GameState {
  const gameSeed = seed >>> 0;
  const rng = mulberry32(hashString(`${gameSeed}|init`));
  const tier = opts.tier;
  const humanOvr = TIER_REFERENCE_OVR[tier];
  const userId = USER_CLUB_ID;
  const human = generateSquad(rng, { clubId: userId, targetOvr: humanOvr, size: 22, tier });
  const name = opts.clubName.trim() || '킥오프 FC';
  const userClub: Club = {
    id: userId,
    name,
    shortName: name.replace(/\s*FC$/i, '').slice(0, 4) || name.slice(0, 4),
    isHuman: true,
    ownerUserId: OWNER_ID,
    playerIds: human.map((p) => p.id),
    tactics: humanDefaultTactics(),
  };
  const botIds = Array.from({ length: LEAGUE_SIZE - 1 }, (_, i) => clubIdFor(i + 1));
  const bots = makeBots(rng, 1, tier, starterOvr(human), botIds);
  const clubs: Record<ClubId, Club> = { [userId]: userClub };
  for (const c of bots.clubs) clubs[c.id] = c;
  const players: Record<string, Player> = {};
  for (const p of [...human, ...bots.players]) players[p.id] = p;
  const clubIds = Object.keys(clubs).sort();
  const fixtures = generateDoubleRoundRobin(clubIds, 1, mulberry32(hashString(`${gameSeed}|schedule|1`)));
  const memberships: Membership[] = [
    { clubId: userId, userId: OWNER_ID, seat: 'OWNER', joinedAt: { season: 0, day: 0, seq: 0 }, hasOwnClub: true },
    { clubId: userId, userId: COACH_ID, seat: 'COACH', roleLabel: 'TAC', joinedAt: { season: 0, day: 0, seq: 0 }, hasOwnClub: false },
  ];
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    gameSeed,
    createdAt: nowIso,
    time: { season: 1, day: 1 },
    phase: 'MATCHDAY',
    seq: 0,
    settings: { tier, tacCap: opts.tacCap ?? 0.35, devMode: opts.devMode },
    userClubId: userId,
    actorUserId: OWNER_ID,
    clubs,
    players,
    fixtures,
    summaries: {},
    records: {},
    plans: {},
    finances: Object.fromEntries(clubIds.map((id) => [id, emptyFinance(id)])),
    memberships,
    proposals: {},
    seasonHistory: [],
    actionLog: [],
  };
  dayOneProcessing(state);
  return state;
}

// ───────────────────────────────────────────── 경기일 처리

function summaryLite(t: TeamMatchStats, op: TeamMatchStats): TeamSummaryLite {
  return {
    clubId: t.clubId,
    goals: t.goals,
    xg: r3(t.xg),
    shots: t.shots,
    possession: r3(t.possession),
    formation: t.formationStart,
    instructions: { ...t.instructionsStart },
    zonePass: { z0: { ...t.zonePass.z0 }, z1: { ...t.zonePass.z1 }, z2: { ...t.zonePass.z2 } },
    ruleFires: { ...t.ruleFires },
    xPts: r3(expectedPoints(t.xg, op.xg)),
  };
}

function resolveFor(state: GameState, club: Club, fixture: Fixture): ResolvedPlan {
  const opponentId = fixture.homeId === club.id ? fixture.awayId : fixture.homeId;
  const opponentPlayerIds = state.clubs[opponentId]?.playerIds ?? [];
  if (club.isHuman) {
    return resolvePlan({ club, fixture, planState: state.plans[club.id], players: state.players, opponentPlayerIds });
  }
  const rng = mulberry32(hashString(`${state.gameSeed}|bot|${fixture.id}|${club.id}`));
  const tactic = lastTacticOf(state.clubs, Object.values(state.summaries), opponentId);
  const plan = buildPlan({
    club,
    players: state.players,
    opponentId,
    mode: 'BOT',
    rng,
    ...(tactic ? { opponentTactic: tactic } : {}),
  });
  plan.matchId = fixture.id;
  return resolvePlan({
    club,
    fixture,
    planState: { confirmed: { plan, status: 'CONFIRMED', updatedBy: SYSTEM_ACTOR, updatedAt: ts(state) } },
    players: state.players,
    opponentPlayerIds,
  });
}

/** 한 경기 시뮬 입력 (사용자 재시뮬·리포트 재생성에도 사용) */
export function matchSeed(state: Pick<GameState, 'gameSeed'>, matchId: string, engineVersion = ENGINE_VERSION): number {
  return seedFrom(state.gameSeed, matchId, engineVersion);
}

function applyResultToClub(state: GameState, clubId: ClubId, result: MatchResult, gf: number, ga: number): void {
  const letter = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  const lines = new Map(result.players.filter((l) => l.clubId === clubId).map((l) => [l.playerId, l]));
  for (const id of state.clubs[clubId]?.playerIds ?? []) {
    const p = state.players[id];
    if (!p) continue;
    state.players[id] = applyMoraleResult(applyMatchLine(p, lines.get(id), true), letter);
  }
}

function dailyProcessing(state: GameState, usedSlots: Map<ClubId, SlotKey[]>, sink: LedgerEntry[], notices: string[]): void {
  const day = state.time.day;
  const econ = TIER_ECONOMY[state.settings.tier];
  // 회복·부상 일수
  for (const id of Object.keys(state.players)) state.players[id] = applyDailyRecovery(state.players[id]!);
  // 미사용 슬롯 숙련도 −2
  for (const cid of Object.keys(state.clubs).sort()) {
    const club = state.clubs[cid]!;
    const used = usedSlots.get(cid) ?? [];
    const tactics = { ...club.tactics };
    for (const k of ['A', 'B'] as SlotKey[]) {
      if (used.includes(k)) continue;
      tactics[k] = { ...tactics[k], familiarity: Math.max(0, tactics[k].familiarity - EngineConstants.FAMILIARITY.unusedDailyDecay) };
    }
    state.clubs[cid] = { ...club, tactics };
  }
  // 연봉 일할 차감 (28일 합계 = 연봉 총액)
  for (const cid of Object.keys(state.clubs).sort()) {
    post(state, cid, { kind: 'SALARY', amount: -dailySalary(salaryTotal(state, cid), day), memo: `연봉 (${day}일차)` }, sink);
  }
  // Day 3: 이적창 한정 예산 소멸(LP 전환 표시)
  if (day === TRANSFER_BUDGET_EXPIRY_DAY) {
    for (const cid of Object.keys(state.finances).sort()) {
      const f = state.finances[cid]!;
      if (f.transferOnlyBudget <= 0) continue;
      const lp = f.transferOnlyBudget;
      state.finances[cid] = { ...f, transferOnlyBudget: 0 };
      post(state, cid, { kind: 'TRANSFER_BUDGET_EXPIRED', amount: 0, memo: `이적창 한정 예산 ${lp} KC → ${(lp / 1_000_000).toFixed(2)} LP 전환` }, sink);
      if (cid === state.userClubId) notices.push(`이적창 한정 예산 ${(lp / 1_000_000).toFixed(2)}M 이 LP 로 전환되었습니다`);
    }
  }
  // Day 27: 순위 상금·우승 수당
  if (day === REVIEW_DAY && state.pendingOutcome) {
    const table = state.pendingOutcome.finalTable;
    for (const row of table) {
      const pr = prizeFor(econ, row.position);
      post(state, row.clubId, { kind: 'PRIZE', amount: pr.prize, memo: `${row.position}위 순위 상금` }, sink);
      if (pr.champion > 0) post(state, row.clubId, { kind: 'CHAMPION_BONUS', amount: pr.champion, memo: '우승 수당' }, sink);
    }
  }
  // Day 28: 이월 판정
  if (day === SETTLEMENT_DAY) {
    for (const cid of Object.keys(state.finances).sort()) {
      const f = state.finances[cid]!;
      const co = carryOver(f, econ);
      if (co.excess > 0) {
        post(state, cid, { kind: 'CARRY_EXCESS_SPLIT', amount: -co.excess, memo: `이월 상한 ${co.cap} 초과분 → 이적창 한정 예산` }, sink);
        const g = state.finances[cid]!;
        state.finances[cid] = { ...g, transferOnlyBudget: g.transferOnlyBudget + co.excess };
        if (cid === state.userClubId) notices.push(`이월 상한 초과분 ${(co.excess / 1_000_000).toFixed(2)}M 이 이적창 한정 예산으로 분리되었습니다`);
      }
    }
  }
}

export function advanceDayState(input: GameState, nowIso: string): AdvanceOutcome {
  if (input.phase === 'SEASON_OVER') throw new DomainError('INVALID_PHASE', '시즌이 끝났습니다. 새 시즌을 시작하세요');
  const state: GameState = structuredClone(input);
  const from = { ...state.time };
  state.seq += 1;
  const ledger: LedgerEntry[] = [];
  const notices: string[] = [];
  const expired: string[] = [];
  const matches: MatchSummary[] = [];
  let userMatchId: string | undefined;
  let userResolvedPlan: ResolvedPlan | undefined;
  let seasonOutcome = undefined as DayResult['seasonOutcome'];

  // OFFSEASON Day 28 → SEASON_OVER (날짜 유지)
  if (state.phase === 'OFFSEASON' && state.time.day >= SETTLEMENT_DAY) {
    state.phase = 'SEASON_OVER';
    seasonOutcome = state.pendingOutcome;
    return {
      state,
      result: { from, to: { ...state.time }, phaseAfter: state.phase, matches, ledger, expiredProposals: expired, ...(seasonOutcome ? { seasonOutcome } : {}), notices: ['시즌이 종료되었습니다. 새 시즌을 시작할 수 있습니다'], processedAt: ts(state) },
    };
  }

  const usedSlots = new Map<ClubId, SlotKey[]>();
  if (state.phase === 'MATCHDAY') {
    const d = state.time.day;
    // 1 DEADLINE: 제안 만료
    for (const p of Object.values(state.proposals)) {
      if (p.status !== 'OPEN') continue;
      if (p.expiresAt.season < state.time.season || (p.expiresAt.season === state.time.season && p.expiresAt.day <= d)) {
        state.proposals[p.id] = { ...p, status: 'EXPIRED', resolvedAt: ts(state) };
        expired.push(p.id);
        state.actionLog.push({ at: nowIso, gameTime: { ...state.time }, actor: SYSTEM_ACTOR, kind: 'PROPOSAL_EXPIRED', data: { proposalId: p.id } });
      }
    }
    // 2 RESOLVE_PLANS
    const todays = state.fixtures.filter((f) => f.season === state.time.season && f.day === d && !f.played).sort((a, b) => a.id.localeCompare(b.id));
    const resolved = new Map<string, { home: ResolvedPlan; away: ResolvedPlan }>();
    for (const f of todays) {
      resolved.set(f.id, { home: resolveFor(state, state.clubs[f.homeId]!, f), away: resolveFor(state, state.clubs[f.awayId]!, f) });
    }
    // 3 SIMULATE (matchId 사전순) + 4 APPLY_RESULTS
    const seasonSummaries = () => Object.values(state.summaries).filter((s) => s.season === state.time.season);
    const pending: { f: Fixture; result: MatchResult; homeIn: ReturnType<typeof toEngineTeamInput>; awayIn: ReturnType<typeof toEngineTeamInput>; rp: { home: ResolvedPlan; away: ResolvedPlan } }[] = [];
    for (const f of todays) {
      const rp = resolved.get(f.id)!;
      const homeIn = toEngineTeamInput(state.clubs[f.homeId]!, rp.home, state.players, true);
      const awayIn = toEngineTeamInput(state.clubs[f.awayId]!, rp.away, state.players, false);
      const result = simulateMatch({
        matchId: f.id,
        seed: matchSeed(state, f.id),
        home: homeIn,
        away: awayIn,
        config: { engineVersion: ENGINE_VERSION, tacCap: state.settings.tacCap, tacticsEnabled: true, disabledRules: [] },
      });
      pending.push({ f, result, homeIn, awayIn, rp });
    }
    for (const { f, result, homeIn, awayIn, rp } of pending) {
      const summary: MatchSummary = {
        matchId: f.id,
        season: f.season,
        day: f.day,
        home: summaryLite(result.home, result.away),
        away: summaryLite(result.away, result.home),
        engineVersion: ENGINE_VERSION,
        seed: result.seed,
      };
      state.summaries[f.id] = summary;
      matches.push(summary);
      const fi = state.fixtures.findIndex((x) => x.id === f.id);
      state.fixtures[fi] = { ...f, played: true };
      const hg = result.home.goals;
      const ag = result.away.goals;
      applyResultToClub(state, f.homeId, result, hg, ag);
      applyResultToClub(state, f.awayId, result, ag, hg);
      // 숙련도: 사용 슬롯 +6
      for (const [cid, inp] of [
        [f.homeId, homeIn],
        [f.awayId, awayIn],
      ] as const) {
        const used = usedSlotsOf(result, inp);
        usedSlots.set(cid, used);
        const club = state.clubs[cid]!;
        const tactics = { ...club.tactics };
        for (const k of used) tactics[k] = { ...tactics[k], familiarity: Math.min(100, tactics[k].familiarity + EngineConstants.FAMILIARITY.usedGain) };
        state.clubs[cid] = { ...club, tactics };
      }
      // 경제: 승/무/패 수당 (모든 참가 구단)
      const econ = TIER_ECONOMY[state.settings.tier];
      const hb = matchBonus(econ, hg, ag);
      const ab = matchBonus(econ, ag, hg);
      post(state, f.homeId, { ...hb, memo: `${f.id} 경기 수당` }, ledger);
      post(state, f.awayId, { ...ab, memo: `${f.id} 경기 수당` }, ledger);
      // 적용 플랜 기록, 플랜 비우기
      for (const [cid, r] of [
        [f.homeId, rp.home],
        [f.awayId, rp.away],
      ] as const) {
        const club = state.clubs[cid]!;
        state.clubs[cid] = { ...club, lastUsedPlan: { ...stripOpponentOrders(r.plan), matchId: null } };
        delete state.plans[cid];
      }
      // 사용자 경기: 리포트 + 기록
      const userIsHome = f.homeId === state.userClubId;
      if (userIsHome || f.awayId === state.userClubId) {
        userMatchId = f.id;
        const userRp = userIsHome ? rp.home : rp.away;
        userResolvedPlan = userRp;
        const ex = explainMatch(result, VALUE_TABLE);
        const names = namesOf(homeIn, awayIn);
        const report = buildReport(result, ex, state.userClubId, computeLeagueAverages(seasonSummaries()), seasonSummaries(), names);
        const record: StoredMatchRecord = {
          matchId: f.id,
          seed: result.seed,
          engineVersion: ENGINE_VERSION,
          tacCap: state.settings.tacCap,
          home: homeIn,
          away: awayIn,
          resolvedPlan: userRp,
          report,
        };
        state.records[f.id] = record;
        for (const a of userRp.adjustments) notices.push(`[플랜 보정] ${a.note}`);
        for (const e of result.events) {
          if (e.type === 'INJURY' && e.clubId === state.userClubId) notices.push(`${names[e.playerId] ?? e.playerId} 부상 (${e.days}일)`);
          if (e.type === 'RED_CARD' && e.clubId === state.userClubId) notices.push(`${names[e.playerId] ?? e.playerId} 퇴장 → 다음 경기 출장 정지`);
        }
        const gf = userIsHome ? hg : ag;
        const ga = userIsHome ? ag : hg;
        notices.unshift(`${state.clubs[f.homeId]!.name} ${hg} : ${ag} ${state.clubs[f.awayId]!.name} (${gf > ga ? '승' : gf === ga ? '무' : '패'})`);
      }
    }
    // 5 SEASON_JUDGEMENT
    if (d === MATCH_DAYS) {
      const clubIds = Object.keys(state.clubs).sort();
      const table = computeStandings(clubIds, Object.values(state.summaries), state.time.season, hashString(`${state.gameSeed}|tiebreak|${state.time.season}`));
      state.pendingOutcome = judgeSeason(state.time.season, state.settings.tier, table, state.clubs);
      seasonOutcome = state.pendingOutcome;
      const row = table.find((r) => r.clubId === state.userClubId);
      if (row) notices.push(`최종 순위 ${row.position}위 — ${state.pendingOutcome.labels[state.userClubId] ?? 'STAYED'}`);
    }
  }

  // 6 ROLLOVER
  state.time = { season: state.time.season, day: state.time.day + 1 };
  if (state.time.day > MATCH_DAYS) state.phase = 'OFFSEASON';
  // 7 DAILY_PROCESSING
  dailyProcessing(state, usedSlots, ledger, notices);

  return {
    state,
    result: {
      from,
      to: { ...state.time },
      phaseAfter: state.phase,
      matches,
      ...(userMatchId ? { userMatchId } : {}),
      ...(userResolvedPlan ? { userResolvedPlan } : {}),
      ledger,
      expiredProposals: expired,
      ...(seasonOutcome ? { seasonOutcome } : {}),
      notices,
      processedAt: ts(state),
    },
  };
}

function namesOf(...teams: { starters: { id: string; name: string }[]; bench: { id: string; name: string }[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of teams) for (const p of [...t.starters, ...t.bench]) out[p.id] = p.name;
  return out;
}

// ───────────────────────────────────────────── 새 시즌

function growPlayer(rng: Rng, p: Player): Player {
  const age = p.age + 1;
  const delta = age <= 21 ? 2 : age <= 23 ? 1 : age <= 29 ? 0 : age <= 32 ? -1 : -2;
  if (delta === 0) return { ...p, age };
  const attrs = { ...p.attrs };
  for (const k of Object.keys(OVR_WEIGHTS[p.primary]) as (keyof typeof attrs)[]) {
    if (rng() < 0.5) continue;
    attrs[k] = clamp(attrs[k] + delta, 1, 20);
  }
  let next = { ...p, age, attrs };
  let ovr = computeOvr(next);
  if (delta > 0 && ovr > p.potential) {
    next = { ...p, age };
    ovr = p.ovr;
  }
  return { ...next, ovr };
}

/** SEASON_OVER → 새 시즌 Day 1 (6.5 ⑦⑧⑨⑪ 의 Phase 0 축소판) */
export function startNewSeasonState(input: GameState, nowIso: string): GameState {
  if (input.phase !== 'SEASON_OVER') throw new DomainError('INVALID_PHASE', '시즌 종료 후에만 새 시즌을 시작할 수 있습니다');
  void nowIso;
  const state: GameState = structuredClone(input);
  const season = state.time.season + 1;
  const rng = mulberry32(hashString(`${state.gameSeed}|season|${season}`));
  if (state.pendingOutcome) state.seasonHistory.push(state.pendingOutcome);
  delete state.pendingOutcome;
  state.summaries = {};
  state.records = {};
  state.plans = {};
  state.proposals = Object.fromEntries(Object.entries(state.proposals).filter(([, p]) => p.status === 'OPEN'));
  state.seq += 1;

  // 사람 선수: 나이·성장·노화, 계약 −1 (만료 시 자동 1시즌 재계약 [해석])
  const userId = state.userClubId;
  const human = state.clubs[userId]!;
  for (const id of human.playerIds) {
    const p = state.players[id];
    if (!p) continue;
    const g = growPlayer(rng, p);
    const left = g.contract.seasonsLeft - 1;
    state.players[id] = {
      ...g,
      condition: 100,
      morale: 0,
      contract: { ...g.contract, seasonsLeft: left <= 0 ? 1 : left },
      availability: { ...g.availability, injuryDays: 0 },
      season: { apps: 0, starts: 0, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0 },
    };
  }
  // 봇 폐기·재생성 (id·이름 유지, 선수·성향 새로 생성)
  const botIds = Object.keys(state.clubs).filter((id) => !state.clubs[id]!.isHuman).sort();
  for (const id of botIds) {
    for (const pid of state.clubs[id]!.playerIds) delete state.players[pid];
  }
  const bots = makeBots(rng, season, state.settings.tier, starterOvr(clubPlayers(state, userId)), botIds);
  for (const c of bots.clubs) state.clubs[c.id] = c;
  for (const p of bots.players) state.players[p.id] = p;
  // 새 일정
  const clubIds = Object.keys(state.clubs).sort();
  state.fixtures = generateDoubleRoundRobin(clubIds, season, mulberry32(hashString(`${state.gameSeed}|schedule|${season}`)));
  // 재정: 원장은 새 시즌부터, 봇은 잔액 초기화
  for (const cid of clubIds) {
    const f = state.finances[cid] ?? emptyFinance(cid);
    state.finances[cid] = state.clubs[cid]!.isHuman ? { ...f, ledger: [] } : emptyFinance(cid);
  }
  state.time = { season, day: 1 };
  state.phase = 'MATCHDAY';
  dayOneProcessing(state);
  return state;
}
