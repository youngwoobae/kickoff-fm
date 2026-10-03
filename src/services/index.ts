/**
 * ★ 공유 계약 ★ UI 는 src/services 에서 이 파일만 import 한다.
 */
export {
  CONTRACT_VERSION,
  SAVE_SLOT_IDS,
  type GameService,
  type NewGameOptions,
  type TacticSlotInput,
  type TacticUpdateResult,
  type FixtureFilter,
  type ResimulateOverrides,
  type SubmitPlanOptions,
  type StyleApplyMode,
  type StyleApplyResult,
} from './api';
export { GameError, isGameError } from './errors';
export {
  createLocalStorageAdapter,
  createMemoryStorage,
  createMemorySlotStorage,
  createLocalStorageSlotStorage,
  kvSlotStorage,
  localStorageKv,
  systemClock,
  SAVE_KEY,
  SLOT_KEY_PREFIX,
  type StoragePort,
  type LegacyStoragePort,
  type Clock,
  type KeyValue,
} from './ports';
export { createIndexedDbSlotStorage, migrateLocalSaves } from './idbStorage';
export { createGameService, type GameServiceDeps } from './gameService';
