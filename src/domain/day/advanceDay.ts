/**
 * 하루 진행 상태 머신 (아키텍처 문서 6장). 순수 함수: (state) → (newState, result).
 * services 는 이 결과를 저장·통지만 한다. 소유: A.
 */
import type { DayResult, GameState, Tier } from '../../types';

export interface AdvanceOutcome {
  state: GameState;
  result: DayResult;
}

export function advanceDayState(_state: GameState, _nowIso: string): AdvanceOutcome {
  throw new Error('TODO');
}

/** SEASON_OVER → 새 시즌 Day 1 (6.5 ⑦⑧⑨⑪ 의 Phase 0 축소판) */
export function startNewSeasonState(_state: GameState, _nowIso: string): GameState {
  throw new Error('TODO');
}

export function createInitialState(
  _seed: number,
  _opts: { clubName: string; tier: Tier; devMode: boolean },
  _nowIso: string,
): GameState {
  throw new Error('TODO');
}
