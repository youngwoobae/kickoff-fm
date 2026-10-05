import type { ClubId, Day, Kc, MatchId, PlayerId, SeasonNo, UserId } from './common';
import type { ZonePass, RuleId } from './engine';
import type { MatchPlan } from './plan';
import type { BotStyle, FormationId, SlotKey, StyleId, TacticSlot, TeamInstructions } from './tactics';

export type Tier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

/**
 * 2.1.0: 리그 ID. 1리그/티어(D3)라 티어와 1:1이다. 형식 `L-{tier}` (예: `L-T3`, domain/league/pyramid.ts leagueIdOf).
 * 서버 트랙(2:1 피라미드)에서는 티어당 여러 리그가 되므로 UI 는 ID 를 해석하지 말고 LeagueInfo.tier 를 쓴다.
 */
export type LeagueId = string;

/** 2.1.0: getPyramid() 의 리그 한 줄 */
export interface LeagueInfo {
  id: LeagueId;
  tier: Tier;
  /** 기획서 6.1 명칭 (T1 프리미어 디비전 … T5 루키 리그) */
  name: string;
  /** 정렬된 구단 ID (14) */
  clubIds: ClubId[];
  /** 이 리그에서 위 티어로 올라가는 팀 수 (T1 = 0). 경계별 인원(메인 결정 U-1): T1↔T2·T2↔T3 = 2, T3↔T4·T4↔T5 = 3 */
  promoteCount: number;
  /** 아래 티어로 내려가는 팀 수 (T5 = 0) */
  relegateCount: number;
  /** 사용자 구단이 있는 리그. 이 리그만 풀 엔진, 나머지는 경량 시뮬(D7) */
  isUserLeague: boolean;
}

/**
 * 2.1.0 (M3.2): GameState 안의 리그 한 개. 사용자 리그만 풀 엔진, 나머지는 경량 시뮬(D7) 결과를 Fixture.score 로만 남긴다.
 * 순서·승강 인원은 domain/league/pyramid.ts 가 티어로 계산한다(저장하지 않는다).
 */
export interface LeagueState {
  id: LeagueId;
  tier: Tier;
  /** 정렬된 구단 ID (14) */
  clubIds: ClubId[];
}

/** 2.1.0: 피라미드 전체 (T1 → T5 순) */
export interface Pyramid {
  season: SeasonNo;
  leagues: LeagueInfo[];
  userLeagueId: LeagueId;
}

/** 2.1.0: 시즌 경계 실제 티어 이동 한 건 (사람·AI 구단 모두, D6) */
export interface ClubMovement {
  clubId: ClubId;
  from: Tier;
  to: Tier;
  kind: 'PROMOTED' | 'RELEGATED';
  /** 떠나는 리그의 최종 순위 */
  position: number;
  isHuman: boolean;
}

export interface Club {
  id: ClubId;
  name: string;
  shortName: string;
  isHuman: boolean;
  ownerUserId?: UserId;
  /** 1.2.0: 봇 전술 성향 8종 (사람 팀은 없음) */
  style?: BotStyle;
  playerIds: PlayerId[];
  tactics: Record<SlotKey, TacticSlot>;
  /** 구단주가 지정한 상대 무관 기본 플랜 (4.7 ① 3순위) */
  defaultPlan?: MatchPlan;
  /** 직전 경기에 실제 사용된 플랜 (기본 플랜 미지정 시 대체) */
  lastUsedPlan?: MatchPlan;
  /** 2.3.0 (M5.1, 수명주기 8장): 훈련 포커스. 없으면 { focus: 'BALANCED' }. next 는 다음 주 시작(Day 1·8·15·22)에 focus 로 옮겨진다 */
  training?: { focus: TrainingFocus; next?: TrainingFocus };
}

/** 2.3.0: 훈련 포커스. 균형·공격·수비·체력은 성장 총량 같고 자라는 능력치만 다름, 전술 숙련(성장 ×0.8, 숙련 +3/일)·회복(성장 ×0.7, 회복 +4/일) */
export type TrainingFocus = 'BALANCED' | 'ATTACK' | 'DEFENSE' | 'PHYSICAL' | 'TACTICAL' | 'RECOVERY';

export interface Fixture {
  id: MatchId;
  /** 2.1.0: 소속 리그. 없으면 사용자 리그(스키마 2 세이브) */
  leagueId?: LeagueId;
  season: SeasonNo;
  /** 경기일 = 라운드 (1..26) */
  day: Day;
  homeId: ClubId;
  awayId: ClubId;
  played: boolean;
  /**
   * 2.1.0 (M3.2): 치른 경기 스코어. 피라미드 세이브는 모든 리그의 치른 경기에 채운다(다른 리그는 MatchSummary 가 없으므로 유일한 결과).
   * 없으면(스키마 2 세이브) 사용자 리그는 summaries[id] 를 본다.
   */
  score?: { home: number; away: number };
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
  /** 1.3.0: 유효슈팅·코너·경고·시간 가중 점유율 (엔진 1.2.0 통계, 구 세이브에는 없음) */
  shotsOnTarget?: number;
  corners?: number;
  yellowCards?: number;
  possessionTime?: number;
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
  /** 2.1.0: 판정한 리그. 없으면 사용자 리그 */
  leagueId?: LeagueId;
  /**
   * 2.1.0: 이 시즌 경계에서 실제로 일어난 티어 이동(전 리그). M3.3 이 채운다.
   * 없으면 실제 이동 없음(단일 리그 세이브) — UI 는 labels 로 사람 구단 라벨만 보인다.
   */
  movements?: ClubMovement[];
}

/** 2.1.0: 커리어 기록의 트로피 (컵 대회는 v1 범위 밖이라 리그 우승뿐) */
export interface CareerTrophy {
  season: SeasonNo;
  tier: Tier;
  kind: 'LEAGUE_TITLE';
}

/** 2.1.0: 사용자 구단의 한 시즌 기록 (판정이 끝난 시즌만) */
export interface CareerSeason {
  season: SeasonNo;
  tier: Tier;
  leagueId: LeagueId;
  position: number;
  points: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  label: PromotionLabel;
  champion: boolean;
}

/** 2.1.0: getCareer() 반환. 다시즌 커리어 화면용 */
export interface CareerRecord {
  clubId: ClubId;
  /** 새 게임에서 고른 시작 티어 */
  startTier: Tier;
  /** 지금 시즌의 티어 */
  currentTier: Tier;
  /** 판정이 끝난 시즌들, 오래된 순 (진행 중인 시즌은 빠진다) */
  seasons: CareerSeason[];
  trophies: CareerTrophy[];
  /** 도달한 가장 높은 티어 (T1 이 가장 높음) */
  highestTier: Tier;
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
  /** 1.2.0: 상대 스타일 (봇 성향 또는 최근 지시에서 가장 가까운 스타일 추정) */
  style?: StyleId;
  /** 1.2.0: style 이 최근 경기 지시값에서 추정한 값이면 true (봇 성향 원본이면 false) */
  styleEstimated?: boolean;
  last5: OpponentRecentMatch[];
  /** 약점 한 줄 */
  weakness: string;
}
