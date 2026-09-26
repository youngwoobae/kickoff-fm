/**
 * 개발자 패널 몬테카를로 배치용 웹 워커 (소유: A).
 * 사용: new Worker(new URL('./workers/calibration.worker.ts', import.meta.url), { type: 'module' })
 * 메시지: in = CalibrationOptions, out = { type: 'progress', progress } | { type: 'done', report } | { type: 'error', message }
 */
import type { CalibrationOptions, CalibrationProgress, CalibrationReport } from '../../types';
import { runCalibration } from '../../domain';

export type CalibrationWorkerMessage =
  | { type: 'progress'; progress: CalibrationProgress }
  | { type: 'done'; report: CalibrationReport }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<CalibrationOptions>) => {
  const post = (m: CalibrationWorkerMessage) => self.postMessage(m);
  try {
    const report = runCalibration(e.data, (progress) => post({ type: 'progress', progress }));
    post({ type: 'done', report });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
