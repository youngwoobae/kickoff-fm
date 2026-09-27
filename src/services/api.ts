/**
 * ★ 공유 계약 (A·B 공동 고정) ★
 * UI 가 호출할 수 있는 유일한 진입점. 모양은 CBT 서버 API(submitPlan, advanceDay, getReport, propose, approve)에 맞춘다.
 * - 모든 메서드는 동기(로컬 목 백엔드)다. runCalibration 만 Promise(웹 워커).
 * - 실패는 GameError(code) 를 throw 한다 (services/errors.ts).
 * - 반환 객체는 불변으로 취급한다. UI 는 수정하지 않는다.
 * - 상태가 바뀌는 메서드는 영속화 후 subscribe 리스너를 호출한다.
 * 변경 규칙: 추가(additive)는 CONTRACT_VERSION minor +1, 시그니처 변경·삭제는 A·B 합의 후 major +1.
 */
import type {
  ApproveResult,
  CalibrationOptions,
  CalibrationProgress,
  CalibrationReport,
  Catalog,
  ClubId,
  DayResult,
  FinanceSummary,
  Fixture,
  GameSnapshot,
  MatchId,
  MatchPlan,
  MatchReplay,
  MatchReport,
  MatchupPreview,
  Membership,
  OpponentScout,
  PlanChangePatch,
  PlanRecord,
  PlanState,
  PlanValidationIssue,
  Player,
  PlayerId,
  Proposal,
  ProposalId,
  ProposalInput,
  ProposalStatus,
  ResolvedPlan,
  RuleId,
  SeasonNo,
  SeasonOutcome,
  SlotKey,
  StandingRow,
  StyleFit,
  StyleId,
  TacticCap,
  TacticSlot,
  Tier,
  UiLogKind,
} from '../types';

/**
 * 1.2.0 (엔진 0.4.0, 추가만): 포메이션 3·역할 14·스타일 9(Catalog.styles, StyleDef), RuleId R11~R13,
 * 경기 통계(유효슈팅·코너·경고·시간 가중 점유·추가시간 분), OpponentScout.style, Club.style,
 * 선택 메서드 applyStyle / getStyleFits / getMatchupPreview. 세이브 스키마 2.
 */
export const CONTRACT_VERSION = '1.2.0';

export interface NewGameOptions {
  /** 미지정 시 Date.now() 기반 */
  seed?: number;
  clubName?: string;
  /** 경제 수치 기준 티어 (기본 T3: 승격·강등 라벨이 모두 나오는 티어) */
  tier?: Tier;
  tacCap?: TacticCap;
  devMode?: boolean;
}

/** updateTacticSlot 입력. familiarity 는 서비스가 계산하므로 받지 않는다 */
export type TacticSlotInput = Omit<TacticSlot, 'familiarity' | 'key'>;

export interface TacticUpdateResult {
  slot: TacticSlot;
  /** 포메이션 변경으로 숙련도가 절반이 되었는가 */
  familiarityHalved: boolean;
}

/** 1.1.0 추가: submitPlan 두 번째 인자 (선택) */
export interface SubmitPlanOptions {
  /** 'RECOMMENDED' 면 행동 로그를 PLAN_RECOMMENDED_SUBMITTED 로 남긴다 */
  origin?: 'MANUAL' | 'RECOMMENDED';
}

/** 1.2.0: 스타일 적용 방식. INSTRUCTIONS_ONLY = 지시만(숙련도 유지), FULL = 포메이션·역할까지(포메이션이 바뀌면 숙련도 × 0.5) */
export type StyleApplyMode = 'INSTRUCTIONS_ONLY' | 'FULL';

/** 1.2.0: applyStyle 결과 */
export interface StyleApplyResult extends TacticUpdateResult {
  styleId: StyleId;
  mode: StyleApplyMode;
  /** FULL 로 포메이션이 바뀌어 숙련도가 절반이 되면 경고 문구 */
  warning?: string;
}

export interface FixtureFilter {
  clubId?: ClubId;
  day?: number;
  played?: boolean;
}

export interface ResimulateOverrides {
  tacCap?: TacticCap;
  disabledRules?: RuleId[];
  tacticsEnabled?: boolean;
}

export interface GameService {
  readonly contractVersion: string;

  // ── 상태 구독 (useSyncExternalStore 용) ──────────────────────────
  /** 게임이 없으면 null. 같은 상태면 같은 참조를 돌려준다 */
  getSnapshot(): GameSnapshot | null;
  subscribe(listener: () => void): () => void;

  // ── 수명 주기 ────────────────────────────────────────────────────
  newGame(opts?: NewGameOptions): GameSnapshot;
  /** 저장소에서 불러오기. 없거나 호환 불가면 null */
  loadGame(): GameSnapshot | null;
  resetGame(): void;
  exportSave(): string;
  /** 실패 시 GameError('SAVE_INCOMPATIBLE') */
  importSave(json: string): GameSnapshot;

  // ── 역할 전환 (Phase 0 로컬 코치 시연) ──────────────────────────
  getActor(): Membership;
  switchRole(seat: 'OWNER' | 'COACH'): Membership;

  // ── 조회 ─────────────────────────────────────────────────────────
  getCatalog(): Catalog;
  /** 기본값: 사용자 구단 */
  getSquad(clubId?: ClubId): Player[];
  getPlayer(playerId: PlayerId): Player;
  getStandings(): StandingRow[];
  getFixtures(filter?: FixtureFilter): Fixture[];
  /** 사용자 구단의 다음 경기. 시즌 경기 종료 후 null */
  getNextMatch(): Fixture | null;
  getOpponentScout(clubId: ClubId): OpponentScout;
  getFinance(clubId?: ClubId): FinanceSummary;

  // ── 전술·플랜 (OWNER 전용, COACH 는 PERMISSION_DENIED) ──────────
  updateTacticSlot(slot: SlotKey, next: TacticSlotInput): TacticUpdateResult;
  getPlanState(): PlanState;
  validatePlan(plan: MatchPlan): PlanValidationIssue[];
  saveDraft(plan: MatchPlan): PlanRecord;
  /** CBT API: 확정 제출 */
  submitPlan(plan: MatchPlan, opts?: SubmitPlanOptions): PlanRecord;
  /**
   * 1.1.0 추가(선택 메서드): 시작 슬롯/포메이션이 바뀔 때 현재 선발 11명을 새 포메이션 슬롯에
   * 적합도 최대로 재배치한 플랜을 돌려준다(저장하지 않음). 슬롯 전술 편집 직후에도 쓸 수 있다.
   */
  remapLineup?(plan: MatchPlan, slot: SlotKey): MatchPlan;
  /**
   * 1.2.0 (선택 메서드): 스타일을 슬롯에 적용. 'INSTRUCTIONS_ONLY' 는 지시값만 바꾸고 포메이션·역할·숙련도를 유지한다.
   * 'FULL' 은 권장 포메이션·역할까지 바꾸며, 포메이션이 바뀌면 숙련도 × 0.5 (warning 문구 포함). OWNER 전용.
   */
  applyStyle?(slot: SlotKey, styleId: StyleId, mode: StyleApplyMode): StyleApplyResult;
  /** 1.2.0 (선택 메서드): 사용자 스쿼드(최적 선발 기준)의 스타일 9종 적합도 */
  getStyleFits?(): StyleFit[];
  /**
   * 1.2.0 (선택 메서드): 우리 슬롯 vs 상대(최근 경기 전술 또는 봇 성향)의 정적 상성 힌트. 엔진 규칙을 RNG 없이 평가한다.
   * 상대 선발은 감독 AI 가 고를 11명으로 추정한다. 없는 구단이면 GameError('NOT_FOUND').
   */
  getMatchupPreview?(ourSlot: SlotKey, opponentId: ClubId): MatchupPreview;
  /** 상대 맞춤 지시는 제거된 상태로 저장된다 */
  setDefaultPlan(plan: MatchPlan): void;
  /** "추천대로" = 현재 유효 플랜 + 부상/징계 대체 + 피로 로테이션 (감독 AI). 제출은 하지 않는다 */
  recommendPlan(): MatchPlan;
  /** 지금 마감되면 적용될 플랜 (4.7) */
  previewResolvedPlan(): ResolvedPlan | null;

  // ── 진행 (CBT API: advanceDay) ───────────────────────────────────
  advanceDay(): DayResult;
  advanceDays(n: number): DayResult[];
  /** Day 28 처리까지 진행 (SEASON_OVER 에서 멈춤) */
  advanceToSeasonEnd(): DayResult[];
  /** SEASON_OVER 에서만. 나이 +1, 계약 −1, 봇 재생성, 새 일정, Day 1 00:00 처리 */
  startNewSeason(): GameSnapshot;
  /** 기본값: 가장 최근 판정 */
  getSeasonOutcome(season?: SeasonNo): SeasonOutcome | null;

  // ── 리포트 (CBT API: getReport) ──────────────────────────────────
  /** 사용자 구단 경기만 */
  getReport(matchId: MatchId): MatchReport;
  /** 결정적 재시뮬로 생성 (수 ms) */
  getMatchReplay(matchId: MatchId): MatchReplay;

  // ── 코치 제안 (CBT API: propose / approve) ───────────────────────
  propose(input: ProposalInput): Proposal;
  react(proposalId: ProposalId, choice: 'FOR' | 'AGAINST', reason?: string): Proposal;
  /** OWNER 전용. edits 가 있으면 "수정 후 승인". 승인 = 재검증 → 적용 → 구단주 명의 확정 제출 */
  approve(proposalId: ProposalId, edits?: PlanChangePatch): ApproveResult;
  reject(proposalId: ProposalId, note?: string): Proposal;
  listProposals(filter?: { status?: ProposalStatus }): Proposal[];

  // ── 로그 ─────────────────────────────────────────────────────────
  /** 로그만 추가·저장한다. 스냅샷 교체·구독자 알림 없음 (1.1.0 명시) */
  logEvent(kind: UiLogKind, data?: Record<string, unknown>): void;
  exportActionLog(): string;

  // ── 개발자 패널 ──────────────────────────────────────────────────
  setTacCap(cap: TacticCap): void;
  resimulate(matchId: MatchId, overrides?: ResimulateOverrides): MatchReport;
  runCalibration(opts: CalibrationOptions, onProgress?: (p: CalibrationProgress) => void): Promise<CalibrationReport>;
}
