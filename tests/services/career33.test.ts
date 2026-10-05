/** M3.3: 시즌 경계(승강·수명주기·K4 정산·D28 보관·U6 멱등)와 스키마 2 → 3 변환 */
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers';
import { createGameService, createMemorySlotStorage, type GameService } from '../../src/services';
import { PROMOTION_BONUS_RATE, TIER_ECONOMY, advanceDayState, createInitialState, parachuteOf, startNewSeasonState } from '../../src/domain';
import type { GameState, Tier } from '../../src/types';

type Svc = Required<Pick<GameService, 'getPyramid' | 'getCareer' | 'openSlot' | 'flush'>> & GameService;
const svc = (slots = createMemorySlotStorage()) => createGameService({ slots, clock }) as Svc;
const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

function toSeasonOver(s: GameState): GameState {
  while (s.phase !== 'SEASON_OVER') s = advanceDayState(s, 'now').state;
  return s;
}

describe('시즌 경계 (M3.3)', () => {
  it('새 게임 → 3시즌: 승강 반영, 사용자 티어 변경, 70구단·각 14팀 불변, 선수 수 안정, 기록·보관 규칙', () => {
    const s = svc();
    s.newGame({ seed: 1 }); // T5 시작, 이 시드는 1시즌에 승격 (M3.6 생성기 조정 뒤)
    const tiers: Tier[] = [s.getSnapshot()!.settings.tier];
    for (let season = 1; season <= 3; season++) {
      s.advanceToSeasonEnd();
      const outcome = s.getSeasonOutcome()!;
      const before = s.getSnapshot()!;
      expect(outcome.leagueId).toBe(s.getPyramid().userLeagueId);
      expect(outcome.movements).toHaveLength(20);
      // 판정 라벨 = 실제 이동 (사용자 구단)
      const um = outcome.movements!.find((m) => m.clubId === before.userClubId);
      expect(outcome.labels[before.userClubId]).toBe(um?.kind ?? 'STAYED');
      // 순위표 구역 = 리그별 승강 인원
      for (const l of s.getPyramid().leagues) {
        const rows = s.getStandings(l.id);
        expect(rows.filter((r) => r.zone === 'PROMOTION')).toHaveLength(l.promoteCount);
        expect(rows.filter((r) => r.zone === 'RELEGATION')).toHaveLength(l.relegateCount);
      }
      s.startNewSeason();
      const snap = s.getSnapshot()!;
      tiers.push(snap.settings.tier);
      expect(snap.settings.tier).toBe(um?.to ?? tiers[tiers.length - 2]);
      // 구조 불변
      expect(Object.keys(snap.clubs)).toHaveLength(70);
      const leagues = s.getPyramid().leagues;
      expect(leagues.map((l) => l.tier)).toEqual(TIERS);
      expect(leagues.map((l) => l.clubIds.length)).toEqual([14, 14, 14, 14, 14]);
      expect(new Set(leagues.flatMap((l) => l.clubIds)).size).toBe(70);
      for (const m of outcome.movements!) expect(leagues.find((l) => l.tier === m.to)!.clubIds).toContain(m.clubId);
      // 선수 수: AI 22~25, 사람 ≥ 18, 전체(FA 포함) 범위
      for (const c of Object.values(snap.clubs)) {
        if (c.isHuman) expect(c.playerIds.length).toBeGreaterThanOrEqual(18);
        else expect(c.playerIds.length).toBeGreaterThanOrEqual(22), expect(c.playerIds.length).toBeLessThanOrEqual(25);
      }
      const n = Object.keys(snap.players).length;
      expect(n).toBeGreaterThan(1500);
      expect(n).toBeLessThan(1800);
      for (const p of Object.values(snap.players)) {
        expect(p.retiring).toBeFalsy();
        expect(p.contract.salary).toBeGreaterThan(0);
        expect(p.season.apps).toBe(0);
      }
      // 선수 기록: 끝난 시즌 한 줄
      const veteran = snap.clubs[snap.userClubId]!.playerIds.map((id) => snap.players[id]!).find((p) => p.id.startsWith('c01p'))!;
      expect(veteran.history!.map((h) => h.season)).toEqual(Array.from({ length: season }, (_, i) => i + 1));
      // D28: 상세 리포트는 직전 시즌 것만
      expect(Object.keys(snap.records)).toHaveLength(26);
      expect(Object.keys(snap.records).every((id) => id.startsWith(`s${season}-`))).toBe(true);
      expect(snap.boundarySeason).toBe(season);
      // K4: 승격 보너스 (사용자 원장)
      const bonus = snap.finances[snap.userClubId]!.ledger.filter((e) => e.kind === 'PROMOTION_BONUS');
      expect(bonus.map((e) => e.amount)).toEqual(um?.kind === 'PROMOTED' ? [Math.round(TIER_ECONOMY[um.to].seasonBudget * PROMOTION_BONUS_RATE)] : []);
    }
    expect(tiers[1]).not.toBe(tiers[0]); // 사용자 티어가 실제로 바뀐다
    const career = s.getCareer();
    expect(career.seasons.map((x) => x.tier)).toEqual(tiers.slice(0, 3));
    expect(career.currentTier).toBe(tiers[3]);
  });

  it('K4: 강등 구단은 연봉 전용 계정을 받고 캡 초과 연봉에만 쓰며 Day 28 에 소멸, 승격 구단은 보너스', () => {
    const over = toSeasonOver(createInitialState(41, { clubName: 'K', tier: 'T3', devMode: false }, 'now'));
    const next = startNewSeasonState(over, 'now');
    const mv = next.seasonHistory[0]!.movements!;
    for (const m of mv.filter((x) => x.kind === 'RELEGATED')) {
      const f = next.finances[m.clubId]!;
      expect(f.parachute).toBeDefined();
      expect(f.parachute!).toBeLessThanOrEqual(parachuteOf(m.from, m.to));
      expect(f.parachute!).toBeGreaterThanOrEqual(0);
    }
    let checked = 0;
    for (const m of mv.filter((x) => x.kind === 'PROMOTED')) {
      // 승격 구단 잔액 = 이전 잔액 + 새 배정금 + 보너스 − 1일차 연봉 − AI 방출 위약금(M4.4 U4). 위약금을 원장으로 확인할 수 있는 사용자 리그 구단만
      const ledger = next.finances[m.clubId]!.ledger;
      if (!ledger.length) continue;
      const prev = over.finances[m.clubId]!.balance;
      const salary = next.clubs[m.clubId]!.playerIds.reduce((a, id) => a + next.players[id]!.contract.salary, 0);
      const day1 = Math.round(salary / 28);
      const penalties = ledger.filter((e) => e.kind === 'RELEASE_PENALTY').reduce((a, e) => a + e.amount, 0);
      expect(next.finances[m.clubId]!.balance).toBe(prev + TIER_ECONOMY[m.to].seasonBudget + Math.round(TIER_ECONOMY[m.to].seasonBudget * PROMOTION_BONUS_RATE) - day1 + penalties);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const end = toSeasonOver(next);
    for (const m of mv.filter((x) => x.kind === 'RELEGATED')) expect(end.finances[m.clubId]!.parachute).toBeUndefined();
  });

  it('10시즌 자동 진행: 매 시즌 70구단·리그 14팀·선수 수 범위 유지, 10시즌 세이브 < 4MB (아키텍처 16장 2.1.1 목표치)', () => {
    let s = createInitialState(9, { clubName: 'X', tier: 'T5', devMode: false }, 'now');
    for (let season = 1; season <= 10; season++) {
      s = startNewSeasonState(toSeasonOver(s), 'now');
      expect(Object.keys(s.clubs)).toHaveLength(70);
      expect(s.leagues!.map((l) => l.clubIds.length)).toEqual([14, 14, 14, 14, 14]);
      const n = Object.keys(s.players).length;
      expect(n).toBeGreaterThan(1500);
      expect(n).toBeLessThan(1800);
      for (const c of Object.values(s.clubs)) if (!c.isHuman) expect(c.playerIds.length).toBeGreaterThanOrEqual(22);
    }
    expect(JSON.stringify(toSeasonOver(s)).length).toBeLessThan(4 * 1024 * 1024);
  }, 60_000);

  it('사람 구단 은퇴 선수가 기본 플랜 선발에 있어도 다음 시즌 경기가 진행된다 (플랜 보정)', () => {
    const s = svc();
    s.newGame({ seed: 61 });
    const plan = s.recommendPlan();
    s.setDefaultPlan(plan);
    s.advanceToSeasonEnd();
    const x = JSON.parse(s.exportSave()) as GameState;
    const gone = plan.lineup.starters[3]!;
    x.players[gone] = { ...x.players[gone]!, retiring: true };
    const t = svc();
    t.importSave(JSON.stringify(x));
    t.startNewSeason();
    expect(t.getSnapshot()!.players[gone]).toBeUndefined();
    expect(t.getSnapshot()!.clubs[x.userClubId]!.playerIds).not.toContain(gone);
    const r = t.advanceDay();
    expect(r.userResolvedPlan!.plan.lineup.starters).not.toContain(gone);
    expect(r.userResolvedPlan!.plan.lineup.starters).toHaveLength(11);
  });

  it('U6 멱등: 이미 넘은 경계는 승강·노화·수명주기를 다시 하지 않는다', () => {
    const over = toSeasonOver(createInitialState(42, { clubName: 'U', tier: 'T3', devMode: false }, 'now'));
    const marked = { ...over, boundarySeason: over.time.season };
    const next = startNewSeasonState(marked, 'now');
    expect(next.leagues).toEqual(over.leagues);
    const pid = over.clubs[over.userClubId]!.playerIds[0]!;
    expect(next.players[pid]!.age).toBe(over.players[pid]!.age);
    expect(next.players[pid]!.history).toBeUndefined();
    expect(next.time).toEqual({ season: 2, day: 1 });
  });
});

describe('스키마 2 → 3 변환 (M3.3)', () => {
  /** 현재 세이브를 스키마 2 단일 리그(c01~c14만, leagues·score·leagueId 없음)로 되돌린다 */
  function legacyOf(x: GameState): GameState {
    const y = structuredClone(x);
    const user = y.leagues!.find((l) => l.clubIds.includes(y.userClubId))!;
    for (const id of Object.keys(y.clubs)) {
      if (user.clubIds.includes(id)) continue;
      for (const pid of y.clubs[id]!.playerIds) delete y.players[pid];
      delete y.clubs[id];
      delete y.finances[id];
    }
    y.fixtures = y.fixtures.filter((f) => f.leagueId === user.id).map(({ leagueId: _l, score: _s, ...f }) => f);
    delete y.leagues;
    y.schemaVersion = 2;
    return y;
  }

  it('시즌 중간 세이브: T3 배치, 4티어 생성, 지난 날짜의 다른 리그 경기는 채워짐 — 가져오기·열기 두 경로', async () => {
    const a = svc();
    a.newGame({ seed: 51, startTier: 'T4' });
    a.advanceDays(9);
    const legacy = legacyOf(a.getSnapshot()! as GameState);
    expect(legacy.settings.tier).toBe('T4');

    const check = (snap: GameState) => {
      expect(snap.schemaVersion).toBe(3);
      expect(snap.settings.tier).toBe('T3');
      expect(snap.leagues!.map((l) => [l.tier, l.clubIds.length])).toEqual(TIERS.map((t) => [t, 14]));
      expect(snap.leagues!.find((l) => l.tier === 'T3')!.clubIds).toContain(snap.userClubId);
      expect(Object.keys(snap.clubs)).toHaveLength(70);
      for (const f of snap.fixtures) expect(f.played).toBe(f.day <= 9);
      for (const f of snap.fixtures.filter((x) => x.played)) expect(f.score).toBeDefined();
    };
    const b = svc();
    check(b.importSave(JSON.stringify(legacy)) as GameState);
    b.advanceToSeasonEnd();
    expect(b.getSeasonOutcome()!.movements).toHaveLength(20);
    b.startNewSeason();
    expect(b.getPyramid().leagues.map((l) => l.clubIds.length)).toEqual([14, 14, 14, 14, 14]);

    // 슬롯 열기 경로: 저장소에 스키마 2 본문이 있어도 열린다
    const store = createMemorySlotStorage();
    await store.write(1, JSON.stringify(legacy), { slotId: 1, clubName: 'x', tier: 'T4', season: 1, day: 10, phase: 'MATCHDAY', savedAt: clock.nowIso(), schemaVersion: 2 });
    check((await svc(store).openSlot(1)) as GameState);
  });

  it('M3.2 세이브(스키마 2 + leagues, 판정에 movements 없음)는 버전만 올리고 경계에서 이동을 계산한다', () => {
    const over = toSeasonOver(createInitialState(52, { clubName: 'M', tier: 'T5', devMode: false }, 'now'));
    const { movements: _m, ...outcome } = over.pendingOutcome!;
    const old = { ...over, schemaVersion: 2, pendingOutcome: outcome };
    const s = svc();
    s.importSave(JSON.stringify(old));
    expect(s.getSnapshot()!.schemaVersion).toBe(3);
    s.startNewSeason();
    expect(s.getSeasonOutcome(1)!.movements).toEqual(over.pendingOutcome!.movements);
  });

  it('리그가 없는 스키마 3 세이브는 거부', () => {
    const s = svc();
    s.newGame({ seed: 53 });
    const x = JSON.parse(s.exportSave()) as GameState;
    delete x.leagues;
    expect(() => svc().importSave(JSON.stringify(x))).toThrow(/리그 형식 오류/);
  });
});
