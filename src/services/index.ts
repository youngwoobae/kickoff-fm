/**
 * ★ 공유 계약 ★ UI 는 src/services 에서 이 파일만 import 한다.
 */
export {
  CONTRACT_VERSION,
  type GameService,
  type NewGameOptions,
  type TacticSlotInput,
  type TacticUpdateResult,
  type FixtureFilter,
  type ResimulateOverrides,
} from './api';
export { GameError, isGameError } from './errors';
export {
  createLocalStorageAdapter,
  createMemoryStorage,
  systemClock,
  SAVE_KEY,
  type StoragePort,
  type Clock,
} from './ports';
export { createGameService, type GameServiceDeps } from './gameService';
