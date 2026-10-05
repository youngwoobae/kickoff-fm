/** 계약 2.1.0 (M3.1): 피라미드·커리어 골격 + deleteSlot 통지 순서 (공개 API 만 사용) */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, createGameService, createMemorySlotStorage, isGameError, type GameService, type StoragePort } from '../../src/services';
import type { SaveSlotId } from '../../src/types';

const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };
type Svc = Required<Pick<GameService, 'getPyramid' | 'getCareer' | 'deleteSlot' | 'listSlots' | 'flush' | 'getActiveSlot'>> & GameService;
const svc = (slots: StoragePort = createMemorySlotStorage()) => createGameService({ slots, clock }) as Svc;

function errCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return isGameError(e) ? e.code : 'non-game';
  }
  return 'no-error';
}

describe('피라미드·커리어 (2.1.0)', () => {
  it('계약 버전', () => {
    expect(CONTRACT_VERSION).toBe('2.5.0');
  });

  it('피라미드: 5리그 × 14구단(70, 겹침 없음), 기본 시작 T5, 같은 상태면 같은 참조 (M3.2)', () => {
    const s = svc();
    s.newGame({ seed: 1 });
    const p = s.getPyramid();
    expect(p.leagues.map((l) => l.tier)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(p.userLeagueId).toBe('L-T5');
    expect(p.leagues.filter((l) => l.isUserLeague).map((l) => l.id)).toEqual(['L-T5']);
    expect(p.leagues[2]).toMatchObject({ id: 'L-T3', tier: 'T3', name: '디비전 2', promoteCount: 2, relegateCount: 3, isUserLeague: false });
    const all = p.leagues.flatMap((l) => l.clubIds);
    expect(new Set(all).size).toBe(70);
    for (const l of p.leagues) expect(l.clubIds).toHaveLength(14);
    expect(all.sort()).toEqual(Object.keys(s.getSnapshot()!.clubs).sort());
    expect(p.leagues[4]!.clubIds).toContain(s.getSnapshot()!.userClubId);
    expect(s.getSnapshot()!.settings).toMatchObject({ tier: 'T5', startTier: 'T5' });
    expect(s.getPyramid()).toBe(p);
  });

  it('startTier 가 사용자 리그 티어가 되고 tier 보다 우선한다. 승강 인원은 메인 결정 U-1', () => {
    const s = svc();
    const counts: Record<string, [number, number]> = { T1: [0, 2], T2: [2, 2], T3: [2, 3], T4: [3, 3], T5: [3, 0] };
    for (const t of ['T1', 'T2', 'T3', 'T4', 'T5'] as const) {
      s.newGame({ seed: 2, startTier: t, tier: 'T1' });
      expect(s.getSnapshot()!.settings).toMatchObject({ tier: t, startTier: t });
      const p = s.getPyramid();
      expect(p.userLeagueId).toBe(`L-${t}`);
      for (const l of p.leagues) expect([l.promoteCount, l.relegateCount]).toEqual(counts[l.tier]);
    }
  });

  it('getStandings(leagueId) / getFixtures({leagueId}): 전 리그, 없는 리그는 NOT_FOUND / []', () => {
    const s = svc();
    s.newGame({ seed: 3 });
    expect(s.getStandings('L-T5')).toBe(s.getStandings());
    const t1 = s.getStandings('L-T1');
    expect(t1).toHaveLength(14);
    expect(t1.map((r) => r.clubId).sort()).toEqual(s.getPyramid().leagues[0]!.clubIds);
    expect(errCode(() => s.getStandings('L-T9'))).toBe('NOT_FOUND');
    expect(s.getFixtures({ leagueId: 'L-T5' })).toEqual(s.getFixtures());
    const f1 = s.getFixtures({ leagueId: 'L-T1' });
    expect(f1).toHaveLength(182);
    expect(f1.every((f) => f.leagueId === 'L-T1')).toBe(true);
    expect(s.getFixtures({ leagueId: 'L-T9' })).toEqual([]);
  });

  it('커리어: 판정 전 빈 기록, 시즌 판정 후 순위·라벨·트로피', () => {
    const s = svc();
    s.newGame({ seed: 4, startTier: 'T4' });
    expect(s.getCareer()).toMatchObject({ startTier: 'T4', currentTier: 'T4', seasons: [], trophies: [], highestTier: 'T4' });
    s.advanceToSeasonEnd();
    const out = s.getSeasonOutcome()!;
    const row = out.finalTable.find((r) => r.clubId === s.getSnapshot()!.userClubId)!;
    const c = s.getCareer();
    expect(c.seasons).toHaveLength(1);
    expect(c.seasons[0]).toMatchObject({ season: 1, tier: 'T4', leagueId: 'L-T4', position: row.position, points: row.points, label: out.labels[row.clubId] });
    expect(c.trophies).toHaveLength(row.position === 1 ? 1 : 0);
    s.startNewSeason();
    expect(s.getCareer().seasons).toHaveLength(1); // 진행 중 시즌은 빠진다
  });
});

describe('deleteSlot 통지 순서 (2.1.0 버그 수정)', () => {
  /** remove 를 손으로 끝내는 저장소 */
  function gatedStore() {
    const inner = createMemorySlotStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store: StoragePort = { ...inner, remove: async (id: SaveSlotId) => (await gate, inner.remove(id)) };
    return { store, release };
  }

  it('열린 슬롯 삭제: 리스너는 remove 완료 뒤에 불리고 그때 읽은 목록에 슬롯이 없다', async () => {
    const { store, release } = gatedStore();
    const s = svc(store);
    s.newGame({ seed: 5, slotId: 1 });
    await s.flush();
    const seen: Promise<number[]>[] = [];
    s.subscribe(() => seen.push(s.listSlots().then((m) => m.map((x) => x.slotId))));
    const done = s.deleteSlot(1);
    await Promise.resolve();
    expect(seen).toHaveLength(0); // remove 전에는 통지하지 않는다
    expect(s.getSnapshot()).not.toBeNull();
    release();
    await done;
    expect(s.getSnapshot()).toBeNull();
    expect(s.getActiveSlot()).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(await p).toEqual([]);
  });

  it('삭제 대기 중 변경이 슬롯을 되살리지 않는다', async () => {
    const { store, release } = gatedStore();
    const s = svc(store);
    s.newGame({ seed: 6, slotId: 2 });
    await s.flush();
    const done = s.deleteSlot(2);
    s.advanceDay();
    release();
    await done;
    await s.flush();
    expect(await s.listSlots()).toEqual([]);
  });
});
