/**
 * services 의 외부 의존 포트. 테스트·CLI 는 메모리 구현, 브라우저는 localStorage 구현을 주입한다.
 * 2.0.0: 슬롯 저장소 `StoragePort` 는 비동기다(IndexedDB 어댑터 M2.2 가 같은 포트를 구현한다).
 * 이전 동기 단일 세이브 포트는 `LegacyStoragePort` 로 남는다(loadGame/resetGame 경로, M2.3 이후 제거).
 */
import type { GameState, SaveSlotId, SaveSlotMeta } from '../types';
import { SAVE_SLOT_IDS } from './api';
import { GameError } from './errors';

/**
 * 2.0.0 슬롯 저장소 (비동기). 구현 규칙:
 * - write 는 본문을 먼저, meta 를 나중에 쓴다(meta = 커밋 표식). 실패 시 GameError('STORAGE_FULL') 로 reject.
 * - listSlots 는 meta 가 있는 슬롯만, slotId 오름차순. 깨진 meta 는 건너뛴다.
 * - read 는 본문이 없으면 null. remove 는 없는 슬롯이어도 성공(행동 로그도 함께 지운다).
 * - 2.0.1 행동 로그 분리(선택): readLog/writeLog 가 있으면 서비스는 본문에서 actionLog 를 빼고 로그를 따로 쓴다.
 *   logEvent 는 로그만 쓴다(세이브 재직렬화 없음). 없으면 1.x 처럼 본문에 actionLog 를 넣는다.
 *   로그 값 = JSON.stringify(ActionLogEntry[]). 서비스는 로그를 본문보다 먼저 쓴다.
 */
export interface StoragePort {
  listSlots(): Promise<SaveSlotMeta[]>;
  read(slotId: SaveSlotId): Promise<string | null>;
  write(slotId: SaveSlotId, data: string, meta: SaveSlotMeta): Promise<void>;
  remove(slotId: SaveSlotId): Promise<void>;
  readLog?(slotId: SaveSlotId): Promise<string | null>;
  /** 실패 시 GameError('STORAGE_FULL') 로 reject */
  writeLog?(slotId: SaveSlotId, data: string): Promise<void>;
}

/** 슬롯 목록용 메타. savedAt = 저장 시각 */
export function slotMetaOf(slotId: SaveSlotId, s: GameState, savedAt: string): SaveSlotMeta {
  return {
    slotId,
    clubName: s.clubs[s.userClubId]?.name ?? '',
    tier: s.settings.tier,
    season: s.time.season,
    day: s.time.day,
    phase: s.phase,
    savedAt,
    schemaVersion: s.schemaVersion,
  };
}

export function isSlotMeta(m: unknown): m is SaveSlotMeta {
  const x = m as SaveSlotMeta | null;
  return typeof x === 'object' && x !== null && (SAVE_SLOT_IDS as readonly unknown[]).includes(x.slotId) && typeof x.clubName === 'string' && typeof x.season === 'number';
}

/** @deprecated 1.x 동기 단일 세이브 포트. loadGame/resetGame 과 함께 M2.3 에서 제거 */
export interface LegacyStoragePort {
  load(): string | null;
  /** 용량 초과 시 GameError('STORAGE_FULL') */
  save(data: string): void;
  clear(): void;
}

export interface Clock {
  /** 실제 시각 ISO 문자열 (행동 로그용). 게임 시간과 무관 */
  nowIso(): string;
}

/** 1.x 단일 세이브 키. M2.2 가 이 값을 슬롯 1 로 이전한다 */
export const SAVE_KEY = 'kickoff-fm/save/v1';
export const SLOT_KEY_PREFIX = 'kickoff-fm/slot/';

/** @deprecated 1.x 동기 어댑터 (LegacyStoragePort) */
export function createLocalStorageAdapter(key: string = SAVE_KEY): LegacyStoragePort {
  return {
    load: () => globalThis.localStorage?.getItem(key) ?? null,
    save: (data) => {
      globalThis.localStorage?.setItem(key, data);
    },
    clear: () => {
      globalThis.localStorage?.removeItem(key);
    },
  };
}

/** @deprecated 1.x 동기 메모리 저장소 (LegacyStoragePort) */
export function createMemoryStorage(initial: string | null = null): LegacyStoragePort {
  let value = initial;
  return {
    load: () => value,
    save: (data) => {
      value = data;
    },
    clear: () => {
      value = null;
    },
  };
}

function parseMeta(raw: string | null): SaveSlotMeta | null {
  if (!raw) return null;
  try {
    const m: unknown = JSON.parse(raw);
    return isSlotMeta(m) ? m : null;
  } catch {
    return null;
  }
}

export interface KeyValue {
  get(k: string): string | null;
  set(k: string, v: string): void;
  del(k: string): void;
}

/** 키-값 저장소 하나로 슬롯 포트를 만든다 (메모리·localStorage 공용). 키: `{prefix}{n}`, `/meta`, `/log` */
export function kvSlotStorage(kv: KeyValue, prefix: string = SLOT_KEY_PREFIX): StoragePort {
  const fail = (id: SaveSlotId, e: unknown) => new GameError('STORAGE_FULL', `슬롯 ${id} 저장 실패: 저장 공간이 부족합니다`, [String(e)]);
  return {
    listSlots: async () => SAVE_SLOT_IDS.map((id) => parseMeta(kv.get(`${prefix}${id}/meta`))).filter((m): m is SaveSlotMeta => m !== null),
    read: async (id) => kv.get(`${prefix}${id}`),
    write: async (id, data, meta) => {
      try {
        kv.set(`${prefix}${id}`, data);
        kv.set(`${prefix}${id}/meta`, JSON.stringify(meta));
      } catch (e) {
        throw fail(id, e);
      }
    },
    remove: async (id) => {
      kv.del(`${prefix}${id}/meta`);
      kv.del(`${prefix}${id}`);
      kv.del(`${prefix}${id}/log`);
    },
    readLog: async (id) => kv.get(`${prefix}${id}/log`),
    writeLog: async (id, data) => {
      try {
        kv.set(`${prefix}${id}/log`, data);
      } catch (e) {
        throw fail(id, e);
      }
    },
  };
}

/** 테스트용 메모리 슬롯 저장소. `data` 로 내부 맵을 들여다볼 수 있다 */
export function createMemorySlotStorage(): StoragePort & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  const port = kvSlotStorage({ get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), del: (k) => void data.delete(k) }, SLOT_KEY_PREFIX);
  return Object.assign(port, { data });
}

const ls = () => {
  const s = globalThis.localStorage;
  if (!s) throw new GameError('STORAGE_FULL', 'localStorage 를 쓸 수 없습니다');
  return s;
};

/** globalThis.localStorage 키-값 (없으면 호출 시 STORAGE_FULL) */
export const localStorageKv: KeyValue = { get: (k) => ls().getItem(k), set: (k, v) => ls().setItem(k, v), del: (k) => ls().removeItem(k) };

/** localStorage 슬롯 저장소 (키 `kickoff-fm/slot/{n}`, `/meta`, `/log`). IndexedDB 를 못 쓸 때의 폴백 */
export function createLocalStorageSlotStorage(prefix: string = SLOT_KEY_PREFIX): StoragePort {
  return kvSlotStorage(localStorageKv, prefix);
}

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };
