/**
 * services 의 외부 의존 포트. 테스트·CLI 는 메모리 구현, 브라우저는 localStorage 구현을 주입한다.
 * IndexedDB 로 바꿀 때는 이 포트의 어댑터만 추가한다(아키텍처 문서 ADR-004).
 */

export interface StoragePort {
  load(): string | null;
  /** 용량 초과 시 GameError('STORAGE_FULL') */
  save(data: string): void;
  clear(): void;
}

export interface Clock {
  /** 실제 시각 ISO 문자열 (행동 로그용). 게임 시간과 무관 */
  nowIso(): string;
}

export const SAVE_KEY = 'kickoff-fm/save/v1';

export function createLocalStorageAdapter(key: string = SAVE_KEY): StoragePort {
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

export function createMemoryStorage(initial: string | null = null): StoragePort {
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

export const systemClock: Clock = { nowIso: () => new Date().toISOString() };
