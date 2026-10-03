/**
 * IndexedDB 슬롯 저장소 (M2.2, 계약 2.0.1). 외부 패키지 없이 네이티브 IndexedDB.
 * DB `kickoff-fm` v1, 저장소 3개(키 = slotId): `slots`(SaveSlotMeta 객체), `saves`(본문 JSON), `logs`(행동 로그 JSON).
 * 어댑터는 얇게 두고, 이전 로직(migrateLocalSaves)은 StoragePort 만 써서 메모리로 테스트한다.
 */
import type { GameState, SaveSlotId, SaveSlotMeta } from '../types';
import { SAVE_SLOT_IDS } from './api';
import { GameError } from './errors';
import { SAVE_KEY, SLOT_KEY_PREFIX, createLocalStorageSlotStorage, isSlotMeta, kvSlotStorage, localStorageKv, slotMetaOf, type KeyValue, type StoragePort } from './ports';

const DB_NAME = 'kickoff-fm';
const STORES = ['slots', 'saves', 'logs'] as const;

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** 트랜잭션 하나를 돌리고 complete 에서 마지막 요청 결과로 resolve. error/abort(용량 초과 포함)는 reject */
function tx<T>(db: IDBDatabase, stores: readonly string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      reject(e);
      return;
    }
    let out: T | undefined;
    const r = fn(t);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error ?? new Error('IndexedDB 트랜잭션 중단'));
  });
}

const full = (id: SaveSlotId) => (e: unknown) => {
  throw new GameError('STORAGE_FULL', `슬롯 ${id} 저장 실패: 저장 공간이 부족합니다`, [String(e)]);
};

function idbSlotStorage(db: IDBDatabase): StoragePort {
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    listSlots: async () => {
      const all = (await tx(db, ['slots'], 'readonly', (t) => t.objectStore('slots').getAll())) ?? [];
      return all.filter(isSlotMeta).sort((a, b) => a.slotId - b.slotId);
    },
    read: async (id) => str(await tx(db, ['saves'], 'readonly', (t) => t.objectStore('saves').get(id))),
    // 한 트랜잭션이라 원자적이지만 순서 규칙(본문 먼저, 메타 마지막)도 지킨다
    write: (id, data, meta) =>
      tx(db, ['saves', 'slots'], 'readwrite', (t) => {
        t.objectStore('saves').put(data, id);
        t.objectStore('slots').put(meta, id);
      }).then(() => undefined, full(id)),
    remove: async (id) => {
      await tx(db, STORES, 'readwrite', (t) => {
        t.objectStore('slots').delete(id);
        t.objectStore('saves').delete(id);
        t.objectStore('logs').delete(id);
      });
    },
    readLog: async (id) => str(await tx(db, ['logs'], 'readonly', (t) => t.objectStore('logs').get(id))),
    writeLog: (id, data) => tx(db, ['logs'], 'readwrite', (t) => void t.objectStore('logs').put(data, id)).then(() => undefined, full(id)),
  };
}

/**
 * 기존 localStorage 세이브를 target 으로 1회 이전한다. 원본은 target 쓰기가 성공한 뒤에만 지운다(실패분은 다음 실행에 재시도).
 * - `kickoff-fm/save/v1`(1.x 단일 세이브) → 슬롯 1 (차 있으면 첫 빈 슬롯)
 * - `moveSlots` 이면 localStorage 슬롯 `kickoff-fm/slot/{n}`(+meta, log) → 슬롯 n (차 있으면 첫 빈 슬롯)
 * 이미 차 있는 target 슬롯은 덮어쓰지 않는다. 빈 슬롯이 없거나 v1 이 읽을 수 없는 JSON 이면 원본을 그대로 둔다.
 * 돌려주는 값 = 이전된 슬롯 번호.
 */
export async function migrateLocalSaves(target: StoragePort, kv: KeyValue, moveSlots: boolean, nowIso: () => string = () => new Date().toISOString()): Promise<SaveSlotId[]> {
  const taken = new Set((await target.listSlots()).map((m) => m.slotId));
  const place = (want: SaveSlotId) => (taken.has(want) ? SAVE_SLOT_IDS.find((id) => !taken.has(id)) : want);
  const moved: SaveSlotId[] = [];
  const done = (id: SaveSlotId) => (taken.add(id), moved.push(id));

  const v1 = kv.get(SAVE_KEY);
  const v1Slot = place(1);
  if (v1 !== null && v1Slot !== undefined) {
    let meta: SaveSlotMeta | null = null;
    try {
      meta = slotMetaOf(v1Slot, JSON.parse(v1) as GameState, nowIso());
    } catch {
      /* 읽을 수 없는 세이브는 남겨 둔다 */
    }
    if (isSlotMeta(meta)) {
      await target.write(v1Slot, v1, meta); // actionLog 는 본문에 들어 있다(서비스가 읽을 때 처리)
      kv.del(SAVE_KEY);
      done(v1Slot);
    }
  }

  if (moveSlots) {
    const src = kvSlotStorage(kv, SLOT_KEY_PREFIX);
    for (const meta of await src.listSlots()) {
      const data = await src.read(meta.slotId);
      const to = place(meta.slotId);
      if (data === null || to === undefined) continue;
      const log = await src.readLog!(meta.slotId);
      if (log !== null) await target.writeLog?.(to, log);
      await target.write(to, data, { ...meta, slotId: to });
      await src.remove(meta.slotId);
      done(to);
    }
  }
  return moved;
}

/**
 * 브라우저 슬롯 저장소. IndexedDB 를 열고 localStorage 세이브를 이전한 뒤 쓴다.
 * IndexedDB 가 없거나 열리지 않으면(사생활 모드 등) localStorage 슬롯 저장소로 폴백하고 v1 세이브만 이전한다.
 * 이전 실패는 부팅을 막지 않는다(원본이 남아 다음 실행에 재시도).
 */
export function createIndexedDbSlotStorage(): StoragePort {
  const ready: Promise<StoragePort> = (async () => {
    let port: StoragePort | null = null;
    try {
      if (globalThis.indexedDB) port = idbSlotStorage(await openDb(globalThis.indexedDB));
    } catch {
      port = null;
    }
    const isIdb = port !== null;
    port ??= createLocalStorageSlotStorage();
    try {
      await migrateLocalSaves(port, localStorageKv, isIdb);
    } catch {
      /* localStorage 접근 불가·쓰기 실패: 원본 유지 */
    }
    return port;
  })();
  return {
    listSlots: async () => (await ready).listSlots(),
    read: async (id) => (await ready).read(id),
    write: async (id, d, m) => (await ready).write(id, d, m),
    remove: async (id) => (await ready).remove(id),
    readLog: async (id) => (await (await ready).readLog?.(id)) ?? null,
    writeLog: async (id, d) => (await ready).writeLog?.(id, d),
  };
}
