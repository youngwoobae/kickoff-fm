/**
 * 8.8-2 VALUE 테이블: 결정 성공/실패의 기대 순 xG 차.
 * `npm run sim:batch -- --build-values` 출력으로 갱신한다 (엔진 버전별). 소유: A.
 * 현재 값: 엔진 0.3.0, 프리셋 5종 조합 20,000경기 (seed 20260926, cap 0.5)
 */
import type { ValueTable } from '../../types';
import { ENGINE_VERSION } from './constants';

export const VALUE_TABLE: ValueTable = {
  engineVersion: ENGINE_VERSION,
  DP1: 0.0232,
  DP2: 0.0451,
  DP4: { CROSS: 0.085, THROUGH: 0.251, CUTBACK: 0.1741, LONG: 0.0359, SOLO: 0.1199, COUNTER: 0.1745 },
  DP6: 0.0792,
  DP7: 0.1745,
  DP8: { z0: 0.025, z1: 0.0168 },
  chanceEv: { CROSS: 0.0191, THROUGH: 0.054, CUTBACK: 0.0369, LONG: 0.0042, SOLO: 0.0271 },
};
