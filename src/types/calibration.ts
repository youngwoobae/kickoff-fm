/** 8.1 보정 목표 몬테카를로 배치 (개발자 패널, scripts/sim-batch.ts) */
import type { RuleId } from './engine';
import type { TacticCap } from './tactics';

export type ScenarioId =
  | 'BASELINE' // 동일 전력·동일 전술: 평균 득점·무승부율·슈팅·37/26/37
  | 'COUNTER_SPREAD' // 동일 전력, 최선 카운터 vs 최악 매치업 승률 차
  | 'OVR_DIFF_10' // 전력 10점 차
  | 'OVR_DIFF_10_COUNTER' // 전력 10점 차 + 약팀 최선 카운터
  | 'OVR_DIFF_25' // 전력 25점 차
  | 'TEMPO_VARIANCE' // 템포 차에 따른 약팀 승률 변화
  | 'RULE_ISOLATION'; // 규칙별 단독 기여 P95

export interface CalibrationOptions {
  matchesPerScenario: number;
  tacCap: TacticCap;
  seed: number;
  scenarios?: ScenarioId[];
  /** RULE_ISOLATION 대상 (기본 전체) */
  rules?: RuleId[];
}

export interface CalibrationTarget {
  id: string;
  scenario: ScenarioId;
  label: string;
  min?: number;
  max?: number;
  actual: number;
  pass: boolean;
  unit: '%' | '%p' | 'goals' | 'shots' | 'xG';
}

export interface CalibrationReport {
  engineVersion: string;
  tacCap: TacticCap;
  matchesPerScenario: number;
  seed: number;
  targets: CalibrationTarget[];
  allPass: boolean;
  durationMs: number;
}

export interface CalibrationProgress {
  scenario: ScenarioId;
  done: number;
  total: number;
}
