/** 계약 2.0.0: 세이브 슬롯·비동기 시작·write-behind (공개 API 만 사용) */
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  SAVE_SLOT_IDS,
  createGameService,
  createLocalStorageSlotStorage,
  createMemorySlotStorage,
  createMemoryStorage,
  isGameError,
  createIndexedDbSlotStorage,
  migrateLocalSaves,
  kvSlotStorage,
  SAVE_KEY,
  type GameService,
  type KeyValue,
  type StoragePort,
} from '../../src/services';

const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };

type SlotService = Required<Pick<GameService, 'listSlots' | 'openSlot' | 'deleteSlot' | 'closeSlot' | 'flush' | 'exportSlot' | 'getActiveSlot' | 'getSaveStatus'>> & GameService;

function svc(slots: StoragePort = createMemorySlotStorage()): SlotService {
  return createGameService({ slots, clock }) as SlotService;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return isGameError(e) ? e.code : `non-game:${String(e)}`;
  }
  return 'no-error';
}

describe('세이브 슬롯 (2.0.0)', () => {
  it('계약 버전·슬롯 3개', () => {
    expect(CONTRACT_VERSION).toBe('2.3.0');
    expect(SAVE_SLOT_IDS).toEqual([1, 2, 3]);
  });

  it('newGame({slotId}) → flush → 메타 목록 → 새 서비스에서 openSlot 복원', async () => {
    const store = createMemorySlotStorage();
    const a = svc(store);
    expect(await a.listSlots()).toEqual([]);
    a.newGame({ seed: 7, clubName: '슬롯 FC', slotId: 2, startTier: 'T3' });
    expect(a.getActiveSlot()).toBe(2);
    a.advanceDay();
    await a.flush();
    expect(a.getSaveStatus()).toMatchObject({ slotId: 2, pending: false, error: null, lastSavedAt: clock.nowIso() });
    const metas = await a.listSlots();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ slotId: 2, clubName: '슬롯 FC', tier: 'T3', season: 1, day: 2, phase: 'MATCHDAY', savedAt: clock.nowIso() });

    const b = svc(store);
    expect(b.getSnapshot()).toBeNull();
    let calls = 0;
    b.subscribe(() => (calls += 1));
    const snap = await b.openSlot(2);
    expect(calls).toBe(1);
    expect(snap.gameSeed).toBe(7);
    expect(snap.time.day).toBe(2);
    expect(b.getSnapshot()).toBe(snap);
    expect(b.getStandings()).toHaveLength(14);
  });

  it('슬롯 3개 독립 왕복, 빈 슬롯 NOT_FOUND, 없는 슬롯 번호 NOT_FOUND', async () => {
    const store = createMemorySlotStorage();
    const a = svc(store);
    for (const id of SAVE_SLOT_IDS) a.newGame({ seed: id * 10, clubName: `구단${id}`, slotId: id });
    await a.flush();
    expect((await a.listSlots()).map((m) => [m.slotId, m.clubName])).toEqual([[1, '구단1'], [2, '구단2'], [3, '구단3']]);
    const b = svc(store);
    for (const id of SAVE_SLOT_IDS) expect((await b.openSlot(id)).gameSeed).toBe(id * 10);
    await b.deleteSlot(3);
    expect(b.getSnapshot()).toBeNull(); // 열린 슬롯 삭제 = 게임 닫힘
    expect(b.getActiveSlot()).toBeNull();
    expect(await code(b.openSlot(3))).toBe('NOT_FOUND');
    expect(await code(b.openSlot(4 as never))).toBe('NOT_FOUND');
    expect((await b.listSlots()).map((m) => m.slotId)).toEqual([1, 2]);
  });

  it('write-behind: 여러 변경이 한 번에 합쳐지고, 슬롯 전환 시 이전 슬롯 쓰기를 잃지 않는다', async () => {
    let writes = 0;
    const inner = createMemorySlotStorage();
    const counting: StoragePort = { ...inner, write: (id, d, m) => ((writes += 1), inner.write(id, d, m)) };
    const a = svc(counting);
    a.newGame({ seed: 3, slotId: 1 });
    a.advanceDays(5);
    await a.flush();
    expect(writes).toBeLessThanOrEqual(2); // 첫 쓰기 + 합쳐진 마지막 상태
    expect(JSON.parse(await a.exportSlot(1)).time.day).toBe(6);

    a.advanceDay(); // 슬롯 1 쓰기 대기
    a.newGame({ seed: 4, slotId: 2 }); // 곧바로 슬롯 2
    await a.flush();
    const b = svc(inner);
    expect((await b.openSlot(1)).time.day).toBe(7);
    expect((await b.openSlot(2)).gameSeed).toBe(4);
  });

  it('쓰기 실패: 상태는 유지, SaveStatus.error + 리스너 통지, flush 는 STORAGE_FULL, 복구 후 flush 재시도 성공', async () => {
    const inner = createMemorySlotStorage();
    let fail = true;
    const flaky: StoragePort = { ...inner, write: (id, d, m) => (fail ? Promise.reject(new Error('quota')) : inner.write(id, d, m)) };
    const a = svc(flaky);
    let calls = 0;
    a.subscribe(() => (calls += 1));
    a.newGame({ seed: 5, slotId: 1 });
    expect(await code(a.flush())).toBe('STORAGE_FULL');
    expect(a.getSnapshot()).not.toBeNull();
    expect(a.getSaveStatus()).toMatchObject({ pending: true, error: 'quota' });
    expect(calls).toBeGreaterThanOrEqual(2); // newGame + 오류 통지
    expect(await code(a.closeSlot())).toBe('STORAGE_FULL'); // 실패하면 닫지 않는다
    expect(a.getSnapshot()).not.toBeNull();
    fail = false;
    await a.flush();
    expect(a.getSaveStatus()).toMatchObject({ pending: false, error: null });
    expect((await inner.listSlots()).map((m) => m.slotId)).toEqual([1]);
    await a.closeSlot();
    expect(a.getSnapshot()).toBeNull();
  });

  it('logEvent 는 슬롯 모드에서도 알림 없이 저장된다', async () => {
    const store = createMemorySlotStorage();
    const a = svc(store);
    a.newGame({ seed: 1, slotId: 1 });
    await a.flush();
    let calls = 0;
    a.subscribe(() => (calls += 1));
    a.logEvent('SESSION_START');
    await a.flush();
    expect(calls).toBe(0);
    const log = JSON.parse((await store.readLog!(1))!);
    expect(log.some((e: { kind: string }) => e.kind === 'SESSION_START')).toBe(true);
  });

  it('손상 슬롯 = SAVE_INCOMPATIBLE, 슬롯은 남는다. importSave(json, slotId) 로 다른 슬롯에 넣기', async () => {
    const store = createMemorySlotStorage();
    const a = svc(store);
    const snap = a.newGame({ seed: 9, slotId: 1 });
    await a.flush();
    await store.write(2, '{"broken":', { ...(await store.listSlots())[0]!, slotId: 2 });
    expect(await code(a.openSlot(2))).toBe('SAVE_INCOMPATIBLE');
    expect(a.getActiveSlot()).toBe(1); // 실패 시 현재 게임 유지
    expect((await a.listSlots()).map((m) => m.slotId)).toEqual([1, 2]);
    a.importSave(JSON.stringify(snap), 3);
    expect(a.getActiveSlot()).toBe(3);
    await a.flush();
    expect((await svc(store).openSlot(3)).gameSeed).toBe(9);
  });

  it('레거시 경로 유지: 슬롯 없이 newGame → 동기 저장소 → loadGame', () => {
    const storage = createMemoryStorage();
    const a = createGameService({ storage, clock });
    a.newGame({ seed: 11 });
    expect(storage.load()).not.toBeNull();
    expect(createGameService({ storage, clock }).loadGame()?.gameSeed).toBe(11);
  });

  it('localStorage 슬롯 어댑터 왕복 (키 kickoff-fm/slot/{n})', async () => {
    const m = new Map<string, string>();
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const g = globalThis as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = fake;
    try {
      const store = createLocalStorageSlotStorage();
      const a = svc(store);
      a.newGame({ seed: 21, slotId: 1 });
      await a.flush();
      expect([...m.keys()].sort()).toEqual(['kickoff-fm/slot/1', 'kickoff-fm/slot/1/log', 'kickoff-fm/slot/1/meta']);
      expect((await svc(store).openSlot(1)).gameSeed).toBe(21);
      await store.remove(1);
      expect(m.size).toBe(0);
    } finally {
      g.localStorage = prev;
    }
  });
});

/** M2.2: 행동 로그 분리, localStorage → 슬롯 이전, IndexedDB 팩토리 폴백 */
describe('로그 분리·세이브 이전 (2.0.1)', () => {
  function counting(inner: StoragePort) {
    const n = { write: 0, writeLog: 0 };
    const port: StoragePort = {
      ...inner,
      write: (id, d, m) => ((n.write += 1), inner.write(id, d, m)),
      writeLog: (id, d) => ((n.writeLog += 1), inner.writeLog!(id, d)),
    };
    return { port, n };
  }
  const mapKv = (m: Map<string, string>): KeyValue => ({ get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), del: (k) => void m.delete(k) });
  function v1Save(seed: number, clubName = 'v1 FC'): string {
    const storage = createMemoryStorage();
    const a = createGameService({ storage, clock });
    a.newGame({ seed, clubName });
    a.logEvent('SESSION_START');
    return storage.load()!;
  }

  it('logEvent 1건 = 로그 쓰기만, 세이브 본문 재직렬화 없음. 본문엔 actionLog 가 없고 다시 열면 합쳐진다', async () => {
    const inner = createMemorySlotStorage();
    const { port, n } = counting(inner);
    const a = svc(port);
    a.newGame({ seed: 2, slotId: 1 });
    a.advanceDay();
    await a.flush();
    const before = { ...n };
    a.logEvent('SESSION_START');
    a.logEvent('SESSION_END');
    await a.flush();
    expect(n.write).toBe(before.write);
    expect(n.writeLog - before.writeLog).toBeGreaterThanOrEqual(1);
    expect(n.writeLog - before.writeLog).toBeLessThanOrEqual(2); // 진행 중 1회 + 합쳐진 1회
    expect('actionLog' in JSON.parse((await inner.read(1))!)).toBe(false);

    const b = svc(inner);
    const kinds = (await b.openSlot(1)).actionLog.map((e) => e.kind);
    expect(kinds).toEqual([...a.getSnapshot()!.actionLog.map((e) => e.kind)]);
    expect(kinds.slice(-2)).toEqual(['SESSION_START', 'SESSION_END']);
    expect(JSON.parse(await b.exportSlot(1)).actionLog).toHaveLength(kinds.length);
  });

  it('로그만 대기 중에 본문 쓰기가 실패해도 본문 재시도를 잃지 않는다', async () => {
    const inner = createMemorySlotStorage();
    let fail = true;
    const a = svc({ ...inner, write: (id, d, m) => (fail ? Promise.reject(new Error('quota')) : inner.write(id, d, m)) });
    a.newGame({ seed: 8, slotId: 1 });
    a.logEvent('SESSION_START'); // 본문 쓰기 대기 중 로그만 추가
    expect(await code(a.flush())).toBe('STORAGE_FULL');
    a.logEvent('SESSION_END');
    fail = false;
    await a.flush();
    expect((await inner.listSlots()).map((m) => m.slotId)).toEqual([1]);
    expect((await svc(inner).openSlot(1)).actionLog.at(-1)?.kind).toBe('SESSION_END');
  });

  it('호환: 로그 저장소 없는 본문(actionLog 포함)과 깨진 로그도 열린다', async () => {
    const store = createMemorySlotStorage();
    const json = v1Save(4);
    const meta = { slotId: 1 as const, clubName: 'x', tier: 'T3' as const, season: 1, day: 1, phase: 'MATCHDAY' as const, savedAt: clock.nowIso(), schemaVersion: 2 };
    await store.write(1, json, meta);
    expect((await svc(store).openSlot(1)).actionLog.map((e) => e.kind)).toEqual(['SEASON_STARTED', 'SESSION_START']);
    await store.writeLog!(1, '{broken');
    expect((await svc(store).openSlot(1)).actionLog).toHaveLength(2); // 본문 로그로 대체
    const { actionLog: _l, ...noLog } = JSON.parse(json);
    await store.write(1, JSON.stringify(noLog), meta);
    expect((await svc(store).openSlot(1)).actionLog).toEqual([]); // 로그 손상이 세이브를 막지 않는다
  });

  it('migrateLocalSaves: v1 → 슬롯 1, 원본은 성공 후에만 제거, 1회만', async () => {
    const m = new Map([[SAVE_KEY, v1Save(31, '이전 FC')]]);
    const target = createMemorySlotStorage();
    expect(await migrateLocalSaves(target, mapKv(m), true, clock.nowIso)).toEqual([1]);
    expect(m.has(SAVE_KEY)).toBe(false);
    expect(await target.listSlots()).toMatchObject([{ slotId: 1, clubName: '이전 FC', savedAt: clock.nowIso() }]);
    const s = await svc(target).openSlot(1);
    expect(s.gameSeed).toBe(31);
    expect(s.actionLog.map((e) => e.kind)).toEqual(['SEASON_STARTED', 'SESSION_START']);
    expect(await migrateLocalSaves(target, mapKv(m), true, clock.nowIso)).toEqual([]); // 두 번째 실행: 할 일 없음
  });

  it('migrateLocalSaves: 쓰기 실패·깨진 v1 은 원본 유지, 차 있는 슬롯은 덮어쓰지 않는다', async () => {
    const v1 = v1Save(32);
    const m = new Map([[SAVE_KEY, v1]]);
    const failing: StoragePort = { ...createMemorySlotStorage(), write: () => Promise.reject(new Error('quota')) };
    await expect(migrateLocalSaves(failing, mapKv(m), true)).rejects.toThrow('quota');
    expect(m.get(SAVE_KEY)).toBe(v1);

    const bad = new Map([[SAVE_KEY, '{oops']]);
    expect(await migrateLocalSaves(createMemorySlotStorage(), mapKv(bad), true)).toEqual([]);
    expect(bad.has(SAVE_KEY)).toBe(true);

    const target = createMemorySlotStorage();
    const a = svc(target);
    a.newGame({ seed: 1, slotId: 1 });
    await a.flush();
    expect(await migrateLocalSaves(target, mapKv(m), true)).toEqual([2]); // 슬롯 1 은 차 있음 → 첫 빈 슬롯
    expect((await svc(target).openSlot(1)).gameSeed).toBe(1);
    expect((await svc(target).openSlot(2)).gameSeed).toBe(32);
  });

  it('migrateLocalSaves: localStorage 슬롯 키(+로그)를 같은 번호로 옮긴다', async () => {
    const m = new Map<string, string>();
    const lsSlots = kvSlotStorage(mapKv(m));
    const a = svc(lsSlots);
    a.newGame({ seed: 41, slotId: 3 });
    a.logEvent('SESSION_START');
    await a.flush();
    const target = createMemorySlotStorage();
    expect(await migrateLocalSaves(target, mapKv(m), true)).toEqual([3]);
    expect(m.size).toBe(0);
    const s = await svc(target).openSlot(3);
    expect(s.gameSeed).toBe(41);
    expect(s.actionLog.at(-1)?.kind).toBe('SESSION_START');
  });

  it('createIndexedDbSlotStorage: IndexedDB 없는 환경 → localStorage 슬롯 폴백 + v1 이전', async () => {
    const m = new Map([[SAVE_KEY, v1Save(51)]]);
    const kv = mapKv(m);
    const g = globalThis as { localStorage?: unknown; indexedDB?: unknown };
    const prev = g.localStorage;
    expect(g.indexedDB).toBeUndefined();
    g.localStorage = { getItem: kv.get, setItem: kv.set, removeItem: kv.del };
    try {
      const store = createIndexedDbSlotStorage();
      expect((await store.listSlots()).map((x) => x.slotId)).toEqual([1]);
      expect(m.has(SAVE_KEY)).toBe(false);
      expect([...m.keys()].sort()).toEqual(['kickoff-fm/slot/1', 'kickoff-fm/slot/1/meta']);
      const a = svc(store);
      expect((await a.openSlot(1)).gameSeed).toBe(51);
      a.advanceDay();
      await a.flush();
      expect(m.has('kickoff-fm/slot/1/log')).toBe(true);
    } finally {
      g.localStorage = prev;
    }
  });
});
