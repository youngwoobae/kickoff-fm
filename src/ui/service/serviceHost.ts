/** 서비스 생성 (소유: B). 실제 서비스 createGameService(세이브 슬롯 저장소) */
import { createGameService, createIndexedDbSlotStorage, systemClock, type GameService } from '../../services';

/**
 * 개발 도구(개발자 패널) 허용: `vite` 개발 서버, 또는 빌드 시 VITE_DEV_TOOLS=1.
 * 프로덕션 빌드에서는 상수 false 가 되어 관련 동적 import 가 번들에서 빠진다.
 */
export const DEV_TOOLS: boolean = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === '1';

export async function createService(): Promise<GameService> {
  // 브라우저가 저장소를 임의로 비우지 않도록 요청 (실패·미지원은 무시)
  void globalThis.navigator?.storage?.persist?.().catch(() => undefined);
  // IndexedDB 슬롯 저장소 (불가 시 localStorage 폴백, 1.x 세이브는 첫 실행 때 슬롯 1 로 이전)
  return createGameService({ slots: createIndexedDbSlotStorage(), clock: systemClock });
}
