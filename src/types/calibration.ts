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
  | 'RULE_ISOLATION' // 규칙별 단독 기여 P95
  // ── 1.2.0 (엔진 0.4.0) ──
  | 'REAL_HOME' // BASELINE + 홈/원정: 홈 승/무/원정 승, 홈−원정 득점
  | 'LEAGUE_REALISM' // 20팀 리그 × 시즌: 실제 리그 통계 전 항목
  | 'STYLE_MATRIX' // 9×9 스타일 상성 행렬: 부호 일치율·절대 우위 없음
  | 'FORMATION_PARITY' // 9 포메이션 라운드로빈: 경기당 승점
  | 'STYLE_FIT' // 스타일 적합 vs 부적합 스쿼드의 상성 이득 차
  | 'ROLE_SIGNATURE' // 역할 교체 서명 지표
  | 'STAMINA_CURVE'; // 게겐프레싱 체력 곡선

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
  unit: '%' | '%p' | 'goals' | 'shots' | 'xG' | 'ppg' | 'min' | 'count' | 'x';
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
