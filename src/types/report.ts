/**
 * 경기 리포트 (8.8 블록 1·2·3·4·5·6·8) 와 텍스트 중계 재생 데이터.
 * 리포트는 "우리 구단" 관점으로 생성한다.
 */
import type { ClubId, MatchId } from './common';
import type { FactorBars, RuleId } from './engine';
import type { TeamInstructions } from './tactics';

export interface ReportSummary {
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number;
  xgAgainst: number;
  possession: number;
  shotsFor: number;
  shotsAgainst: number;
  isHome: boolean;
}

export type LuckLevel = 'UNLUCKY' | 'NEUTRAL' | 'LUCKY';

export interface LuckIndicator {
  level: LuckLevel;
  /** (득실 차) − (xG 득실 차) */
  delta: number;
  text: string;
}

/** 블록 3 승부 요인 카드 */
export interface FactorCard {
  ruleId: RuleId;
  beneficiary: 'US' | 'THEM';
  /** 엔진이 실제 판정한 이벤트 수 (오프사이드, 롱볼 전진 등) 또는 발동 횟수 */
  count: number;
  leagueAvgCount: number;
  /** 우리 관점 xG 기여 (부호 포함) */
  xg: number;
  text: string;
}

export interface ZoneFlowRow {
  zone: 0 | 1 | 2;
  label: string;
  passRate: number;
  leagueAvg: number;
}

export type TimelineKind = 'GOAL' | 'TRIGGER' | 'SUB' | 'CONDITION' | 'INJURY' | 'RED_CARD';

export interface TimelineItem {
  minute: number;
  kind: TimelineKind;
  clubId: ClubId;
  text: string;
}

export interface Suggestion {
  ruleId: RuleId;
  text: string;
  /** "적용" 버튼용 지시 패치 (없으면 텍스트만) */
  instructionPatch?: Partial<TeamInstructions>;
}

export interface MatchReport {
  matchId: MatchId;
  clubId: ClubId;
  opponentId: ClubId;
  summary: ReportSummary;
  luck: LuckIndicator;
  /** 최대 3개, |xg| 내림차순 */
  keyFactors: FactorCard[];
  /** 블록 4, 분해 순서 전력 → 준비 → 전술 고정 */
  factorBars: FactorBars;
  zoneFlow: ZoneFlowRow[];
  timeline: TimelineItem[];
  /** 최대 2개 */
  suggestions: Suggestion[];
  /** 시즌 누적 기대 승점 vs 실제 승점 (이 경기 포함) */
  seasonPoints: { expected: number; actual: number };
  /** 개발자 패널: 규칙별 원시 기여 */
  debug?: { ruleXg: Partial<Record<RuleId, number>>; conservationError: number };
}

export type CommentaryKind = 'NEUTRAL' | 'CHANCE' | 'GOAL' | 'TACTIC' | 'SUB' | 'CARD' | 'PERIOD';

export interface CommentaryLine {
  minute: number;
  kind: CommentaryKind;
  clubId?: ClubId;
  text: string;
  /** 이 줄 시점 스코어 [홈, 원정] */
  score: [number, number];
}

/** 텍스트 중계 즉시 재생용 (결정적 재시뮬로 생성) */
export interface MatchReplay {
  matchId: MatchId;
  homeId: ClubId;
  awayId: ClubId;
  lines: CommentaryLine[];
  /** 18 세그먼트 모멘텀 −1..+1 */
  momentum: number[];
  /** 세그먼트별 구역 점유 비율 [Z0, Z1, Z2] (홈 공격 기준) */
  zoneBars: [number, number, number][];
}
