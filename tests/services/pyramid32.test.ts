/** M3.2: 70구단 피라미드 상태·경량 시뮬·하루 진행 연결 (공개 API 만 사용) */
import { describe, expect, it } from 'vitest';
import { createGameService, createMemorySlotStorage, type GameService } from '../../src/services';
import type { GameState } from '../../src/types';

const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };
type Svc = Required<Pick<GameService, 'getPyramid' | 'getCareer'>> & GameService;
const svc = () => createGameService({ slots: createMemorySlotStorage(), clock }) as Svc;

describe('피라미드 하루 진행 (M3.2)', () => {
  it('하루에 사용자 리그 7경기(엔진) + 다른 4리그 28경기(경량 시뮬), 다른 리그는 스코어·순위만', () => {
    const s = svc();
    s.newGame({ seed: 31 });
    const r = s.advanceDay();
    expect(r.matches).toHaveLength(7);
    const snap = s.getSnapshot()!;
    expect(Object.keys(snap.summaries)).toHaveLength(7);
    for (const l of s.getPyramid().leagues) {
      const played = s.getFixtures({ leagueId: l.id, played: true });
      expect(played).toHaveLength(7);
      for (const f of played) expect(f.score).toBeDefined();
      const table = s.getStandings(l.id);
      expect(table.reduce((a, x) => a + x.played, 0)).toBe(14);
      expect(table.reduce((a, x) => a + x.goalsFor, 0)).toBe(played.reduce((a, f) => a + f.score!.home + f.score!.away, 0));
    }
    // 경량 시뮬 리그 선수는 경기 상태가 바뀌지 않는다
    const other = s.getPyramid().leagues.find((l) => !l.isUserLeague)!;
    for (const id of snap.clubs[other.clubIds[0]!]!.playerIds) expect(snap.players[id]!.season.apps).toBe(0);
  });

  it('같은 시드 = 같은 결과 (전 리그), 시즌 끝까지 → 새 시즌에도 70구단 유지', () => {
    const a = svc();
    const b = svc();
    a.newGame({ seed: 32 });
    b.newGame({ seed: 32 });
    a.advanceDays(5);
    b.advanceDays(5);
    expect(a.getFixtures({ leagueId: 'L-T2' })).toEqual(b.getFixtures({ leagueId: 'L-T2' }));
    a.advanceToSeasonEnd();
    for (const l of a.getPyramid().leagues) for (const row of a.getStandings(l.id)) expect(row.played).toBe(26);
    const before = a.getSnapshot()!;
    const other = a.getPyramid().leagues[0]!.clubIds[0]!;
    // 다른 리그 구단은 원장 없이 잔액만
    expect(before.finances[other]!.ledger).toEqual([]);
    a.startNewSeason();
    const snap = a.getSnapshot()!;
    expect(Object.keys(snap.clubs)).toHaveLength(70);
    expect(snap.clubs[other]).toBeDefined(); // 재생성 없음 (D6) — 선수단은 수명주기(M3.3)로 일부 바뀐다
    expect(snap.fixtures).toHaveLength(5 * 182);
    // 승강 (M3.3): 판정의 movements 대로 리그 구성이 바뀐다
    const mv = a.getSeasonOutcome(1)!.movements!;
    expect(mv).toHaveLength(20);
    for (const m of mv) expect(a.getPyramid().leagues.find((l) => l.tier === m.to)!.clubIds).toContain(m.clubId);
  });

  it('재정 요약은 구단 티어 기준 (다른 리그 구단 포함)', () => {
    const s = svc();
    s.newGame({ seed: 33 });
    const t1club = s.getPyramid().leagues[0]!.clubIds[0]!;
    expect(s.getFinance(t1club)).toMatchObject({ tier: 'T1', salaryCap: 150_000_000 });
    expect(s.getFinance()).toMatchObject({ tier: 'T5', salaryCap: 26_000_000 });
  });

  it('스키마 2 단일 리그 세이브(leagues 없음)는 T3 에 배치되고 나머지 티어가 생긴다 (M3.3 변환)', () => {
    const s = svc();
    s.newGame({ seed: 34, startTier: 'T3' });
    const x = JSON.parse(s.exportSave()) as GameState;
    const user = x.leagues!.find((l) => l.clubIds.includes(x.userClubId))!;
    for (const id of Object.keys(x.clubs)) {
      if (user.clubIds.includes(id)) continue;
      for (const pid of x.clubs[id]!.playerIds) delete x.players[pid];
      delete x.clubs[id];
      delete x.finances[id];
    }
    x.fixtures = x.fixtures.filter((f) => f.leagueId === user.id).map(({ leagueId: _l, score: _s, ...f }) => f);
    delete x.leagues;
    x.schemaVersion = 2;
    const t = svc();
    t.importSave(JSON.stringify(x));
    expect(t.getSnapshot()!.schemaVersion).toBe(3);
    expect(t.getPyramid().leagues.map((l) => l.clubIds.length)).toEqual([14, 14, 14, 14, 14]);
    expect(t.getPyramid().userLeagueId).toBe('L-T3');
    expect(t.getFixtures({ leagueId: 'L-T3' })).toHaveLength(182);
    t.advanceToSeasonEnd();
    expect(t.getStandings('L-T3')).toHaveLength(14);
    t.startNewSeason();
    expect(Object.keys(t.getSnapshot()!.clubs)).toHaveLength(70);
  });

  it('가져오기: 리그 구단이 겹치거나 없는 구단이면 거부', () => {
    const s = svc();
    s.newGame({ seed: 35 });
    const x = JSON.parse(s.exportSave()) as GameState;
    const dup = structuredClone(x);
    dup.leagues![0]!.clubIds[0] = dup.leagues![1]!.clubIds[0]!;
    expect(() => svc().importSave(JSON.stringify(dup))).toThrow(/구단 오류/);
    const ghost = structuredClone(x);
    ghost.leagues![0]!.clubIds.push('c99');
    expect(() => svc().importSave(JSON.stringify(ghost))).toThrow(/구단 오류/);
  });
});
