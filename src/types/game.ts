/**
 * 영속화되는 게임 전체 상태와 하루 진행 결과.
 * GameState 는 services 가 소유한다. UI 는 GameSnapshot(읽기 전용)만 받는다.
 */
import type { ClubId, Day, GameTime, GameTimestamp, MatchId, PlayerId, ProposalId, UserId } from './common';
import type { Membership, Proposal } from './coach';
import type { EngineTeamInput } from './engine';
import type { Finance, LedgerEntry } from './economy';
import type { Club, Fixture, MatchSummary, SeasonOutcome, Tier } from './league';
import type { PlanRecord, ResolvedPlan } from './plan';
import type { Player } from './player';
import type { MatchReport } from './report';
import type { TacticCap } from './tactics';

/**
 * 영속 상태의 국면. 하루 안의 세부 단계(DayStep)는 advanceDay 안에서만 존재하고 저장되지 않는다.
 * - MATCHDAY: Day 1~26, 플랜 편집 가능 (3.1 00:00~20:50 에 해당)
 * - OFFSEASON: Day 27(리뷰)·28(정산), 경기 없음
 * - SEASON_OVER: Day 28 처리 완료, startNewSeason() 대기
 */
export type GamePhase = 'MATCHDAY' | 'OFFSEASON' | 'SEASON_OVER';

/** advanceDay 내부 단계 (아키텍처 문서 6장 상태 머신) */
export type DayStep =
  | 'DEADLINE' // 20:50 플랜 잠금, 제안 만료
  | 'RESOLVE_PLANS' // 4.7 플랜 결정 규칙
  | 'SIMULATE' // 7경기 시뮬
  | 'APPLY_RESULTS' // 순위·선수 상태·수당·리포트
  | 'SEASON_JUDGEMENT' // Day 26 만: 최종 순위·승강 판정
  | 'ROLLOVER' // day + 1
  | 'DAILY_PROCESSING'; // 00:00 회복·연봉·숙련도 감쇠·(Day27 상금, Day28 이월)

export interface GameSettings {
  /** 사용자 리그의 현재 티어 (경제 수치 기준). 승강 시 M3.3 이 바꾼다 */
  tier: Tier;
  /** 2.1.0: 새 게임에서 고른 시작 티어. 없으면(스키마 2 세이브) 첫 시즌 판정의 티어 또는 tier */
  startTier?: Tier;
  tacCap: TacticCap;
  /** 개발자 패널 표시 여부 (테스터 빌드는 false) */
  devMode: boolean;
}

/** 사용자 구단 경기만 저장: 재시뮬(중계 재생·개발자 재시뮬)에 필요한 입력 + 리포트 */
export interface StoredMatchRecord {
  matchId: MatchId;
  seed: number;
  engineVersion: string;
  tacCap: TacticCap;
  home: EngineTeamInput;
  away: EngineTeamInput;
  resolvedPlan: ResolvedPlan;
  report: MatchReport;
}

export type ActionLogKind =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'PLAN_DRAFT_SAVED'
  | 'PLAN_SUBMITTED'
  | 'PLAN_RECOMMENDED_SUBMITTED'
  | 'DEFAULT_PLAN_SET'
  | 'TACTIC_CHANGED'
  | 'MANUAL_ROTATION'
  | 'REPORT_VIEWED'
  | 'REPLAY_VIEWED'
  | 'SCOUT_VIEWED'
  | 'ROLE_SWITCHED'
  | 'PROPOSAL_CREATED'
  | 'PROPOSAL_REACTED'
  | 'PROPOSAL_APPROVED'
  | 'PROPOSAL_REJECTED'
  | 'PROPOSAL_EXPIRED'
  | 'DAY_ADVANCED'
  | 'SEASON_STARTED';

/** UI 가 logEvent() 로 직접 남길 수 있는 종류 (나머지는 services 가 자동 기록) */
export type UiLogKind = 'SESSION_START' | 'SESSION_END' | 'REPORT_VIEWED' | 'REPLAY_VIEWED' | 'SCOUT_VIEWED';

export interface ActionLogEntry {
  /** 실제 시각 ISO (Clock 포트) */
  at: string;
  gameTime: GameTime;
  actor: UserId;
  kind: ActionLogKind;
  data?: Record<string, unknown>;
}

export interface ClubPlanState {
  draft?: PlanRecord;
  confirmed?: PlanRecord;
}

export interface GameState {
  schemaVersion: number;
  engineVersion: string;
  gameSeed: number;
  createdAt: string;
  time: GameTime;
  phase: GamePhase;
  seq: number;
  settings: GameSettings;
  userClubId: ClubId;
  /** 현재 로컬에서 행동 중인 사용자 (역할 전환 토글) */
  actorUserId: UserId;
  clubs: Record<ClubId, Club>;
  players: Record<PlayerId, Player>;
  fixtures: Fixture[];
  summaries: Record<MatchId, MatchSummary>;
  records: Record<MatchId, StoredMatchRecord>;
  /** 다음 경기 기준 구단별 초안·확정본. 경기 처리 후 비운다 */
  plans: Record<ClubId, ClubPlanState>;
  finances: Record<ClubId, Finance>;
  memberships: Membership[];
  proposals: Record<ProposalId, Proposal>;
  seasonHistory: SeasonOutcome[];
  /** Day 26 판정 후 설정, startNewSeason 에서 seasonHistory 로 이동 */
  pendingOutcome?: SeasonOutcome;
  actionLog: ActionLogEntry[];
}

export type GameSnapshot = Readonly<GameState>;

export interface DayResult {
  from: GameTime;
  to: GameTime;
  phaseAfter: GamePhase;
  /** 이 날 치러진 경기 (경기 없는 날은 빈 배열) */
  matches: MatchSummary[];
  userMatchId?: MatchId;
  /** 사용자 구단에 실제 적용된 플랜 (4.7 결과) */
  userResolvedPlan?: ResolvedPlan;
  ledger: LedgerEntry[];
  expiredProposals: ProposalId[];
  seasonOutcome?: SeasonOutcome;
  notices: string[];
  processedAt: GameTimestamp;
}

export type GameErrorCode =
  | 'NO_GAME'
  | 'PERMISSION_DENIED'
  | 'INVALID_PLAN'
  | 'INVALID_TACTIC'
  | 'NOT_FOUND'
  | 'INVALID_PHASE'
  | 'PROPOSAL_LIMIT'
  | 'PROPOSAL_DUPLICATE'
  | 'PROPOSAL_NOT_OPEN'
  | 'PROPOSAL_INVALID'
  | 'SAVE_INCOMPATIBLE'
  | 'STORAGE_FULL';

export interface PlanValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  playerId?: PlayerId;
}

/** getPlanState() 반환 */
export interface PlanState {
  clubId: ClubId;
  matchId: MatchId | null;
  opponentId: ClubId | null;
  day: Day;
  draft?: PlanRecord;
  confirmed?: PlanRecord;
  defaultPlan?: PlanRecord['plan'];
  /** 지금 마감되면 적용될 플랜 (4.7 ③) */
  preview: ResolvedPlan | null;
}
