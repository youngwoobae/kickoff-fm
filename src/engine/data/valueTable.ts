/**
 * 8.8-2 VALUE 테이블: 결정 성공/실패의 기대 순 xG 차.
 * `npm run sim:batch -- --build-values` 출력으로 갱신한다 (엔진 버전별). 소유: A.
 * 현재 값: 엔진 0.4.0, 스타일 9종 조합 20,000경기 (seed 20260926, cap 0.5)
 */
import type { ValueTable } from '../../types';
import { ENGINE_VERSION } from './constants';

export const VALUE_TABLE: ValueTable = {
  engineVersion: ENGINE_VERSION,
  DP1: 0.0308,
  DP2: 0.0532,
  DP4: { CROSS: 0.0661, THROUGH: 0.2226, CUTBACK: 0.1496, LONG: 0.0232, SOLO: 0.1034, COUNTER: 0.1461 },
  DP6: 0.0758,
  DP7: 0.1461,
  DP8: { z0: 0.0342, z1: 0.022 },
  chanceEv: { CROSS: 0.024, THROUGH: 0.0611, CUTBACK: 0.0421, LONG: 0.0033, SOLO: 0.0283 },
};
