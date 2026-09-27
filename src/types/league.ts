import type { ClubId, Day, Kc, MatchId, PlayerId, SeasonNo, UserId } from './common';
import type { ZonePass, RuleId } from './engine';
import type { MatchPlan } from './plan';
import type { BotStyle, BotStyleTag, FormationId, SlotKey, StyleId, TacticSlot, TeamInstructions } from './tactics';

export type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export interface Club {
  id: ClubId;
  name: string;
  shortName: string;
  isHuman: boolean;
  ownerUserId?: UserId;
  /**
   * @deprecated 1.x 레거시 태그. 세이브 스키마 2 부터 서비스는 쓰지 않는다(style 로 마이그레이션, 'WIDE' → 'WING_PLAY').
   */
  botStyle?: BotStyleTag;
  /** 1.2.0: 봇 전술 성향 8종 (사람 팀은 없음) */
  style?: BotStyle;
  playerIds: PlayerId[];
  tactics: Record<SlotKey, TacticSlot>;
  /** 구단주가 지정한 상대 무관 기본 플랜 (4.7 ① 3순위) */
  defaultPlan?: MatchPlan;
  /** 직전 경기에 실제 사용된 플랜 (기본 플랜 미지정 시 대체) */
  lastUsedPlan?: MatchPlan;
}

export interface Fixture {
  id: MatchId;
  season: SeasonNo;
  /** 경기일 = 라운드 (1..26) */
  day: Day;
  homeId: ClubId;
  awayId: ClubId;
  played: boolean;
}

export interface TeamSummaryLite {
  clubId: ClubId;
  goals: number;
  xg: number;
  shots: number;
  possession: number;
  formation: FormationId;
  instructions: TeamInstructions;
  zonePass: { z0: ZonePass; z1: ZonePass; z2: ZonePass };
  ruleFires: Partial<Record<RuleId, number>>;
  /** 기대 승점 (xG 기반 포아송 근사) */
  xPts: number;
}

/** 모든 경기(봇 경기 포함)에 대해 영속화하는 경량 결과 */
export interface MatchSummary {
  matchId: MatchId;
  season: SeasonNo;
  day: Day;
  home: TeamSummaryLite;
  away: TeamSummaryLite;
  engineVersion: string;
  seed: number;
}

export type TableZone = 'PROMOTION' | 'RELEGATION' | 'NONE';
export type FormLetter = 'W' | 'D' | 'L';

export interface StandingRow {
  position: number;
  clubId: ClubId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  xgFor: number;
  xgAgainst: number;
  xPts: number;
  /** 최근 5경기, 최신이 마지막 */
  form: FormLetter[];
  zone: TableZone;
}

export type PromotionLabel = 'PROMOTED' | 'RELEGATED' | 'STAYED';

export interface SeasonOutcome {
  season: SeasonNo;
  tier: Tier;
  finalTable: StandingRow[];
  championId: ClubId;
  /** 사람 팀 기준 승강 라벨 (6.2). Phase 0 은 실제 티어 이동 없음 */
  labels: Record<ClubId, PromotionLabel>;
  /** 순위 상금 + 우승 수당 */
  prizes: Record<ClubId, Kc>;
}

export interface OpponentRecentMatch {
  matchId: MatchId;
  day: Day;
  opponentId: ClubId;
  goalsFor: number;
  goalsAgainst: number;
  formation: FormationId;
  /** 예: "압박 +2 · 라인 +1 · 패스 길게" */
  instructionsSummary: string;
}

/** 홈 카드 상대 분석 요약 (12.3, 11 H01) */
export interface OpponentScout {
  clubId: ClubId;
  /** 레거시 5종 표시 태그 (style 을 접은 값: DIRECT → COUNTER, HIGH_LINE → HIGH_PRESS, WING_PLAY·WINGBACK_3 → WIDE) */
  botStyle?: BotStyleTag;
  /** 1.2.0: 상대 스타일 (봇 성향 또는 최근 지시에서 가장 가까운 스타일 추정) */
  style?: StyleId;
  /** 1.2.0: style 이 최근 경기 지시값에서 추정한 값이면 true (봇 성향 원본이면 false) */
  styleEstimated?: boolean;
  last5: OpponentRecentMatch[];
  /** 약점 한 줄 */
  weakness: string;
}
