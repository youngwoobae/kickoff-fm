/**
 * 8.1 보정 목표 몬테카를로. scripts/sim-batch.ts(Node)와 웹 워커가 공유한다. 소유: A.
 * 합성 팀은 squad/generator 로 만든다 (엔진은 생성기를 모름 → domain 에 위치).
 */
import type { CalibrationOptions, CalibrationProgress, CalibrationReport } from '../../types';

export function runCalibration(
  _opts: CalibrationOptions,
  _onProgress?: (p: CalibrationProgress) => void,
): CalibrationReport {
  throw new Error('TODO');
}
