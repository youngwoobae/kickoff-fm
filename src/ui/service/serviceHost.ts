/**
 * 서비스 선택 (소유: B).
 * - 기본: 실제 서비스 createGameService(localStorage)
 * - 가짜: VITE_FAKE_SERVICE=1 또는 URL ?fake=1 → src/ui/dev/fakeService.ts (동적 import 로 분리 번들)
 */
import { createGameService, createLocalStorageAdapter, systemClock, type GameService } from '../../services';

export type ServiceMode = 'fake' | 'real';

export function resolveServiceMode(): ServiceMode {
  if (import.meta.env.VITE_FAKE_SERVICE === '1') return 'fake';
  try {
    if (new URLSearchParams(globalThis.location?.search ?? '').get('fake') === '1') return 'fake';
  } catch {
    /* noop */
  }
  return 'real';
}

export async function createServiceFor(mode: ServiceMode): Promise<GameService> {
  if (mode === 'fake') {
    const m = await import('../dev/fakeService');
    return m.createFakeGameService();
  }
  return createGameService({ storage: createLocalStorageAdapter(), clock: systemClock });
}

/** 현재 URL 에 ?fake=1 을 붙여 다시 불러온다 (안내 화면의 "지금 fake 모드로" 버튼) */
export function reloadInFakeMode(): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('fake', '1');
  globalThis.location.assign(url.toString());
}

export function reloadInRealMode(): void {
  const url = new URL(globalThis.location.href);
  url.searchParams.delete('fake');
  globalThis.location.assign(url.toString());
}
