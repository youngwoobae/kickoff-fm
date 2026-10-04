/**
 * 시즌 경계 (M3.3, 기획서 6.5 순서) 와 세이브 스키마 2 → 3 피라미드 변환. 소유: A.
 * startNewSeasonState: SEASON_OVER → 새 시즌 Day 1.
 *  ① 판정 보관(movements 채움) ② 선수 시즌 기록(history) ③ 승강 적용(leagues·settings.tier)
 *  ④ 수명주기 경계(설계 15.1: 은퇴 실행 → 나이 +1·노화 → FA 정리 → AI 선수단 관리, 다음 시즌 티어 기준). 사람 구단 유스는 새 시즌 Day 1 후보(youthIntake, M5.1)
 *  ②' 계약 −1·만료(M4.4 contractBoundary) ⑤ 컨디션·시즌 스탯 초기화 ⑥ 리포트 보관 정리(D28: 현재 + 직전 시즌) ⑦ 일정·재정(Day 1 배정금·연봉, K4 승격 보너스·연봉 전용 계정)
 * 멱등(U6): boundarySeason ≥ 끝난 시즌이면 ①~④·K4 를 건너뛴다.
 */
import type { ClubMovement, Fixture, GameState, LeagueId, Player, StandingRow, Tier } from '../../types';
import { hashString, mulberry32 } from '../../engine';
import { baseSalary, parachuteOf, promotionBonus, youthSalary } from '../economy/economy';
import { DomainError } from '../errors';
import { parseMatchId } from '../league/schedule';
import { applyMovements, clubTierMap, leagueIdOf, leagueTable, leaguesOf, seasonMovements, userLeagueOf } from '../league/pyramid';
import { quickSimScore, teamStrength } from '../league/quickSim';
import { ageOneSeason, aiSquadMaintenance, cleanFreeAgents, lifeRng } from '../squad/lifecycle';
import { CONTRACT, type ContractEvent } from '../contract/contract';
import { aiReleasePenalties, boundaryContracts, fillHumanSquads, mailContract, pruneMarket } from '../transfer/flow';
import { clubPlayers, createInitialState, dayOneProcessing, emptyFinance, post, rollTrainingFocus, seasonFixtures } from '../day/advanceDay';
import { offerYouthIntake } from './youth';

/** 스키마 2 단일 리그 세이브가 들어갈 티어 (로드맵 M3.3) */
export const LEGACY_LEAGUE_TIER: Tier = 'T3';

const SEASON_RESET: Player['season'] = { apps: 0, starts: 0, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0 };

/** 생성 선수(연봉 0)는 기준 연봉 S(OVR) (K1), 유스는 유스 연봉 (K14) */
function withSalary(p: Player): Player {
  return p.contract.salary > 0 ? p : { ...p, contract: { ...p.contract, salary: p.academyClubId ? youthSalary(p.ovr) : baseSalary(p.ovr) } };
}

interface BoundaryOut {
  contractEvents: ContractEvent[];
  penalties: { clubId: string; amount: number; memo: string }[];
}

/** ④ 수명주기 경계 (설계 15.1) + 계약 경계(M4.4). state 를 제자리에서 바꾼다(호출자가 복사본을 넘긴다) */
function lifecycleBoundary(state: GameState, ending: number, relegated: ReadonlySet<string>): BoundaryOut {
  const season = ending + 1;
  const players = state.players;
  const removeFromClubs = (gone: Set<string>) => {
    for (const c of Object.values(state.clubs)) if (c.playerIds.some((id) => gone.has(id))) state.clubs[c.id] = { ...c, playerIds: c.playerIds.filter((id) => !gone.has(id)) };
    for (const id of gone) delete players[id];
  };
  // ① 은퇴 실행
  removeFromClubs(new Set(Object.values(players).filter((p) => p.retiring).map((p) => p.id)));
  // ② 나이 +1·노화 (소속 + FA, 임시 제외는 함수가 처리)
  for (const id of Object.keys(players).sort()) players[id] = ageOneSeason(players[id]!, lifeRng(state.gameSeed, ending, 'age', id)).player;
  // ②' 계약 −1, 만료 → 재계약(pendingRenewals: 사람 + Day 20 AI) 또는 FA (M4.4, 나이·OVR 변화 뒤·AI 선수단 관리 전)
  const contractEvents = boundaryContracts(state, ending);
  // ③ FA 풀 정리
  const fa = cleanFreeAgents(Object.values(players).filter((p) => p.clubId === null).sort((a, b) => a.id.localeCompare(b.id)), ending);
  removeFromClubs(new Set(fa.events.map((e) => e.playerId)));
  for (const p of fa.keep) players[p.id] = p;
  // ④ AI 구단 선수단 관리 (승강 반영된 다음 시즌 티어)
  const tiers = clubTierMap(state);
  const ai = Object.values(state.clubs).filter((c) => !c.isHuman);
  const r = aiSquadMaintenance({
    clubs: ai.map((c) => ({ id: c.id, tier: tiers.get(c.id) ?? state.settings.tier, players: clubPlayers(state, c.id), relegated: relegated.has(c.id) })),
    pool: fa.keep,
    season,
    gameSeed: state.gameSeed,
  });
  const penalties = aiReleasePenalties(players, r.events.flatMap((e) => (e.kind === 'RELEASED' ? [e] : [])));
  for (const id of r.removed) delete players[id];
  for (const p of r.pool) players[p.id] = p;
  for (const c of r.clubs) {
    for (const p of c.players) players[p.id] = withSalary(p);
    state.clubs[c.id] = { ...state.clubs[c.id]!, playerIds: c.players.map((p) => p.id) };
  }
  pruneMarket(state);
  return { contractEvents, penalties };
}

/** SEASON_OVER → 새 시즌 Day 1 */
export function startNewSeasonState(input: GameState, nowIso: string): GameState {
  if (input.phase !== 'SEASON_OVER') throw new DomainError('INVALID_PHASE', '시즌 종료 후에만 새 시즌을 시작할 수 있습니다');
  void nowIso;
  const state: GameState = structuredClone(input);
  const ending = state.time.season;
  const season = ending + 1;
  const fresh = (state.boundarySeason ?? 0) < ending;
  const outcome = state.pendingOutcome;
  delete state.pendingOutcome;
  let movements: ClubMovement[] = [];
  let boundary: BoundaryOut | undefined;
  if (fresh) {
    // ① 판정 보관. M3.2 세이브(movements 없음)는 지금 전 리그 최종 순위로 계산
    const user = userLeagueOf(state);
    movements = outcome?.movements ?? seasonMovements(state, new Map<LeagueId, StandingRow[]>(leaguesOf(state).map((l) => [l.id, leagueTable(state, l)])));
    if (outcome) state.seasonHistory.push({ ...outcome, leagueId: outcome.leagueId ?? user.id, movements });
    // ② 선수 시즌 기록 (끝난 시즌의 나이·OVR·소속 티어)
    const prevTier = clubTierMap(state);
    for (const p of Object.values(state.players)) {
      const tier = p.clubId ? prevTier.get(p.clubId) : undefined;
      const line = { season: ending, age: p.age, ovr: p.ovr, clubId: p.clubId, ...(tier ? { tier } : {}), apps: p.season.apps, goals: p.season.goals };
      state.players[p.id] = { ...p, history: [...(p.history ?? []), line] };
    }
    // ③ 승강 적용
    if (state.leagues) {
      state.leagues = applyMovements(state.leagues, movements);
      state.settings = { ...state.settings, tier: userLeagueOf(state).tier };
    }
    // ④ 수명주기
    boundary = lifecycleBoundary(state, ending, new Set(movements.filter((m) => m.kind === 'RELEGATED').map((m) => m.clubId)));
    state.boundarySeason = ending;
    // 강등 시즌 무위약 방출권 (경제 5.3, 사람 구단)
    if (movements.some((m) => m.clubId === state.userClubId && m.kind === 'RELEGATED')) state.freeReleasesLeft = CONTRACT.freeReleasesOnRelegation;
    else delete state.freeReleasesLeft;
  } else if (outcome) state.seasonHistory.push(outcome);

  // ⑤ 컨디션·사기·부상·시즌 스탯·경고 누적 초기화 (퇴장·누적 정지 경기는 이어진다, 수명주기 10.1 D4. 계약 −1·만료는 ②' contractBoundary, M4.4)
  for (const p of Object.values(state.players)) {
    state.players[p.id] = { ...p, condition: 100, morale: 0, availability: { ...p.availability, injuryDays: 0, yellowAccum: 0 }, season: { ...SEASON_RESET } };
  }
  // ⑥ 리포트 보관 (D28): 상세 기록은 끝난 시즌 것만 남기고(= 새 시즌에서 직전 시즌), 그 전은 버린다. 요약은 판정표(seasonHistory)로 충분
  state.records = Object.fromEntries(Object.entries(state.records).filter(([id]) => parseMatchId(id)?.season === ending));
  state.summaries = {};
  state.plans = {};
  state.proposals = Object.fromEntries(Object.entries(state.proposals).filter(([, p]) => p.status === 'OPEN'));
  state.seq += 1;

  // ⑦ 일정·재정
  state.fixtures = seasonFixtures(state, season);
  for (const cid of Object.keys(state.clubs).sort()) state.finances[cid] = { ...(state.finances[cid] ?? emptyFinance(cid)), ledger: [] };
  state.time = { season, day: 1 };
  state.phase = 'MATCHDAY';
  rollTrainingFocus(state); // 8.3: 주 시작 Day 1
  delete state.youthIntake;
  // 긴급 FA 는 만료·은퇴가 끝난 뒤 새 시즌 Day 1 인원으로 판정한다(편지도 새 시즌 날짜, M4.8)
  if (fresh) fillHumanSquads(state);
  // K4: 강등 연봉 전용 계정은 Day 1 연봉부터 쓰이므로 배정금 처리 전에 연다
  for (const m of movements.filter((x) => x.kind === 'RELEGATED')) {
    const amount = parachuteOf(m.from, m.to);
    const f = state.finances[m.clubId];
    if (!f || amount <= 0) continue;
    state.finances[m.clubId] = { ...f, parachute: amount };
    post(state, m.clubId, { kind: 'PARACHUTE', amount: 0, memo: `연봉 전용 계정 개설 ${(amount / 1_000_000).toFixed(2)}M (캡 초과 연봉만, Day 28 소멸)` });
  }
  dayOneProcessing(state);
  for (const m of movements.filter((x) => x.kind === 'PROMOTED')) {
    post(state, m.clubId, { kind: 'PROMOTION_BONUS', amount: promotionBonus(m.to), memo: `승격 보너스 (${m.from} → ${m.to})` });
  }
  // U4: AI 방출 위약금, 경계 사건 → 편지(사람 구단만, 새 시즌 Day 1)
  if (boundary) {
    for (const x of boundary.penalties) post(state, x.clubId, { kind: 'RELEASE_PENALTY', amount: x.amount, memo: x.memo });
    mailContract(state, boundary.contractEvents);
    // 사람 구단 유스 후보 (7.1, M5.1): Day 1 생성 → Day 7 까지 decideYouth, Day 8 자동 처리. 긴급 FA 뒤라 결정 시 인원은 그 뒤 기준
    offerYouthIntake(state);
  }
  return state;
}

/**
 * 스키마 2 → 3: 단일 리그 세이브(leagues 없음)를 T3 에 배치하고 T1·T2·T4·T5 를 같은 시드의 새 게임과 똑같이 만든다(c15~c70).
 * 이번 시즌 이미 지난 날짜의 다른 리그 경기는 경량 시뮬로 채운다(순위·승강 판정용). 새 구단 재정은 새 게임 Day 1 값.
 * ponytail: 새 구단의 지난 경기 수당·이전 시즌 기록은 만들지 않는다(변환 1회성, 잔액 차이 < 배정금 10%)
 */
export function toPyramid(old: GameState): GameState {
  if (old.leagues) return old;
  const T = LEGACY_LEAGUE_TIER;
  const seed = old.gameSeed;
  const template = createInitialState(seed, { clubName: 'x', tier: T, devMode: false }, old.createdAt);
  const userIds = Object.keys(old.clubs).sort();
  const leagues = template.leagues!.map((l) => (l.tier === T ? { ...l, clubIds: userIds } : l));
  const newIds = leagues.filter((l) => l.tier !== T).flatMap((l) => l.clubIds);
  if (newIds.some((id) => old.clubs[id])) throw new Error('구단 ID 충돌');
  const state: GameState = {
    ...structuredClone(old),
    leagues,
    settings: { ...old.settings, tier: T, startTier: old.settings.startTier ?? T },
  };
  for (const id of newIds) {
    const c = template.clubs[id]!;
    state.clubs[id] = c;
    for (const pid of c.playerIds) state.players[pid] = template.players[pid]!;
    state.finances[id] = template.finances[id]!;
  }
  const uid = leagueIdOf(T);
  const userFixtures: Fixture[] = old.fixtures.map((f) => {
    const s = old.summaries[f.id];
    return { ...f, leagueId: uid, ...(f.played && s ? { score: { home: s.home.goals, away: s.away.goals } } : {}) };
  });
  const playedDays = Math.max(0, ...userFixtures.filter((f) => f.played && f.season === old.time.season).map((f) => f.day));
  const others = seasonFixtures(state, old.time.season)
    .filter((f) => f.leagueId !== uid)
    .map((f) =>
      f.day > playedDays
        ? f
        : {
            ...f,
            played: true,
            score: quickSimScore(mulberry32(hashString(`${seed}|quick|${f.id}`)), teamStrength(clubPlayers(state, f.homeId)), teamStrength(clubPlayers(state, f.awayId))),
          },
    );
  state.fixtures = [...userFixtures, ...others];
  return { ...state, schemaVersion: 3 };
}
