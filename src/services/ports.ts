/**
 * services 의 외부 의존 포트. 테스트·CLI 는 메모리 구현, 브라우저는 localStorage 구현을 주입한다.
 * 2.0.0: 슬롯 저장소 `StoragePort` 는 비동기다(IndexedDB 어댑터 M2.2 가 같은 포트를 구현한다).
 * 이전 동기 단일 세이브 포트는 `LegacyStoragePort` 로 남는다(loadGame/resetGame 경로, M2.3 이후 제거).
 */
import type { SaveSlotId, SaveSlotMeta } from '../types';
import { SAVE_SLOT_IDS } from './api';
import { GameError } from './errors';

/**
 * 2.0.0 슬롯 저장소 (비동기). 구현 규칙:
 * - write 는 본문을 먼저, meta 를 나중에 쓴다(meta = 커밋 표식). 실패 시 GameError('STORAGE_FULL') 로 reject.
 * - listSlots 는 meta 가 있는 슬롯만, slotId 오름차순. 깨진 meta 는 건너뛴다.
 * - read 는 본문이 없으면 null. remove 는 없는 슬롯이어도 성공.
 */
export interface StoragePort {
  listSlots(): Promise<SaveSlotMeta[]>;
  read(slotId: SaveSlotId): Promise<string | null>;
  write(slotId: SaveSlotId, data: string, meta: SaveSlotMeta): Promise<void>;
  remove(slotId: SaveSlotId): Promise<void>;
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
    const m = JSON.parse(raw) as SaveSlotMeta;
    return typeof m === 'object' && m !== null && typeof m.slotId === 'number' && typeof m.clubName === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** 키-값 저장소 하나로 슬롯 포트를 만든다 (메모리·localStorage 공용) */
function kvSlotStorage(kv: { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }, prefix: string): StoragePort {
  return {
    listSlots: async () => SAVE_SLOT_IDS.map((id) => parseMeta(kv.get(`${prefix}${id}/meta`))).filter((m): m is SaveSlotMeta => m !== null),
    read: async (id) => kv.get(`${prefix}${id}`),
    write: async (id, data, meta) => {
      try {
        kv.set(`${prefix}${id}`, data);
        kv.set(`${prefix}${id}/meta`, JSON.stringify(meta));
      } catch (e) {
        throw new GameError('STORAGE_FULL', `슬롯 ${id} 저장 실패: 저장 공간이 부족합니다`, [String(e)]);
      }
    },
    remove: async (id) => {
      kv.del(`${prefix}${id}/meta`);
      kv.del(`${prefix}${id}`);
    },
  };
}

/** 테스트용 메모리 슬롯 저장소. `data` 로 내부 맵을 들여다볼 수 있다 */
export function createMemorySlotStorage(): StoragePort & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  const port = kvSlotStorage({ get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), del: (k) => void data.delete(k) }, SLOT_KEY_PREFIX);
  return Object.assign(port, { data });
}

/** localStorage 슬롯 저장소 (키 `kickoff-fm/slot/{n}`, `kickoff-fm/slot/{n}/meta`). IndexedDB 전까지의 브라우저 구현 */
export function createLocalStorageSlotStorage(prefix: string = SLOT_KEY_PREFIX): StoragePort {
  const ls = () => {
    const s = globalThis.localStorage;
    if (!s) throw new GameError('STORAGE_FULL', 'localStorage 를 쓸 수 없습니다');
    return s;
  };
  return kvSlotStorage({ get: (k) => ls().getItem(k), set: (k, v) => ls().setItem(k, v), del: (k) => ls().removeItem(k) }, prefix);
}

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };
