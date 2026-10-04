/**
 * 하루 진행 상태 머신 (아키텍처 문서 6장). 순수 함수: (state) → (newState, result).
 * services 는 이 결과를 저장·통지만 한다. 소유: A.
 * 구현 메모: advanceDayState 는 최상위 컨테이너만 얕게 복사하고(shallowCopy) 안쪽 객체는 항상 새 객체로 교체한다(구조적 공유, 제자리 수정 금지 — 6.3).
 * 70구단 상태 전체 structuredClone 이 하루 처리의 1/4 을 먹어서 바꿨다. 테스트가 깊게 얼린 입력으로 이를 검사한다.
 */
import type {
  BotStyle,
  Club,
  ClubId,
  DayResult,
  Finance,
  Fixture,
  GameState,
  LeagueId,
  LeagueState,
  GameTimestamp,
  LedgerEntry,
  LifecycleEvent,
  MatchResult,
  MatchSummary,
  Membership,
  Player,
  PlayerId,
  ResolvedPlan,
  SlotKey,
  StandingRow,
  StoredMatchRecord,
  TeamMatchStats,
  TeamSummaryLite,
  TacticCap,
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
import { TIER_ECONOMY, carryOver, dailySalary, matchBonus, postLedger, prizeFor, startingBalance } from '../economy/economy';
import { DomainError } from '../errors';
import { judgeSeason } from '../league/promotion';
import { generateDoubleRoundRobin } from '../league/schedule';
import { lastTacticOf } from '../league/scout';
import { TIERS, clubTierMap, leagueIdOf, leagueTable, leaguesOf, seasonMovements, userLeagueOf } from '../league/pyramid';
import { quickSimScore, teamStrength } from '../league/quickSim';
import { expectedPoints } from '../league/xpts';
import { toEngineTeamInput } from '../plan/engineInput';
import { resolvePlan, stripOpponentOrders } from '../plan/resolvePlan';
import { buildReport, computeLeagueAverages } from '../report/buildReport';
import { applyDailyRecovery, applyMatchLine, applyMoraleResult } from '../squad/condition';
import { TIER_REFERENCE_OVR, botName, createBotClub, gauss, generateSquad } from '../squad/generator';
import { LIFECYCLE, lifeRng, rollRetirement, trainingFocusOf, weeklyGrowth } from '../squad/lifecycle';
import { youthDeadline } from '../career/youth';
import { mailLifecycle, transferDaily } from '../transfer/flow';
import { josa } from '../josa';

/**
 * 세이브 스키마. 2 (엔진 0.4.0): Club.botStyle → Club.style (WIDE → WING_PLAY), 3·5백 FB 공격형 풀백 → 윙백.
 * 3 (계약 2.1.1, M3.3): 5티어 피라미드(leagues) 필수 — 단일 리그 세이브는 T3 에 배치하고 나머지 티어를 만든다(save/migrate.ts)
 */
export const SCHEMA_VERSION = 3;
export const MATCH_DAYS = 26;
export const REVIEW_DAY = 27;
export const SETTLEMENT_DAY = 28;
export const TRANSFER_BUDGET_EXPIRY_DAY = 3;
export const USER_CLUB_ID = 'c01';
export const OWNER_ID = 'u-owner';
export const COACH_ID = 'u-coach';
export const SYSTEM_ACTOR = 'system';
const LEAGUE_SIZE = 14;
/** 봇 13팀 성향 분포 (8 스타일): 포지셔널·역습·게겐·로우 블록·윙 플레이 2 · 다이렉트·하이 라인·3백 윙백 1 */
export const BOT_STYLE_DISTRIBUTION: BotStyle[] = [
  'POSSESSION',
  'POSSESSION',
  'COUNTER',
  'COUNTER',
  'HIGH_PRESS',
  'HIGH_PRESS',
  'LOW_BLOCK',
  'LOW_BLOCK',
  'WING_PLAY',
  'WING_PLAY',
  'DIRECT',
  'HIGH_LINE',
  'WINGBACK_3',
];
/** D14 (수명주기 설계 12장) [PH]: 새 게임 구단 목표 OVR = ref(T) + N(0, sd), 허용 범위 ref ± range */
export const TIER_BAND = { sd: 2, range: 6 } as const;

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

/** 원장은 사용자 리그 구단만 남긴다. 다른 리그(경량 시뮬, D7)는 잔액만 — 세이브 크기 */
export function post(state: GameState, clubId: ClubId, entry: Omit<LedgerEntry, 'season' | 'day'>, sink?: LedgerEntry[]): void {
  const f = state.finances[clubId];
  if (!f) return;
  const e: LedgerEntry = { season: state.time.season, day: state.time.day, ...entry };
  const keepLedger = !state.leagues || userLeagueOf(state).clubIds.includes(clubId);
  state.finances[clubId] = keepLedger ? postLedger(f, e) : { ...f, balance: f.balance + e.amount };
  if (sink && clubId === state.userClubId) sink.push(e);
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ───────────────────────────────────────────── 생성

/** D14: 티어 대역 안에서 봇 구단 하나 생성 (구단별 시드 파생, 생성 순서와 무관) */
function makeTierBot(gameSeed: number, id: ClubId, tier: Tier, style: BotStyle): { club: Club; players: Player[] } {
  const rng = mulberry32(hashString(`${gameSeed}|club|${id}`));
  const ref = TIER_REFERENCE_OVR[tier];
  const target = clamp(ref + gauss(rng) * TIER_BAND.sd, ref - TIER_BAND.range, ref + TIER_BAND.range);
  const squad = generateSquad(rng, { clubId: id, targetOvr: Math.round(target * 10) / 10, size: 22, tier });
  const club = createBotClub(rng, id, style, squad);
  const nm = botName(Number(id.slice(1)) - 2);
  return { club: { ...club, name: nm.name, shortName: nm.shortName }, players: squad };
}

/** 한 시즌 일정: 리그마다 더블 라운드로빈, leagueId 채움. 사용자 리그 시드는 단일 리그 시절과 같다 */
export function seasonFixtures(state: Pick<GameState, 'gameSeed' | 'leagues' | 'clubs' | 'settings' | 'userClubId'>, season: number): Fixture[] {
  const user = userLeagueOf(state);
  const out: Fixture[] = [];
  for (const l of leaguesOf(state)) {
    const key = l.id === user.id ? `${state.gameSeed}|schedule|${season}` : `${state.gameSeed}|schedule|${season}|${l.id}`;
    for (const f of generateDoubleRoundRobin(l.clubIds, season, mulberry32(hashString(key)))) out.push({ ...f, leagueId: l.id });
  }
  return out;
}

export function emptyFinance(clubId: ClubId): Finance {
  return { clubId, balance: 0, transferOnlyBudget: 0, ledger: [] };
}

/**
 * 일할 연봉. 강등 시즌 연봉 전용 계정(Finance.parachute, K4)이 있으면 새 캡을 넘는 연봉분의 일할을 계정에서 대신 낸다(PARACHUTE +).
 */
function paySalary(state: GameState, cid: ClubId, day: number, tier: Tier, sink?: LedgerEntry[]): void {
  const total = salaryTotal(state, cid);
  post(state, cid, { kind: 'SALARY', amount: -dailySalary(total, day), memo: `연봉 (${day}일차)` }, sink);
  const f = state.finances[cid];
  if (!f?.parachute) return;
  const cover = Math.min(f.parachute, dailySalary(Math.max(0, total - TIER_ECONOMY[tier].salaryCap), day));
  if (cover <= 0) return;
  state.finances[cid] = { ...f, parachute: f.parachute - cover };
  post(state, cid, { kind: 'PARACHUTE', amount: cover, memo: '강등 연봉 전용 계정 (캡 초과분)' }, sink);
}

/** Day 1 00:00: 기본 배정금 입금 + 1일차 연봉 (구단마다 자기 티어 수치) */
export function dayOneProcessing(state: GameState): void {
  const tiers = clubTierMap(state);
  for (const id of Object.keys(state.clubs).sort()) {
    const tier = tiers.get(id) ?? state.settings.tier;
    post(state, id, { kind: 'SEASON_BUDGET', amount: TIER_ECONOMY[tier].seasonBudget, memo: '시즌 기본 배정금' });
    paySalary(state, id, 1, tier);
  }
}

export function createInitialState(
  seed: number,
  opts: { clubName: string; tier: Tier; devMode: boolean; tacCap?: TacticCap },
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
  // 피라미드 (D3): 사용자 리그 = c01~c14, 나머지 티어는 T1 → T5 순으로 c15~c70
  const leagues: LeagueState[] = [];
  let next = LEAGUE_SIZE;
  for (const t of TIERS) {
    const ids = Array.from({ length: LEAGUE_SIZE }, (_, i) => clubIdFor(t === tier ? i : next + i));
    if (t !== tier) next += LEAGUE_SIZE;
    leagues.push({ id: leagueIdOf(t), tier: t, clubIds: ids.sort() });
  }
  const clubs: Record<ClubId, Club> = { [userId]: userClub };
  const players: Record<string, Player> = {};
  for (const p of human) players[p.id] = p;
  for (const l of leagues) {
    const styles = shuffle(mulberry32(hashString(`${gameSeed}|styles|${l.id}`)), BOT_STYLE_DISTRIBUTION);
    l.clubIds.filter((id) => id !== userId).forEach((id, k) => {
      const b = makeTierBot(gameSeed, id, l.tier, styles[k % styles.length]!);
      clubs[id] = b.club;
      for (const p of b.players) players[p.id] = p;
    });
  }
  const clubIds = Object.keys(clubs).sort();
  const tierOf = new Map(leagues.flatMap((l) => l.clubIds.map((id) => [id, l.tier] as const)));
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
    settings: { tier, tacCap: opts.tacCap ?? EngineConstants.DEFAULT_TAC_CAP, devMode: opts.devMode },
    userClubId: userId,
    actorUserId: OWNER_ID,
    clubs,
    players,
    leagues,
    fixtures: [],
    summaries: {},
    records: {},
    plans: {},
    // K3: 시작 잔액 = 자기 티어 배정금 × 20%
    finances: Object.fromEntries(clubIds.map((id) => [id, { ...emptyFinance(id), balance: startingBalance(TIER_ECONOMY[tierOf.get(id)!]) }])),
    memberships,
    proposals: {},
    seasonHistory: [],
    actionLog: [],
  };
  state.fixtures = seasonFixtures(state, 1);
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
    ...(t.shotsOnTarget !== undefined ? { shotsOnTarget: t.shotsOnTarget } : {}),
    ...(t.corners !== undefined ? { corners: t.corners } : {}),
    ...(t.yellowCards !== undefined ? { yellowCards: t.yellowCards } : {}),
    ...(t.possessionTime !== undefined ? { possessionTime: r3(t.possessionTime) } : {}),
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
  const events: LifecycleEvent[] = [];
  for (const id of state.clubs[clubId]?.playerIds ?? []) {
    const p = state.players[id];
    if (!p) continue;
    state.players[id] = applyMoraleResult(applyMatchLine(p, lines.get(id), true, events), letter);
  }
  // 경고 누적 편지 (수명주기 10.1): 사람 구단만. 경고·정지 사건에는 clubId 가 없어 여기서 거른다
  if (clubId === state.userClubId) mailLifecycle(state, events);
}

function dailyProcessing(state: GameState, usedSlots: Map<ClubId, SlotKey[]>, sink: LedgerEntry[], notices: string[]): void {
  const day = state.time.day;
  const tiers = clubTierMap(state);
  const econOf = (cid: ClubId) => TIER_ECONOMY[tiers.get(cid) ?? state.settings.tier];
  // 수명주기 (설계 2.2): Day 8·15·22·28 성장 틱(끝난 주의 포커스), Day 20 은퇴 판정
  lifecycleDaily(state, tiers, notices);
  // 훈련 포커스 예약값 적용 (8.3: 주 시작 Day 8·15·22, Day 1 은 시즌 경계) — 성장 틱 뒤, 오늘 회복·숙련부터 새 포커스
  if (WEEK_START_DAYS.includes(day)) rollTrainingFocus(state);
  // 유스 마감 (7.1): Day 8 00:00 미결정분 자동 처리
  youthDeadline(state);
  // 회복(+회복 포커스 +4)·부상 일수
  for (const [id, p] of Object.entries(state.players)) {
    const club = p.clubId ? state.clubs[p.clubId] : undefined;
    state.players[id] = applyDailyRecovery(p, club ? (LIFECYCLE.focus[trainingFocusOf(club)].recoveryBonus ?? 0) : 0);
  }
  // 숙련도: 미사용 슬롯 −2, 전술 숙련 포커스는 두 슬롯 +3·감쇠 없음 (사용자 리그만: 경량 시뮬 리그는 전술을 쓰지 않으므로 숙련도를 그대로 둔다)
  for (const cid of [...userLeagueOf(state).clubIds].sort()) {
    const club = state.clubs[cid];
    if (!club) continue;
    const used = usedSlots.get(cid) ?? [];
    const daily = LIFECYCLE.focus[trainingFocusOf(club)].familiarityDaily;
    const tactics = { ...club.tactics };
    for (const k of ['A', 'B'] as SlotKey[]) {
      if (daily) tactics[k] = { ...tactics[k], familiarity: Math.min(100, tactics[k].familiarity + daily) };
      else if (!used.includes(k)) tactics[k] = { ...tactics[k], familiarity: Math.max(0, tactics[k].familiarity - EngineConstants.FAMILIARITY.unusedDailyDecay) };
    }
    state.clubs[cid] = { ...club, tactics };
  }
  // 연봉 일할 차감 (28일 합계 = 연봉 총액)
  for (const cid of Object.keys(state.clubs).sort()) paySalary(state, cid, day, tiers.get(cid) ?? state.settings.tier, sink);
  // Day 3: 이적창 한정 예산 소멸(LP 전환 표시)
  if (day === TRANSFER_BUDGET_EXPIRY_DAY) {
    for (const cid of Object.keys(state.finances).sort()) {
      const f = state.finances[cid]!;
      if (f.transferOnlyBudget <= 0) continue;
      const lp = f.transferOnlyBudget;
      state.finances[cid] = { ...f, transferOnlyBudget: 0, legacyPoints: (f.legacyPoints ?? 0) + lp / 1_000_000 };
      post(state, cid, { kind: 'TRANSFER_BUDGET_EXPIRED', amount: 0, memo: `쓰지 않은 이적창 한정 예산 ${lp} KC 소멸` }, sink);
      if (cid === state.userClubId) notices.push(`쓰지 않은 이적창 한정 예산 ${josa(`${(lp / 1_000_000).toFixed(2)}M`, '이/가')} 사라졌어요`);
    }
  }
  // Day 27: 순위 상금·우승 수당 (사용자 리그 = 판정표, 다른 리그 = 경량 시뮬 스코어로 계산한 순위)
  if (day === REVIEW_DAY && state.pendingOutcome) {
    const tables: [Tier, StandingRow[]][] = [[state.settings.tier, state.pendingOutcome.finalTable]];
    const user = userLeagueOf(state);
    for (const l of leaguesOf(state)) if (l.id !== user.id) tables.push([l.tier, leagueTable(state, l)]);
    for (const [tier, table] of tables) {
      for (const row of table) {
        const pr = prizeFor(TIER_ECONOMY[tier], row.position);
        post(state, row.clubId, { kind: 'PRIZE', amount: pr.prize, memo: `${row.position}위 순위 상금` }, sink);
        if (pr.champion > 0) post(state, row.clubId, { kind: 'CHAMPION_BONUS', amount: pr.champion, memo: '우승 수당' }, sink);
      }
    }
  }
  // Day 28: 이월 판정 (연봉 전용 계정은 소멸, 이월 계산 제외)
  if (day === SETTLEMENT_DAY) {
    for (const cid of Object.keys(state.finances).sort()) {
      const { parachute, ...f } = state.finances[cid]!;
      if (parachute !== undefined) state.finances[cid] = f;
      const co = carryOver(f, econOf(cid));
      if (co.excess > 0) {
        post(state, cid, { kind: 'CARRY_EXCESS_SPLIT', amount: -co.excess, memo: `이월 상한 ${co.cap} 초과분 → 이적창 한정 예산` }, sink);
        const g = state.finances[cid]!;
        state.finances[cid] = { ...g, transferOnlyBudget: g.transferOnlyBudget + co.excess };
        if (cid === state.userClubId) notices.push(`이월 상한 초과분 ${josa(`${(co.excess / 1_000_000).toFixed(2)}M`, '이/가')} 이적창 한정 예산으로 옮겨졌어요. 다음 시즌 Day 3 전에 쓰지 않으면 사라져요`);
      }
    }
  }
  // 이적·계약·편지함 (M4.4): 창 열림·AI 입찰·정산·재계약 창·D18
  transferDaily(state, sink, notices);
}

/** 하루 처리가 쓰는 컨테이너만 새로 만든다. 안쪽 값(선수·구단·재정·일정 한 건)은 교체만 하고 고치지 않는다 */
function shallowCopy(input: GameState): GameState {
  return {
    ...input,
    time: { ...input.time },
    clubs: { ...input.clubs },
    players: { ...input.players },
    fixtures: [...input.fixtures],
    summaries: { ...input.summaries },
    records: { ...input.records },
    plans: { ...input.plans },
    finances: { ...input.finances },
    proposals: { ...input.proposals },
    actionLog: [...input.actionLog],
  };
}

export function advanceDayState(input: GameState, nowIso: string): AdvanceOutcome {
  if (input.phase === 'SEASON_OVER') throw new DomainError('INVALID_PHASE', '시즌이 끝났어요. 새 시즌을 시작해 보세요');
  const state = shallowCopy(input);
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
      result: { from, to: { ...state.time }, phaseAfter: state.phase, matches, ledger, expiredProposals: expired, ...(seasonOutcome ? { seasonOutcome } : {}), notices: ['시즌이 끝났어요. 새 시즌을 시작할 수 있어요'], processedAt: ts(state) },
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
    // 2 RESOLVE_PLANS (사용자 리그만 풀 엔진, 나머지는 아래 경량 시뮬 D7)
    const userIds = new Set(userLeagueOf(state).clubIds);
    const tiers = clubTierMap(state);
    const fxIndex = new Map(state.fixtures.map((f, i) => [f.id, i]));
    const dayFixtures = state.fixtures.filter((f) => f.season === state.time.season && f.day === d && !f.played).sort((a, b) => a.id.localeCompare(b.id));
    const todays = dayFixtures.filter((f) => userIds.has(f.homeId));
    const quick = dayFixtures.filter((f) => !userIds.has(f.homeId));
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
      const hg = result.home.goals;
      const ag = result.away.goals;
      state.fixtures[fxIndex.get(f.id)!] = { ...f, played: true, score: { home: hg, away: ag } };
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
      const econ = TIER_ECONOMY[tiers.get(f.homeId) ?? state.settings.tier];
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
    // 3' 경량 시뮬 (D7): 다른 리그는 스코어와 수당만. 선수 상태(컨디션·부상·스탯)는 건드리지 않는다
    for (const f of quick) {
      const score = quickSimScore(
        mulberry32(hashString(`${state.gameSeed}|quick|${f.id}`)),
        teamStrength(clubPlayers(state, f.homeId)),
        teamStrength(clubPlayers(state, f.awayId)),
      );
      state.fixtures[fxIndex.get(f.id)!] = { ...f, played: true, score };
      const econ = TIER_ECONOMY[tiers.get(f.homeId) ?? state.settings.tier];
      post(state, f.homeId, { ...matchBonus(econ, score.home, score.away), memo: `${f.id} 경기 수당` });
      post(state, f.awayId, { ...matchBonus(econ, score.away, score.home), memo: `${f.id} 경기 수당` });
    }
    // 5 SEASON_JUDGEMENT: 사용자 리그 판정 + 전 리그 최종 순위로 승강 이동 확정(M3.3). 실제 이동은 시즌 경계(startNewSeasonState)
    if (d === MATCH_DAYS) {
      const tables = new Map<LeagueId, StandingRow[]>(leaguesOf(state).map((l) => [l.id, leagueTable(state, l)]));
      const user = userLeagueOf(state);
      const table = tables.get(user.id)!;
      state.pendingOutcome = { ...judgeSeason(state.time.season, state.settings.tier, table, state.clubs), leagueId: user.id, movements: seasonMovements(state, tables) };
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

// ───────────────────────────────────────────── 수명주기 (일일)

/** 성장 틱 날(설계 2.2: Day 8·15·22·28 00:00 = 직전 주 W1~W4) */
const GROWTH_DAYS = [8, 15, 22, 28];
/** 훈련 포커스 주 시작 (Day 1 은 시즌 경계 startNewSeasonState) */
const WEEK_START_DAYS = [8, 15, 22];

/** 예약된 포커스(training.next)를 적용 (8.3). Day 1·8·15·22 00:00 */
export function rollTrainingFocus(state: GameState): void {
  for (const c of Object.values(state.clubs)) if (c.training?.next) state.clubs[c.id] = { ...c, training: { focus: c.training.next } };
}
/** 경량 시뮬 리그 출전 비중 대용: 스쿼드 OVR 순위 상위 11명 0.85, 12~16위 0.35, 나머지 0.05 (설계 13.2 모델) */
const QUICK_SHARE = [
  [11, 0.85],
  [16, 0.35],
  [Infinity, 0.05],
] as const;

function lifecycleDaily(state: GameState, tiers: Map<ClubId, Tier>, notices: string[]): void {
  const { day, season } = state.time;
  const w = GROWTH_DAYS.indexOf(day);
  if (w >= 0) {
    const userIds = new Set(userLeagueOf(state).clubIds);
    const share = new Map<PlayerId, number>();
    for (const cid of Object.keys(state.clubs)) {
      if (userIds.has(cid)) continue;
      clubPlayers(state, cid)
        .sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id))
        .forEach((p, r) => share.set(p.id, QUICK_SHARE.find(([n]) => r < n)![1]));
    }
    const clubMatches = LIFECYCLE.weekMatches[w]!;
    for (const id of Object.keys(state.players).sort()) {
      const p = state.players[id]!;
      const club = p.clubId ? state.clubs[p.clubId] : undefined;
      const focus = club ? trainingFocusOf(club) : 'BALANCED';
      const g = weeklyGrowth(p, lifeRng(state.gameSeed, season, `grow-w${w + 1}`, id), { clubMatches, share: share.get(id), focus }).player;
      if (g !== p) state.players[id] = g;
    }
  }
  if (day === LIFECYCLE.retireAnnounceDay) {
    for (const cid of Object.keys(state.clubs).sort()) {
      const ref = TIER_REFERENCE_OVR[tiers.get(cid) ?? state.settings.tier];
      for (const p of clubPlayers(state, cid)) {
        if (p.retiring || !rollRetirement(p, lifeRng(state.gameSeed, season, 'retire', p.id), ref)) continue;
        state.players[p.id] = { ...p, retiring: true };
        if (cid === state.userClubId) {
          notices.push(`${p.name}(${p.age}세) 선수가 이번 시즌을 끝으로 은퇴해요`);
          mailLifecycle(state, [{ kind: 'RETIRE_ANNOUNCED', playerId: p.id, clubId: cid }]);
        }
      }
    }
  }
}
