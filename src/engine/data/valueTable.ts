/**
 * 8.8-2 VALUE 테이블: 결정 성공/실패의 기대 순 xG 차.
 * `npm run sim:batch -- --build-values` 출력으로 갱신한다 (엔진 버전별). 소유: A.
 * 현재 값: 엔진 0.5.0, 스타일 9종 조합 20,000경기 (seed 20260926, cap 0.7)
 */
import type { ValueTable } from '../../types';
import { ENGINE_VERSION } from './constants';

export const VALUE_TABLE: ValueTable = {
  engineVersion: ENGINE_VERSION,
  DP1: 0.0311,
  DP2: 0.0535,
  DP4: { CROSS: 0.0735, THROUGH: 0.2208, CUTBACK: 0.1615, LONG: 0.0203, SOLO: 0.0985, COUNTER: 0.1463 },
  DP6: 0.0787,
  DP7: 0.1463,
  DP8: { z0: 0.035, z1: 0.0231 },
  chanceEv: { CROSS: 0.0262, THROUGH: 0.0568, CUTBACK: 0.0463, LONG: 0.0016, SOLO: 0.0271 },
};
