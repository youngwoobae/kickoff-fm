/**
 * 영속화되는 게임 전체 상태와 하루 진행 결과.
 * GameState 는 services 가 소유한다. UI 는 GameSnapshot(읽기 전용)만 받는다.
 */
import type { ClubId, Day, GameTime, GameTimestamp, MatchId, PlayerId, ProposalId, UserId } from './common';
import type { Membership, Proposal } from './coach';
import type { EngineTeamInput } from './engine';
import type { Finance, LedgerEntry } from './economy';
import type { InboxMessage } from './inbox';
import type { Club, Fixture, LeagueState, MatchSummary, SeasonOutcome, Tier } from './league';
import type { PlanRecord, ResolvedPlan } from './plan';
import type { Player, YouthIntake } from './player';
import type { MatchReport } from './report';
import type { TacticCap } from './tactics';
import type { PendingRenewal, TransferMarketState } from './transfer';

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
  | 'SEASON_STARTED'
  /** 2.3.0 */
  | 'TRAINING_FOCUS_SET'
  | 'YOUTH_DECIDED';

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
  /** 사용자 리그 + 다른 4리그의 모든 구단 (2.1.0 피라미드 세이브는 70) */
  clubs: Record<ClubId, Club>;
  /** 소속 선수 + FA 풀(clubId === null, 2.1.1 M3.3). 은퇴·해외 이적 선수는 지운다 */
  players: Record<PlayerId, Player>;
  /**
   * 2.1.0 (M3.2): 5티어 피라미드(T1 → T5, 리그당 14구단). 스키마 3 은 항상 있다(2→3 변환이 단일 리그를 T3 에 배치하고 나머지 티어 생성).
   * 타입상 선택인 이유: 스키마 2 세이브 호환 읽기(leaguesOf 대체 경로)
   */
  leagues?: LeagueState[];
  /** 이번 시즌 전 리그 일정 (피라미드 세이브는 leagueId 가 채워져 있다) */
  fixtures: Fixture[];
  /** 사용자 리그 경기만 (다른 리그 결과는 Fixture.score) */
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
  /**
   * 2.1.1 (M3.3, 수명주기 U6): 시즌 경계(승강·수명주기·정산)를 마친 마지막 "끝난 시즌" 번호. 멱등 표식.
   * 같은 경계를 다시 돌리면 건너뛴다(노화 두 번 방지). 없으면 아직 한 번도 넘지 않음
   */
  boundarySeason?: number;
  /**
   * 2.2.0 (M4.1): 사용자 구단 받은 편지함(오래된 것 → 최신). 없으면 []. 생성·보관(D27) 규칙은 M4.2,
   * 서비스 연결은 M4.4. 스키마 버전은 올리지 않았다(선택 필드라 3 그대로 읽힌다)
   */
  inbox?: InboxMessage[];
  /** 2.2.1 (M4.4): 열린 이적 창의 매물·입찰·NPC 선수. 창 밖이면 없음 (정규 창은 시즌 경계를 넘어 다음 시즌 Day 2 정산까지) */
  transferMarket?: TransferMarketState;
  /** 2.2.1: 시즌 영입 수(창 낙찰, 긴급 FA 제외). 시즌 경계에서 비운다. 없으면 0 */
  signingsThisSeason?: Record<ClubId, number>;
  /** 2.2.1: 성립된 재계약(사람 + Day 20 AI). 시즌 경계 contractBoundary 가 적용하고 비운다. 없으면(이전 세이브) 경계에서 AI 규칙으로 계산 */
  pendingRenewals?: PendingRenewal[];
  /** 2.2.1: 사용자 구단 강등 시즌 무위약 방출권 남은 장수. 없으면 0 */
  freeReleasesLeft?: number;
  /**
   * 2.4.1 (M6 리뷰): 이번 시즌 구단이 방출한 선수. 긴급 FA·FA 입찰에서 그 구단은 다시 데려올 수 없다(방출 → 재영입 우회 차단).
   * 편지함(300통·84일 보관)이 아니라 상태로 둔다. 시즌 경계에서 비운다. 없으면 {}
   */
  releasedThisSeason?: Record<ClubId, PlayerId[]>;
  /** 2.4.1 (C1 리뷰): 이번 시즌 긴급 FA 로 계약한 선수. 시즌당 상한(5.4)과 강제 매각 제외에 쓴다. 시즌 경계에서 비운다. 없으면 {} */
  emergencySignedThisSeason?: Record<ClubId, PlayerId[]>;
  /** 2.3.0 (M5.1): 사람 구단 유스 후보 (새 시즌 Day 1 ~ Day 8 00:00). 없으면 결정할 후보 없음 */
  youthIntake?: YouthIntake;
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
  | 'STORAGE_FULL'
  /** 2.2.0 (M4.1, 경제 14장): 이적·계약 */
  | 'WINDOW_CLOSED'
  | 'BID_OUT_OF_RANGE'
  | 'INSUFFICIENT_FUNDS'
  | 'CAP_EXCEEDED'
  | 'SQUAD_FULL'
  | 'SIGNING_LIMIT'
  | 'RENEWAL_NOT_OPEN'
  | 'NEGATIVE_BALANCE_LOCK';

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
