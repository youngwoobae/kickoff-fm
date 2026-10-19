/**
 * ★ 공유 계약 (A·B 공동 고정) ★
 * UI 가 호출할 수 있는 유일한 진입점. 모양은 CBT 서버 API(submitPlan, advanceDay, getReport, propose, approve)에 맞춘다.
 * - 게임 메서드는 동기(로컬 목 백엔드)다. Promise 는 runCalibration(웹 워커)과 2.0.0 슬롯 메서드(listSlots·openSlot·deleteSlot·closeSlot·flush·exportSlot)뿐.
 * - 실패는 GameError(code) 를 throw 한다 (services/errors.ts).
 * - 반환 객체는 불변으로 취급한다. UI 는 수정하지 않는다.
 * - 상태가 바뀌는 메서드는 영속화 후 subscribe 리스너를 호출한다.
 * 변경 규칙: 추가(additive)는 CONTRACT_VERSION minor +1, 시그니처 변경·삭제는 A·B 합의 후 major +1.
 */
import type {
  Kc,
  ApproveResult,
  BidInput,
  Bid,
  CareerRecord,
  InboxMessage,
  LeagueId,
  Pyramid,
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
  MatchStep,
  MatchupPreview,
  Membership,
  ClubMember,
  MemberPatch,
  RoleLabel,
  UserId,
  DealProposal,
  DealProposalInput,
  DealApproveResult,
  OpponentScout,
  PlanChangePatch,
  PlanRecord,
  PlanState,
  PlanValidationIssue,
  Player,
  PlayerId,
  Proposal,
  ReleaseQuote,
  RenewalQuote,
  RenewalResult,
  TransferListing,
  TransferListingFilter,
  TransferWindow,
  ProposalId,
  SaveSlotId,
  SaveSlotMeta,
  SaveStatus,
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
  TacticOverride,
  TacticSlot,
  Tier,
  TrainingFocus,
  UiLogKind,
  YouthIntake,
} from '../types';

/** 버전별 변경 이력: docs/아키텍처.md 16장 */
export const CONTRACT_VERSION = '3.2.0';

/** 2.4.0: 정보 화면용 빌드 정보 (온보딩_UX 2.3) */
export interface BuildInfo {
  /** package.json 버전 (빌드 define __APP_VERSION__, 없으면 'dev') */
  app: string;
  engineVersion: string;
  contractVersion: string;
  saveSchema: number;
}

/** 슬롯 번호 목록 (D28: 3개) */
export const SAVE_SLOT_IDS: readonly SaveSlotId[] = [1, 2, 3];

export interface NewGameOptions {
  /** 미지정 시 Date.now() 기반 */
  seed?: number;
  clubName?: string;
  /**
   * 2.1.0: 사용자 구단이 시작할 티어(D4). 피라미드(M3.2) 이후 기본 T5(루키 리그), T3 = "도전 모드".
   * 단일 리그 상태(지금)에서는 이 리그의 티어가 되며 기본값은 기존과 같은 T3 다.
   */
  startTier?: Tier;
  tacCap?: TacticCap;
  devMode?: boolean;
  /**
   * 2.0.0: 이 슬롯에 새 게임을 만들고 연다(기존 내용은 덮어쓴다 — 확인은 UI 몫). 저장은 write-behind.
   * 생략하면 열린 슬롯에 저장하고, 열린 슬롯이 없으면 저장하지 않는다(메모리만).
   */
  slotId?: SaveSlotId;
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
  /** 2.1.0: 리그. 생략 = 사용자 리그. 피라미드에 없는 리그면 빈 배열 */
  leagueId?: LeagueId;
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
  /** 2.4.0: 앱·엔진·계약·세이브 형식 버전 (좌석 무관, 게임 없어도 된다) */
  getBuildInfo(): BuildInfo;

  // ── 상태 구독 (useSyncExternalStore 용) ──────────────────────────
  /** 게임이 없으면 null. 같은 상태면 같은 참조를 돌려준다 */
  getSnapshot(): GameSnapshot | null;
  subscribe(listener: () => void): () => void;

  // ── 수명 주기 ────────────────────────────────────────────────────
  newGame(opts?: NewGameOptions): GameSnapshot;
  /** 현재 게임 JSON. 다른 슬롯은 exportSlot */
  exportSave(): string;
  /** 실패 시 GameError('SAVE_INCOMPATIBLE'). 2.0.0: slotId 를 주면 그 슬롯에 넣고 연다 */
  importSave(json: string, slotId?: SaveSlotId): GameSnapshot;

  // ── 세이브 슬롯 (2.0.0) ─────
  /** 저장된 슬롯 메타만, slotId 오름차순. 빈 슬롯은 빠진다(SAVE_SLOT_IDS 와 대조) */
  listSlots(): Promise<SaveSlotMeta[]>;
  /**
   * 슬롯을 열어 현재 게임으로 만든다. 열린 슬롯의 남은 쓰기를 먼저 flush 한다. 리스너 통지.
   * 빈 슬롯 = GameError('NOT_FOUND'), 손상·호환 불가 = GameError('SAVE_INCOMPATIBLE')(슬롯은 지우지 않는다).
   */
  openSlot(slotId: SaveSlotId): Promise<GameSnapshot>;
  /** 슬롯 삭제. 열린 슬롯이면 remove 완료 뒤 게임도 닫힌다(getSnapshot() = null, 리스너 통지). 2.1.0: 통지가 remove 뒤로 */
  deleteSlot(slotId: SaveSlotId): Promise<void>;
  /** flush 후 게임을 닫는다(타이틀 화면으로). 실패 시 닫지 않고 reject */
  closeSlot(): Promise<void>;
  /** 밀린 쓰기를 모두 끝낸다. 마지막 쓰기가 실패했으면 GameError('STORAGE_FULL') 로 reject. pagehide·visibilitychange 에서 호출 */
  flush(): Promise<void>;
  /** 슬롯 세이브 JSON (열린 슬롯이면 메모리 최신 상태). 빈 슬롯 = NOT_FOUND */
  exportSlot(slotId: SaveSlotId): Promise<string>;
  /** 열린 슬롯 번호 (없으면 null) */
  getActiveSlot(): SaveSlotId | null;
  /** 자동 저장 상태. 바뀌면 subscribe 리스너가 호출된다. 같은 상태면 같은 참조 */
  getSaveStatus(): SaveStatus;

  // ── 역할 전환 (Phase 0 로컬 코치 시연) ──────────────────────────
  /** 2.5.0: 실제 값은 name·emoji 가 채워진 ClubMember */
  getActor(): Membership;
  /** 호환: 그 좌석의 첫 멤버로 전환. 구단주 PIN 이 있으면 OWNER 전환은 PERMISSION_DENIED(PIN_REQUIRED) — switchMember 를 쓴다 */
  switchRole(seat: 'OWNER' | 'COACH'): Membership;

  // ── 로컬 프로필 (2.5.0, 기기 전용: 한 기기 핫시트) ─────────────────
  /** 사용자 구단 멤버 (구단주 먼저, 추가 순) */
  listMembers(): ClubMember[];
  /** OWNER 전용. 코치 추가 (최대 5명). emoji 생략 = 안 쓰는 색 이모지 자동. 위반 = INVALID_MEMBER */
  addMember(name: string, role: RoleLabel, extra?: { subRole?: RoleLabel; emoji?: string }): ClubMember;
  /** OWNER 전용. 구단주 자신은 name·emoji 만 바뀐다 */
  updateMember(memberId: UserId, patch: MemberPatch): ClubMember;
  /** OWNER 전용. 코치 제거, 그 코치의 미결 제안은 EXPIRED. 구단주 제거 = INVALID_MEMBER */
  removeMember(memberId: UserId): void;
  /** 현재 활동 멤버 전환(기기 넘기기). 대상이 구단주이고 PIN 이 있으면 pin 필요: 없음 = PIN_REQUIRED, 틀림 = PIN_WRONG */
  switchMember(memberId: UserId, pin?: string): ClubMember;
  hasOwnerPin(): boolean;
  /** OWNER 전용. 숫자 4자리 또는 null(해제). 솔트 해시만 저장. 잊으면 세이브 내보내기 JSON 에서 ownerPin 을 지우고 가져오기 */
  setOwnerPin(pin: string | null): void;
  /** 2.6.0 OWNER 전용. 구단 이름 수정(1~20자). shortName 은 자동 파생. 위반 = INVALID_NAME */
  renameClub(name: string): void;
  /** 2.6.0 OWNER 전용. 내 구단 선수 이름 수정(1~20자). 위반 = INVALID_NAME, 남의 구단 선수 = NOT_FOUND */
  renamePlayer(playerId: PlayerId, name: string): Player;

  // ── 조회 ─────────────────────────────────────────────────────────
  getCatalog(): Catalog;
  /** 기본값: 사용자 구단 */
  getSquad(clubId?: ClubId): Player[];
  getPlayer(playerId: PlayerId): Player;
  /**
   * 2.1.0: leagueId 생략 = 사용자 리그. 피라미드에 없는 리그면 GameError('NOT_FOUND').
   * 다른 리그(경량 시뮬, D7)도 같은 StandingRow 모양이다(xG·xPts 는 0일 수 있다).
   */
  getStandings(leagueId?: LeagueId): StandingRow[];
  getFixtures(filter?: FixtureFilter): Fixture[];
  /** 사용자 구단의 다음 경기. 시즌 경기 종료 후 null */
  getNextMatch(): Fixture | null;
  getOpponentScout(clubId: ClubId): OpponentScout;
  getFinance(clubId?: ClubId): FinanceSummary;

  // ── 피라미드·커리어 (2.1.0) ──────
  /**
   * 리그 목록(T1 → T5)과 사용자 리그. 같은 상태면 같은 참조.
   * 단일 리그 세이브(M3.2 전)에서는 사용자 리그 하나만 들어 있다.
   */
  getPyramid(): Pyramid;
  /** 사용자 구단 커리어: 판정 끝난 시즌별 티어·순위·라벨·트로피. 진행 중 시즌은 빠진다 */
  getCareer(): CareerRecord;

  // ── 이적·계약 (2.2.0, 경제 설계 5·6·14장) ─────────────
  // 조회는 모든 좌석, 변경(입찰·등록·재계약·방출)은 OWNER 전용 — COACH 는 PERMISSION_DENIED(v1 은 코치 제안 없음).
  // 잔액 < 0 상태(D18)의 입찰·FA·재계약 인상 = NEGATIVE_BALANCE_LOCK.
  /** 지금 열린 이적 창. 닫혀 있으면 null */
  getTransferWindow(): TransferWindow | null;
  /** 열린 창의 매물(NPC·FA·CLUB). 창이 닫혀 있으면 []. 정렬: value 내림차순, id */
  listTransferListings(filter?: TransferListingFilter): TransferListing[];
  /**
   * 입찰 등록·수정(같은 매물 = 덮어쓰기). 금액을 예약(B 차감). 실패: WINDOW_CLOSED, NOT_FOUND(매물),
   * BID_OUT_OF_RANGE(이적료 min~max·FA 계약금·연봉 하한·기간), INSUFFICIENT_FUNDS, NEGATIVE_BALANCE_LOCK
   */
  placeBid(bid: BidInput): Bid;
  /** 입찰 철회(예약 해제). WINDOW_CLOSED, 내 입찰 없으면 NOT_FOUND */
  withdrawBid(listingId: string): void;
  /** 사용자 구단의 미정산 입찰. 창 밖이면 [] */
  listBids(): Bid[];
  /**
   * 내 선수를 구단 이적 명단에 등록(최저가 0.7V~1.3V). WINDOW_CLOSED, NOT_FOUND(내 선수 아님),
   * BID_OUT_OF_RANGE(최저가 범위 밖·정규 창에 계약 잔여 1시즌)
   */
  listForSale(playerId: PlayerId, minPrice: number): TransferListing;
  /** 내 명단 철회. WINDOW_CLOSED, NOT_FOUND */
  withdrawListing(listingId: string): void;
  /** 재계약 견적(경제 5.2). 대상 아님·기간 밖(Day 20~27, seasonsLeft 1) = RENEWAL_NOT_OPEN, 내 선수 아님 = NOT_FOUND */
  getRenewalQuote(playerId: PlayerId): RenewalQuote;
  /** 재계약 제안. 수락 = 연봉 ≥ ask·기간 허용. RENEWAL_NOT_OPEN, CAP_EXCEEDED, NEGATIVE_BALANCE_LOCK */
  offerRenewal(playerId: PlayerId, salary: number, seasons: number): RenewalResult;
  /** 방출 견적(경제 5.3). 내 선수 아님 = NOT_FOUND */
  getReleaseQuote(playerId: PlayerId): ReleaseQuote;
  /** 방출(위약금 즉시 지급, FA 풀로). 내 선수 아님 = NOT_FOUND. 18명 미만이 되면 FA 풀에서 긴급 FA(1시즌)가 자동으로 채운다(2.2.1) */
  releasePlayer(playerId: PlayerId): void;
  /**
   * 2.2.1: 선수 평가가치 V 와 구단 명단 최저가 범위(0.7V~1.3V, 판매 등록 전 표시용). 매물 선수(NPC·FA)도 된다(FA·NPC 는 계약 잔여 3시즌 취급).
   * 등록 뒤 매물의 값은 등록 시점에 고정된다. 없는 선수 = NOT_FOUND. 모든 좌석
   */
  getPlayerValue(playerId: PlayerId): { value: Kc; minPrice: Kc; maxPrice: Kc };

  // ── 훈련·유스 (2.3.0, 수명주기 7·8장) ─────────────────
  /**
   * 훈련 포커스 예약. 다음 주 시작(Day 1·8·15·22 00:00)부터 적용(Club.training.next). 지금 포커스와 같으면 예약을 지운다.
   * OWNER 전용(코치 PERMISSION_DENIED). 모르는 값 = INVALID_TACTIC
   */
  setTrainingFocus(focus: TrainingFocus): GameSnapshot;
  /**
   * 이번 시즌 유스 후보(Day 1~7, 결정 뒤에도 Day 7 까지 decided·promotedIds 로 남음). 없으면 null.
   * 후보의 potential 은 ovr 로 가려서 내보낸다 — scoutRange(절대)·tierRange(티어 기준 상대, U3)를 쓴다
   */
  getYouthIntake(): YouthIntake | null;
  /**
   * 0~2명 승격(계약 3시즌, 유스 연봉), 나머지는 사라진다. 한 번만(그 뒤 getYouthIntake().decided = true). OWNER 전용.
   * 후보 없음·이미 결정 = INVALID_PHASE, 후보 아님 = NOT_FOUND, 2명 초과·선수단 25명 초과 = SQUAD_FULL
   */
  decideYouth(promoteIds: readonly PlayerId[]): GameSnapshot;

  // ── 받은 편지함 (2.2.0) ─────────────────────────────
  /** 사용자 구단 편지함, 최신 먼저. unreadOnly 면 안 읽은 것만. 같은 상태면 같은 내용 */
  getInbox(filter?: { unreadOnly?: boolean }): InboxMessage[];
  /** 읽음 표시. ids 생략 = 모두. 없는 id 는 무시. 바뀐 게 없으면 저장·통지 없음. 모든 좌석 허용 */
  markRead(ids?: readonly string[]): void;

  // ── 전술·플랜 (OWNER 전용, COACH 는 PERMISSION_DENIED) ──────────
  updateTacticSlot(slot: SlotKey, next: TacticSlotInput): TacticUpdateResult;
  getPlanState(): PlanState;
  validatePlan(plan: MatchPlan): PlanValidationIssue[];
  saveDraft(plan: MatchPlan): PlanRecord;
  /** CBT API: 확정 제출 */
  submitPlan(plan: MatchPlan, opts?: SubmitPlanOptions): PlanRecord;
  /**
   * 1.1.0 추가: 시작 슬롯/포메이션이 바뀔 때 현재 선발 11명을 새 포메이션 슬롯에
   * 적합도 최대로 재배치한 플랜을 돌려준다(저장하지 않음). 슬롯 전술 편집 직후에도 쓸 수 있다.
   */
  remapLineup(plan: MatchPlan, slot: SlotKey): MatchPlan;
  /**
   * 1.2.0: 스타일을 슬롯에 적용. 'INSTRUCTIONS_ONLY' 는 지시값만 바꾸고 포메이션·역할·숙련도를 유지한다.
   * 'FULL' 은 권장 포메이션·역할까지 바꾸며, 포메이션이 바뀌면 숙련도 × 0.5 (warning 문구 포함). OWNER 전용.
   */
  applyStyle(slot: SlotKey, styleId: StyleId, mode: StyleApplyMode): StyleApplyResult;
  /** 1.2.0: 사용자 스쿼드(최적 선발 기준)의 스타일 9종 적합도 */
  getStyleFits(): StyleFit[];
  /**
   * 1.2.0: 우리 슬롯 vs 상대(최근 경기 전술 또는 봇 성향)의 정적 상성 힌트. 엔진 규칙을 RNG 없이 평가한다.
   * 상대 선발은 감독 AI 가 고를 11명으로 추정한다. 없는 구단이면 GameError('NOT_FOUND').
   */
  getMatchupPreview(ourSlot: SlotKey, opponentId: ClubId): MatchupPreview;
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

  // ── 2.6.0 실시간 관전 ──────────────────────────────────────────────
  /** 오늘 사용자 구단 경기가 있으면 라이브 세션 시작. 없으면 null(호출부는 advanceDay() 로 폴백) */
  beginUserMatch(): { fixtureId: string } | null;
  /** 세그먼트(5분) 하나 진행. override 는 다음 세그먼트부터 반영. 마지막이면 하루 처리까지 마친 DayResult 를 돌려준다. 세션 없으면 NOT_FOUND */
  stepUserMatch(override?: TacticOverride): { done: false; step: MatchStep } | { done: true; result: DayResult };
  /** 남은 세그먼트를 전술 변경 없이 즉시 끝내고 하루 처리를 마친다("건너뛰기"). 세션 없으면 NOT_FOUND */
  skipUserMatch(): DayResult;
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
  /** 2.5.0: 이적 입찰·재계약 제안 (코치 역할 영역 검사, 미결 5장은 플랜 제안과 합산). 만료 = 다음 날 처리 */
  proposeDeal(input: DealProposalInput): DealProposal;
  reactDeal(proposalId: ProposalId, choice: 'FOR' | 'AGAINST', reason?: string): DealProposal;
  /** OWNER 전용. 구단주 명의로 placeBid / offerRenewal 실행. 실패·선수 거절이면 STALE */
  approveDeal(proposalId: ProposalId): DealApproveResult;
  rejectDeal(proposalId: ProposalId, note?: string): DealProposal;
  listDealProposals(filter?: { status?: ProposalStatus }): DealProposal[];

  // ── 로그 ─────────────────────────────────────────────────────────
  /** 로그만 추가·저장한다. 스냅샷 교체·구독자 알림 없음 (1.1.0 명시) */
  logEvent(kind: UiLogKind, data?: Record<string, unknown>): void;
  exportActionLog(): string;

  // ── 개발자 패널 ──────────────────────────────────────────────────
  setTacCap(cap: TacticCap): void;
  resimulate(matchId: MatchId, overrides?: ResimulateOverrides): MatchReport;
  runCalibration(opts: CalibrationOptions, onProgress?: (p: CalibrationProgress) => void): Promise<CalibrationReport>;
}
