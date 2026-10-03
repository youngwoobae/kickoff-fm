/** 계약 2.0.0: 세이브 슬롯 (D28: 슬롯 3개, 매일 처리 직후 자동 저장) */
import type { Tier } from './league';
import type { GamePhase } from './game';

/** 슬롯 번호. 목록은 services 의 SAVE_SLOT_IDS */
export type SaveSlotId = 1 | 2 | 3;

/** 타이틀/슬롯 화면용 요약. 세이브 본문을 읽지 않고 목록을 그릴 수 있게 따로 저장한다 */
export interface SaveSlotMeta {
  slotId: SaveSlotId;
  clubName: string;
  tier: Tier;
  season: number;
  day: number;
  phase: GamePhase;
  /** 마지막 저장 실제 시각 (ISO) = "마지막 플레이" */
  savedAt: string;
  schemaVersion: number;
}

/** 자동 저장(write-behind) 상태. 바뀔 때 subscribe 리스너가 호출된다 */
export interface SaveStatus {
  /** 열린 슬롯. 슬롯 없이 진행 중(레거시 경로)이거나 게임이 없으면 null */
  slotId: SaveSlotId | null;
  /** 아직 저장소에 쓰지 않은 변경이 있다 */
  pending: boolean;
  lastSavedAt: string | null;
  /** 마지막 쓰기 실패 메시지 (다음 성공 시 null). 코드는 항상 STORAGE_FULL */
  error: string | null;
}
