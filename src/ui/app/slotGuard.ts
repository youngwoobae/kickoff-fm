/**
 * 같은 세이브를 두 창(설치 앱 + 브라우저 탭 등)에서 열면 각 창의 write-behind 저장이 서로를 덮어
 * 한 창에서 한 진행이 통째로 사라진다 (최종 리뷰 F-M1). 슬롯을 연 창이 채널로 알리면,
 * 같은 슬롯을 열어 둔 다른 창은 저장을 끝내고 닫는다 — 나중에 연 창만 남는다.
 * ponytail: 두 창이 거의 동시에 쓰면 앞 창의 마지막 flush 가 뒤 창의 첫 쓰기 뒤에 올 수 있다(뒤 창의 다음 쓰기가 덮음). 엄격한 단일 쓰기가 필요하면 Web Locks 로
 */
import type { GameService } from '../../services';
import type { SaveSlotId } from '../../types';

export interface SlotChannel {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

export function guardSlotOwner(service: Pick<GameService, 'subscribe' | 'getActiveSlot' | 'closeSlot'>, ch: SlotChannel, onTaken: (slot: SaveSlotId) => void): () => void {
  let mine: SaveSlotId | null = null;
  const announce = () => {
    const id = service.getActiveSlot?.() ?? null;
    if (id !== null && id !== mine) ch.postMessage(id);
    mine = id;
  };
  const off = service.subscribe(announce);
  announce();
  ch.onmessage = (e) => {
    const id = e.data as SaveSlotId;
    if (id === null || id !== service.getActiveSlot?.()) return;
    void service.closeSlot?.().then(() => onTaken(id), () => undefined);
  };
  return () => {
    off();
    ch.onmessage = null;
    ch.close();
  };
}
