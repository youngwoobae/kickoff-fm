/**
 * 8.8-2 VALUE 테이블: 결정 성공/실패의 기대 순 xG 차.
 * `npm run sim:batch -- --build-values` 출력으로 갱신한다 (엔진 버전별). 소유: A.
 * 현재 값: 엔진 0.2.0, 프리셋 5종 조합 20,000경기 (seed 20260926)
 */
import type { ValueTable } from '../../types';
import { ENGINE_VERSION } from './constants';

export const VALUE_TABLE: ValueTable = {
  engineVersion: ENGINE_VERSION,
  DP1: 0.0224,
  DP2: 0.0421,
  DP4: { CROSS: 0.083, THROUGH: 0.2499, CUTBACK: 0.1722, LONG: 0.0342, SOLO: 0.1181, COUNTER: 0.1739 },
  DP6: 0.0763,
  DP7: 0.1739,
  DP8: { z0: 0.0247, z1: 0.0145 },
  chanceEv: { CROSS: 0.0176, THROUGH: 0.0523, CUTBACK: 0.0344, LONG: 0.0038, SOLO: 0.0261 },
};
