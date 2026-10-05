/**
 * GameService 로컬 구현 (소유: A).
 * 구현 원칙: 모든 변경은 (1) checkAction 권한 검사 → (2) 새 GameState 계산(domain 순수 함수)
 * → (3) storage.save → (4) snapshot 교체 → (5) 리스너 통지 순서. 중간 실패 시 이전 상태 유지(원자성).
 * 2.0.0: 슬롯이 열려 있으면 (3) 대신 (4)·(5) 뒤에 슬롯 저장소 쓰기를 예약한다(write-behind, scheduleWrite = 자동 저장 훅 지점).
 * 쓰기 실패는 상태를 되돌리지 않고 SaveStatus.error 로 알리며, flush() 가 재시도한다.
 * 2.0.1: 포트에 로그 저장소(readLog/writeLog)가 있으면 본문에서 actionLog 를 빼고 따로 쓴다. logEvent 는 로그만 쓴다.
 */
import type {
  ActionKind,
  ActionLogEntry,
  ActionLogKind,
  ApproveResult,
  Bid,
  BidInput,
  CareerRecord,
  InboxMessage,
  LeagueId,
  Pyramid,
  AttrDef,
  CalibrationOptions,
  CalibrationProgress,
  CalibrationReport,
  Catalog,
  ClubId,
  DayResult,
  FinanceSummary,
  Fixture,
  GameSnapshot,
  GameState,
  MatchId,
  MatchPlan,
  MatchReplay,
  MatchReport,
  MatchupPreview,
  Membership,
  ClubMember,
  DealApproveResult,
  DealProposal,
  DealProposalInput,
  DealPayload,
  ProposalKind,
  ProposalReaction,
  MemberPatch,
  RoleLabel,
  PermissionResult,
  OpponentScout,
  PlanChangePatch,
  PlanRecord,
  PlanState,
  PlanValidationIssue,
  Player,
  PlayerId,
  Position,
  Proposal,
  ProposalId,
  SaveSlotId,
  SaveSlotMeta,
  SaveStatus,
  ProposalInput,
  ProposalStatus,
  ReleaseQuote,
  RenewalQuote,
  RenewalResult,
  ResolvedPlan,
  SeasonNo,
  SeasonOutcome,
  SlotKey,
  StandingRow,
  StoredMatchRecord,
  StyleFit,
  StyleId,
  TacticSlot,
  TacticCap,
  TeamInstructions,
  TransferListing,
  TransferListingFilter,
  TransferMarketState,
  TransferWindow,
  TrainingFocus,
  UiLogKind,
  YouthIntake,
} from '../types';
import {
  ENGINE_VERSION,
  EngineConstants,
  FORMATIONS,
  FORMATION_IDS,
  PRESETS,
  PRESET_IDS,
  ROLES,
  ROLE_IDS,
  RULE_DEFS,
  RULE_IDS,
  STYLES,
  STYLE_IDS,
  VALUE_TABLE,
  defaultRoles,
  explainMatch,
  hashString,
  mulberry32,
  nearestStyle,
  simulateMatch,
} from '../engine';
import {
  COACH_ID,
  DEFAULT_START_TIER,
  OWNER_ID,
  SYSTEM_ACTOR,
  SCHEMA_VERSION,
  TIER_ECONOMY,
  advanceDayState,
  applyPatch,
  botStyleOf,
  buildCareer,
  buildOpponentScout,
  buildPyramid,
  clubTierMap,
  findLeague,
  leagueTable,
  userLeagueOf,
  buildReplay,
  buildReport,
  carryOver,
  checkAction,
  checkProposeKind,
  toClubMember,
  cleanName,
  cleanEmoji,
  checkRoles,
  nextMemberId,
  hashPin,
  PIN_RE,
  MAX_COACHES,
  MAX_NAME_LENGTH,
  ROLE_LABELS,
  MEMBER_EMOJIS,
  MAX_REASON_LENGTH,
  MAX_OPEN_PER_COACH,
  computeLeagueAverages,
  computeStandings,
  createInitialState,
  createProposal,
  findConflicting,
  isAvailable,
  isDomainError,
  lastTacticOf,
  matchupPreview,
  migrateSave,
  pickLineup,
  staticView,
  styleFitOf,
  toEnginePlayer,
  pickBasePlan,
  remapLineup as remapLineupDomain,
  resolvePlan,
  runCalibration as runCalibrationSync,
  salaryTotal,
  spendable,
  startNewSeasonState,
  stripOpponentOrders,
  validatePlan as validatePlanDomain,
  type PlanBundle,
  TRANSFER,
  capLimit,
  capUsage,
  clubListing,
  clubMatches,
  clubPlayers,
  dropFromMarket,
  fillHumanSquads,
  fillLegacyRenewals,
  CONTRACT,
  listingRecord,
  mailContract,
  marketClubs,
  marketPlayer,
  withPendingRenewal,
  offerRenewal as offerRenewalDomain,
  playerValue,
  post,
  releasePlayer as releasePlayerDomain,
  releaseQuote,
  renewalOpen,
  renewalQuote,
  reservedTotal,
  round1k,
  upsertBid,
  upsertRenewal,
  validateBid,
  type CapChargeInput,
  LIFECYCLE,
  TRAINING_FOCI,
  decideYouthState,
  trainingFocusOf,
} from '../domain';
import {
  CONTRACT_VERSION,
  type BuildInfo,
  type FixtureFilter,
  type GameService,
  type NewGameOptions,
  type ResimulateOverrides,
  type SubmitPlanOptions,
  type StyleApplyMode,
  type StyleApplyResult,
  type TacticSlotInput,
  type TacticUpdateResult,
} from './api';
import { SAVE_SLOT_IDS } from './api';
import { GameError } from './errors';
import { createMemorySlotStorage, createMemoryStorage, slotMetaOf, systemClock, type Clock, type LegacyStoragePort, type StoragePort } from './ports';

export interface GameServiceDeps {
  /** @deprecated 1.x 동기 단일 세이브 (loadGame/resetGame, 슬롯이 열려 있지 않을 때의 저장). 기본: 메모리 */
  storage?: LegacyStoragePort;
  /** 2.0.0 슬롯 저장소. 기본: 메모리. 브라우저는 createIndexedDbSlotStorage() (IndexedDB, 불가 시 localStorage 폴백) */
  slots?: StoragePort;
  clock?: Clock;
}

/** 행동 로그 보관 상한 (아키텍처 4.4) */
export const ACTION_LOG_LIMIT = 5000;

const POSITION_ORDER: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];

const ATTRIBUTES: AttrDef[] = [
  { key: 'passing', label: '패스', group: 'TECHNICAL' },
  { key: 'dribbling', label: '드리블', group: 'TECHNICAL' },
  { key: 'finishing', label: '결정력', group: 'TECHNICAL' },
  { key: 'crossing', label: '크로스', group: 'TECHNICAL' },
  { key: 'tackling', label: '태클', group: 'TECHNICAL' },
  { key: 'vision', label: '시야', group: 'MENTAL' },
  { key: 'positioning', label: '위치선정', group: 'MENTAL' },
  { key: 'composure', label: '침착성', group: 'MENTAL' },
  { key: 'workRate', label: '활동량', group: 'MENTAL' },
  { key: 'pace', label: '속도', group: 'PHYSICAL' },
  { key: 'stamina', label: '체력', group: 'PHYSICAL' },
  { key: 'physical', label: '피지컬', group: 'PHYSICAL' },
  { key: 'reflexes', label: '선방', group: 'GOALKEEPING' },
  { key: 'aerialCommand', label: '공중 장악', group: 'GOALKEEPING' },
  { key: 'kicking', label: '킥', group: 'GOALKEEPING' },
];

const CATALOG: Catalog = {
  formations: FORMATION_IDS.map((id) => FORMATIONS[id]),
  roles: ROLE_IDS.map((id) => ROLES[id]),
  presets: PRESET_IDS.map((id) => PRESETS[id]),
  attributes: ATTRIBUTES,
  rules: RULE_IDS.map((id) => RULE_DEFS[id]),
  styles: STYLE_IDS.map((id) => STYLES[id]),
};

function toGameError(e: unknown): unknown {
  if (isDomainError(e)) return new GameError(e.code, e.message, e.details);
  return e;
}

function isStep(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= -2 && v <= 2;
}

function tacticIssues(formation: string, roles: readonly string[], instr: TeamInstructions): string[] {
  const out: string[] = [];
  const def = FORMATIONS[formation as keyof typeof FORMATIONS];
  if (!def) return [`알 수 없는 포메이션: ${formation}`];
  if (roles.length !== def.slots.length) out.push(`역할은 ${def.slots.length}개여야 합니다`);
  def.slots.forEach((s, i) => {
    const r = roles[i];
    if (r && !s.allowedRoles.includes(r as never)) out.push(`${i + 1}번 자리(${s.position})에 ${r} 역할은 쓸 수 없습니다`);
  });
  for (const k of ['mentality', 'press', 'line', 'width', 'tempo', 'directness'] as const) {
    if (!isStep(instr[k])) out.push(`${k} 는 −2~+2 정수여야 합니다`);
  }
  if (instr.offsideTrap && instr.line < 1) out.push('오프사이드 트랩은 수비 라인 +1 이상에서만 쓸 수 있습니다');
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PHASES = ['MATCHDAY', 'OFFSEASON', 'SEASON_OVER'];
const isInt = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const optInt = (v: unknown, lo = -Infinity, hi = Infinity) => v === undefined || isInt(v, lo, hi);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** 선수 형태 (소속·FA·NPC·유스 후보 공통). 2.3.0 yellowAccum 0~4 */
function playerProblem(p: unknown): boolean {
  if (!isObj(p) || typeof p.id !== 'string' || !isObj(p.attrs) || !isObj(p.availability) || !isObj(p.contract) || !isObj(p.season) || !isNum(p.condition) || !isNum(p.ovr)) return true;
  const a = p.availability;
  const c = p.contract;
  return !isInt(a.injuryDays, 0) || !isInt(a.suspendedMatches, 0) || !optInt(a.yellowAccum, 0, LIFECYCLE.yellowLimit - 1) || !isInt(c.seasonsLeft, 0) || !isInt(c.salary, 0) || !optInt(c.bonusPerSeason, 0);
}

/** 2.2.1 이적 시장 형태 (M3). 창·매물·입찰·NPC 선수 */
function marketProblem(tm: unknown, clubs: Record<string, unknown>): string | null {
  if (!isObj(tm) || !isObj(tm.window) || !Array.isArray(tm.listings) || !Array.isArray(tm.bids) || !isObj(tm.npcPlayers)) return '이적 시장 형식 오류';
  const w = tm.window;
  if (!['MID', 'REGULAR'].includes(w.kind as string) || !isInt(w.season, 1) || !isInt(w.openDay, 1, 28) || !isInt(w.settleDay, 1, 28) || !isInt(w.settleSeason, 1)) return '이적 창 형식 오류';
  const ids = new Set<unknown>();
  for (const l of tm.listings as unknown[]) {
    if (!isObj(l) || typeof l.id !== 'string' || typeof l.playerId !== 'string' || !['NPC', 'FA', 'CLUB'].includes(l.kind as string)) return '이적 매물 형식 오류';
    if (!isInt(l.value, 0) || !isInt(l.minPrice, 0) || !isInt(l.maxPrice, l.minPrice as number) || !optInt(l.bonusMax, 0) || !optInt(l.salaryFloor, 0)) return `이적 매물 ${l.id} 금액 오류`;
    if (l.sellerClubId !== null && !isObj(clubs[l.sellerClubId as string])) return `이적 매물 ${l.id} 판매 구단 오류`;
    ids.add(l.id);
  }
  for (const b of tm.bids as unknown[]) {
    if (!isObj(b) || !ids.has(b.listingId) || !isObj(clubs[b.clubId as string]) || !isInt(b.placedDay, 1, 28)) return '입찰 형식 오류';
    if (!optInt(b.fee, 0) || !optInt(b.bonus, 0) || !optInt(b.salary, 0) || !optInt(b.seasons, 1, 4)) return '입찰 금액 오류';
  }
  for (const p of Object.values(tm.npcPlayers)) if (playerProblem(p)) return 'NPC 선수 형식 오류';
  return null;
}

/** 2.2.1~2.4.1 선택 필드 (M3): 깨진 값이 커밋되면 매일 advanceDay 가 실패하거나 돈이 생긴다 */
function careerFieldsProblem(x: Record<string, unknown>, clubs: Record<string, unknown>, players: Record<string, unknown>): string | null {
  if (x.transferMarket !== undefined) {
    const m = marketProblem(x.transferMarket, clubs);
    if (m) return m;
  }
  if (x.pendingRenewals !== undefined) {
    if (!Array.isArray(x.pendingRenewals)) return '재계약 형식 오류';
    for (const r of x.pendingRenewals as unknown[]) {
      const p = isObj(r) ? players[r.playerId as string] : undefined;
      if (!isObj(r) || !isObj(p) || p.clubId === null || !isInt(r.salary, CONTRACT.minSalary) || !isInt(r.seasons, 1, 4) || !isInt(r.bonusPerSeason, 0)) return '재계약 형식 오류';
    }
  }
  if (x.youthIntake !== undefined) {
    const y = x.youthIntake;
    if (!isObj(y) || !isInt(y.season, 1) || !isObj(clubs[y.clubId as string]) || !Array.isArray(y.candidates) || !isInt(y.deadlineDay, 1, 28)) return '유스 후보 형식 오류';
    if (y.candidates.some(playerProblem) || (y.decided !== undefined && typeof y.decided !== 'boolean') || (y.promotedIds !== undefined && !isStrArr(y.promotedIds))) return '유스 후보 형식 오류';
  }
  if (!optInt(x.freeReleasesLeft, 0, CONTRACT.freeReleasesOnRelegation)) return '무위약 방출권 오류';
  for (const k of ['signingsThisSeason'] as const) {
    const v = x[k];
    if (v !== undefined && (!isObj(v) || !Object.values(v).every((n) => isInt(n, 0)))) return `${k} 형식 오류`;
  }
  for (const k of ['releasedThisSeason', 'emergencySignedThisSeason'] as const) {
    const v = x[k];
    if (v !== undefined && (!isObj(v) || !Object.values(v).every(isStrArr))) return `${k} 형식 오류`;
  }
  if (x.inbox !== undefined) {
    if (!Array.isArray(x.inbox)) return '편지함 형식 오류';
    for (const m of x.inbox as unknown[]) {
      if (!isObj(m) || typeof m.id !== 'string' || typeof m.kind !== 'string' || typeof m.title !== 'string' || typeof m.body !== 'string' || !isInt(m.season, 1) || !isInt(m.day, 1, 28) || typeof m.read !== 'boolean') return '편지함 형식 오류';
    }
  }
  for (const [id, c] of Object.entries(clubs)) {
    const t = (c as Record<string, unknown>).training;
    if (t !== undefined && (!isObj(t) || !TRAINING_FOCI.includes(t.focus as TrainingFocus) || (t.next !== undefined && !TRAINING_FOCI.includes(t.next as TrainingFocus)))) return `구단 ${id} 훈련 포커스 오류`;
  }
  return null;
}

/**
 * 가져오기·불러오기 세이브의 구조·참조 무결성 검사. 문제가 있으면 첫 문제 문장, 없으면 null.
 * 얕은 검사만 하면 깨진 세이브가 저장소에 커밋돼 매 부팅마다 화면 오류로 막힌다.
 */
function saveProblem(x: unknown): string | null {
  if (!isObj(x)) return '객체가 아닙니다';
  if (x.schemaVersion !== SCHEMA_VERSION) return `schemaVersion ${String(x.schemaVersion)} ≠ ${SCHEMA_VERSION}`;
  const t = x.time;
  if (!isNum(x.gameSeed) || !isNum(x.seq) || !isObj(t) || !Number.isInteger(t.season) || (t.season as number) < 1 || !Number.isInteger(t.day) || (t.day as number) < 1 || (t.day as number) > 28) return '시간·시드 정보가 올바르지 않습니다';
  if (!PHASES.includes(x.phase as string)) return `알 수 없는 phase: ${String(x.phase)}`;
  const st = x.settings;
  if (!isObj(st) || !TIER_ECONOMY[st.tier as keyof typeof TIER_ECONOMY] || !(EngineConstants.TAC_CAP_OPTIONS as readonly unknown[]).includes(st.tacCap)) return 'settings 가 올바르지 않습니다';
  for (const k of ['clubs', 'players', 'summaries', 'records', 'plans', 'finances', 'proposals'] as const) if (!isObj(x[k])) return `${k} 가 없습니다`;
  for (const k of ['fixtures', 'memberships', 'seasonHistory', 'actionLog'] as const) if (!Array.isArray(x[k])) return `${k} 가 없습니다`;
  const clubs = x.clubs as Record<string, unknown>;
  const players = x.players as Record<string, unknown>;
  const finances = x.finances as Record<string, unknown>;
  if (typeof x.userClubId !== 'string' || !isObj(clubs[x.userClubId])) return '사용자 구단이 없습니다';
  for (const [id, c] of Object.entries(clubs)) {
    if (!isObj(c) || c.id !== id || typeof c.name !== 'string' || !Array.isArray(c.playerIds) || !isObj(c.tactics)) return `구단 ${id} 형식 오류`;
    for (const pid of c.playerIds) if (playerProblem(players[pid as string])) return `선수 ${String(pid)} 형식 오류`;
    for (const k of ['A', 'B']) {
      const sl = (c.tactics as Record<string, unknown>)[k];
      const def = isObj(sl) ? FORMATIONS[sl.formation as keyof typeof FORMATIONS] : undefined;
      if (!isObj(sl) || !def || !Array.isArray(sl.roles) || sl.roles.length !== def.slots.length || !isObj(sl.instructions) || !isNum(sl.familiarity)) return `구단 ${id} 전술 ${k} 형식 오류`;
    }
    const f = finances[id];
    if (!isObj(f) || !isNum(f.balance) || !isNum(f.transferOnlyBudget) || !Array.isArray(f.ledger) || !optInt(f.negativeSinceDay, 1, 28)) return `구단 ${id} 재정 형식 오류`;
  }
  for (const f of x.fixtures as unknown[]) {
    if (!isObj(f) || typeof f.id !== 'string' || !isNum(f.season) || !isNum(f.day) || !isObj(clubs[f.homeId as string]) || !isObj(clubs[f.awayId as string])) return '일정 형식 오류';
  }
  {
    // 스키마 3 (2.1.1): 5티어 피라미드 필수. 리그마다 고유 티어, 구단은 존재하고 한 리그에만, 사용자 구단 포함
    if (!Array.isArray(x.leagues) || x.leagues.length !== 5) return '리그 형식 오류';
    const seen = new Set<unknown>();
    const tiers = new Set<unknown>();
    for (const l of x.leagues as unknown[]) {
      if (!isObj(l) || typeof l.id !== 'string' || !TIER_ECONOMY[l.tier as keyof typeof TIER_ECONOMY] || tiers.has(l.tier) || !Array.isArray(l.clubIds)) return '리그 형식 오류';
      tiers.add(l.tier);
      for (const id of l.clubIds) {
        if (!isObj(clubs[id as string]) || seen.has(id)) return `리그 ${l.id} 구단 오류`;
        seen.add(id);
      }
    }
    if (!seen.has(x.userClubId)) return '사용자 구단이 리그에 없습니다';
  }
  // FA 풀 선수도 매일 처리(노화·성장)를 거친다
  for (const [id, p] of Object.entries(players)) if (playerProblem(p) || (p as Record<string, unknown>).id !== id) return `선수 ${id} 형식 오류`;
  // 2.2.1~2.4.1 선택 필드 (M3)
  const career = careerFieldsProblem(x, clubs, players);
  if (career) return career;
  const ms = x.memberships as unknown[];
  if (!ms.some((m) => isObj(m) && m.userId === x.actorUserId && m.clubId === x.userClubId)) return '현재 사용자 멤버십이 없습니다';
  return membersProblem(x, ms);
}

const SEATS: readonly unknown[] = ['OWNER', 'COACH', 'COACH_SPECTATOR'];
const isRole = (r: unknown) => ROLE_LABELS.includes(r as RoleLabel);

/** 2.5.0 로컬 프로필: 멤버 형식·인원(구단주 1 + 코치 ≤ 5), 이적·재계약 제안, 구단주 PIN 해시 */
function membersProblem(x: Record<string, unknown>, ms: unknown[]): string | null {
  const ids = new Set<unknown>();
  let owners = 0;
  let coaches = 0;
  for (const m of ms) {
    if (!isObj(m) || typeof m.userId !== 'string' || ids.has(m.userId) || typeof m.clubId !== 'string' || !SEATS.includes(m.seat)) return '멤버 형식 오류';
    ids.add(m.userId);
    if (m.roleLabel !== undefined && !isRole(m.roleLabel)) return '멤버 역할 오류';
    if (m.subRole !== undefined && (!isRole(m.subRole) || m.subRole === m.roleLabel)) return '멤버 보조 역할 오류';
    if (m.name !== undefined && (typeof m.name !== 'string' || m.name.trim().length < 1 || [...m.name].length > MAX_NAME_LENGTH)) return '멤버 이름 오류';
    if (m.emoji !== undefined && (typeof m.emoji !== 'string' || m.emoji.length < 1 || m.emoji.length > 8)) return '멤버 이모지 오류';
    if (m.clubId !== x.userClubId) continue;
    if (m.seat === 'OWNER') owners++;
    else coaches++;
  }
  if (owners !== 1 || coaches > MAX_COACHES) return `구단 멤버 인원 오류 (구단주 ${owners}, 코치 ${coaches})`;
  const pin = x.ownerPin;
  if (pin !== undefined && (!isObj(pin) || typeof pin.salt !== 'string' || !/^[0-9a-f]{16}$/.test(pin.hash as string))) return '구단주 PIN 형식 오류';
  const dp = x.dealProposals;
  if (dp !== undefined) {
    if (!isObj(dp)) return '이적·재계약 제안 형식 오류';
    for (const [id, d] of Object.entries(dp)) {
      if (!isObj(d) || d.id !== id || typeof d.authorId !== 'string' || typeof d.status !== 'string' || !isObj(d.payload) || !isObj(d.expiresAt) || !Array.isArray(d.reactions)) return '이적·재계약 제안 형식 오류';
      const pl = d.payload;
      if (!(pl.kind === 'TRANSFER_BID' && isObj(pl.bid) && typeof pl.bid.listingId === 'string') && !(pl.kind === 'RENEWAL' && typeof pl.playerId === 'string' && isInt(pl.salary, 1) && isInt(pl.seasons, 1, 4))) return '이적·재계약 제안 내용 오류';
    }
  }
  return null;
}

/** PIN 솔트 (재현성 불필요 — 게임 시드와 무관) */
function randomSalt(): string {
  const b = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 2; i++) b[i] = Math.floor(Math.random() * 2 ** 32);
  return Array.from(b, (n) => n.toString(16).padStart(8, '0')).join('');
}

/** 이적·재계약 제안의 대상 (중복 판정) */
function dealTarget(p: DealPayload): string {
  return p.kind === 'TRANSFER_BID' ? `bid:${p.bid.listingId}` : `renew:${p.playerId}`;
}

interface PendingWrite {
  s: GameState;
  /** 본문(세이브)도 쓴다. false = 로그만 (logEvent) */
  save: boolean;
}

class LocalGameService implements GameService {
  readonly contractVersion = CONTRACT_VERSION;

  getBuildInfo(): BuildInfo {
    return {
      app: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
      engineVersion: ENGINE_VERSION,
      contractVersion: CONTRACT_VERSION,
      saveSchema: SCHEMA_VERSION,
    };
  }
  private readonly storage: LegacyStoragePort;
  private readonly slots: StoragePort;
  private readonly clock: Clock;
  private activeSlot: SaveSlotId | null = null;
  /** 쓰기 대기 (슬롯별 최신 상태만 = 합치기). save=false 면 행동 로그만 쓴다 */
  private readonly pendingWrites = new Map<SaveSlotId, PendingWrite>();
  /** 쓰기 실패한 최신 상태. 새 변경이 오면 대체되고, flush 가 재시도한다 */
  private readonly failedWrites = new Map<SaveSlotId, PendingWrite>();
  private writing: Promise<void> | null = null;
  /** 삭제 중인 슬롯: remove 가 끝나기 전 변경이 쓰기를 예약해 슬롯을 되살리지 않게 한다 */
  private readonly deleting = new Set<SaveSlotId>();
  private saveStatus: SaveStatus = { slotId: null, pending: false, lastSavedAt: null, error: null };
  private readonly listeners = new Set<() => void>();
  private state: GameState | null = null;
  private standingsCache: { state: GameState; rows: Map<LeagueId, StandingRow[]> } | null = null;
  private pyramidCache: { state: GameState; pyramid: Pyramid } | null = null;
  private inboxCache: { state: GameState; unread: boolean; list: InboxMessage[] } | null = null;
  private readonly replayCache = new Map<string, MatchReplay>();

  constructor(deps: GameServiceDeps) {
    this.storage = deps.storage ?? createMemoryStorage();
    this.slots = deps.slots ?? createMemorySlotStorage();
    this.clock = deps.clock ?? systemClock;
  }

  // ── 내부 도우미 ────────────────────────────────────────────────

  private require(): GameState {
    if (!this.state) throw new GameError('NO_GAME', '진행 중인 게임이 없습니다. 새 게임을 시작하세요');
    return this.state;
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** 저장 성공 후에만 스냅샷을 교체한다 (원자성) */
  private commit(next: GameState): void {
    if (next.actionLog.length > ACTION_LOG_LIMIT) next = { ...next, actionLog: next.actionLog.slice(-ACTION_LOG_LIMIT) };
    if (this.activeSlot === null) this.saveLegacy(next);
    if (next.schemaVersion !== this.state?.schemaVersion || next.gameSeed !== this.state?.gameSeed) this.replayCache.clear();
    this.state = next;
    this.scheduleWrite();
    this.notify();
  }

  private saveLegacy(next: GameState): void {
    let json: string;
    try {
      json = JSON.stringify(next);
    } catch (e) {
      throw new GameError('STORAGE_FULL', `상태 직렬화 실패: ${String(e)}`);
    }
    try {
      this.storage.save(json);
    } catch (e) {
      if (e instanceof GameError) throw e;
      throw new GameError('STORAGE_FULL', '저장 공간이 부족해 저장하지 못했습니다. 행동 로그를 내보낸 뒤 새 시즌을 시작하세요');
    }
  }

  // ── 슬롯 저장 (write-behind) ───────────────────────────────────

  /**
   * 자동 저장 훅 지점: 슬롯이 열려 있으면 현재 상태 쓰기를 예약한다. 매 변경(= 매일 처리 직후 포함)마다 불린다.
   * saveBody=false(logEvent): 로그 저장소가 있으면 로그만 쓴다. 이미 대기 중인 본문 쓰기는 유지된다.
   */
  private scheduleWrite(saveBody = true): void {
    if (this.activeSlot === null || !this.state || this.deleting.has(this.activeSlot)) return;
    const id = this.activeSlot;
    const prev = this.pendingWrites.get(id) ?? this.failedWrites.get(id);
    this.failedWrites.delete(id);
    this.pendingWrites.set(id, { s: this.state, save: saveBody || !this.slots.writeLog || (prev?.save ?? false) });
    this.writing ??= this.drain();
    this.updateStatus();
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingWrites.size > 0) {
        const [slotId, w] = this.pendingWrites.entries().next().value as [SaveSlotId, PendingWrite];
        this.pendingWrites.delete(slotId);
        try {
          // 로그 먼저, 본문+메타 나중 (메타 = 커밋 표식). ponytail: 로그는 통째로 다시 쓴다(≤ ACTION_LOG_LIMIT), 커지면 키별 append 저장소로
          if (this.slots.writeLog) await this.slots.writeLog(slotId, JSON.stringify(w.s.actionLog));
          if (w.save) await this.slots.write(slotId, this.bodyOf(w.s), slotMetaOf(slotId, w.s, this.clock.nowIso()));
          this.updateStatus({ lastSavedAt: this.clock.nowIso(), error: null });
        } catch (e) {
          const newer = this.pendingWrites.get(slotId);
          if (newer) newer.save ||= w.save;
          else this.failedWrites.set(slotId, w);
          this.updateStatus({ error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      this.writing = null;
      this.updateStatus();
    }
  }

  /** 슬롯 본문. 로그 저장소가 있으면 actionLog 를 뺀다 */
  private bodyOf(s: GameState): string {
    if (!this.slots.writeLog) return JSON.stringify(s);
    const { actionLog: _log, ...rest } = s;
    return JSON.stringify(rest);
  }

  /** 슬롯 본문 + 로그 → 세이브 JSON. 로그가 없거나 깨졌으면 본문의 actionLog(없으면 []) — 로그 손상이 세이브를 막지 않는다 */
  private async readSlot(slotId: SaveSlotId): Promise<string | null> {
    const body = await this.slots.read(slotId);
    if (body === null || !this.slots.readLog) return body;
    let x: unknown;
    try {
      x = JSON.parse(body);
    } catch {
      return body; // parseSave 가 SAVE_INCOMPATIBLE 로 알린다
    }
    if (!isObj(x)) return body;
    let log: unknown = null;
    try {
      const raw = await this.slots.readLog(slotId);
      if (raw !== null) log = JSON.parse(raw);
    } catch {
      /* 로그 손상·읽기 실패 */
    }
    if (Array.isArray(log)) x.actionLog = log;
    else if (!Array.isArray(x.actionLog)) x.actionLog = [];
    return JSON.stringify(x);
  }

  /** 상태 객체는 바뀔 때만 교체한다. 리스너 통지는 error 가 바뀔 때만 (logEvent 무통지 계약 유지) */
  private updateStatus(patch: Partial<SaveStatus> = {}): void {
    const prev = this.saveStatus;
    const next: SaveStatus = {
      ...prev,
      ...patch,
      slotId: this.activeSlot,
      pending: this.writing !== null || this.pendingWrites.size > 0 || this.failedWrites.size > 0,
    };
    if (next.slotId === prev.slotId && next.pending === prev.pending && next.lastSavedAt === prev.lastSavedAt && next.error === prev.error) return;
    this.saveStatus = next;
    if (next.error !== prev.error) this.notify();
  }

  private assertSlot(slotId: SaveSlotId): void {
    if (!SAVE_SLOT_IDS.includes(slotId)) throw new GameError('NOT_FOUND', `없는 슬롯입니다: ${String(slotId)}`);
  }

  /** 세이브 JSON → 검증된 상태. 실패 시 SAVE_INCOMPATIBLE */
  private parseSave(json: string): GameState {
    let parsed: GameState;
    try {
      parsed = migrateSave(JSON.parse(json)) as GameState;
    } catch {
      throw new GameError('SAVE_INCOMPATIBLE', '저장 데이터를 읽을 수 없습니다 (JSON 형식 오류)');
    }
    const problem = saveProblem(parsed);
    if (problem !== null) throw new GameError('SAVE_INCOMPATIBLE', `호환되지 않는 저장 데이터입니다 (${problem})`);
    fillLegacyRenewals(parsed); // M2: Day 20 을 이 코드 없이 지난 세이브의 AI 재계약
    try {
      // 조회 경로 사전 실행: 구조 검사를 통과해도 화면이 쓰는 계산에서 깨지면 커밋하지 않는다
      this.preview(parsed);
      computeStandings(Object.keys(parsed.clubs).sort(), Object.values(parsed.summaries), parsed.time.season, 0);
    } catch (e) {
      throw new GameError('SAVE_INCOMPATIBLE', `저장 데이터가 손상되었습니다 (${e instanceof Error ? e.message : String(e)})`);
    }
    return parsed;
  }

  private close(): void {
    this.activeSlot = null;
    this.state = null;
    this.replayCache.clear();
    this.updateStatus();
    this.notify();
  }

  private entry(s: GameState, kind: ActionLogKind, data?: Record<string, unknown>, actor?: string): ActionLogEntry {
    const who = actor ?? s.actorUserId;
    const m = s.memberships.find((x) => x.userId === who);
    return { at: this.clock.nowIso(), gameTime: { ...s.time }, actor: who, ...(m ? { actorName: toClubMember(m).name } : {}), kind, ...(data ? { data } : {}) };
  }

  private withLog(s: GameState, kind: ActionLogKind, data?: Record<string, unknown>): GameState {
    return { ...s, seq: s.seq + 1, actionLog: [...s.actionLog, this.entry(s, kind, data)] };
  }

  private membership(s: GameState): Membership {
    const m = s.memberships.find((x) => x.userId === s.actorUserId) ?? s.memberships[0];
    if (!m) throw new GameError('NO_GAME', '멤버십이 없습니다');
    return m;
  }

  /** 표시 필드를 채운 멤버 (기본 이모지는 멤버 목록 순서) */
  private member(s: GameState, m: Membership = this.membership(s)): ClubMember {
    return toClubMember(m, Math.max(0, s.memberships.indexOf(m) - 1));
  }

  private clubMembers(s: GameState): Membership[] {
    return s.memberships.filter((m) => m.clubId === s.userClubId);
  }

  private guard(s: GameState, action: ActionKind): void {
    this.deny(checkAction(this.membership(s), action, { now: s.time, pastDeadline: false, clubId: s.userClubId }));
  }

  private deny(r: PermissionResult): void {
    if (!r.ok) throw new GameError('PERMISSION_DENIED', r.message, [r.code]);
  }

  private run<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      throw toGameError(e);
    }
  }

  private ts(s: GameState) {
    return { season: s.time.season, day: s.time.day, seq: s.seq + 1 };
  }

  private nextFixture(s: GameState): Fixture | null {
    if (s.phase !== 'MATCHDAY') return null;
    const uid = s.userClubId;
    const f = s.fixtures
      .filter((x) => x.season === s.time.season && !x.played && x.day >= s.time.day && (x.homeId === uid || x.awayId === uid))
      .sort((a, b) => a.day - b.day)[0];
    return f ?? null;
  }

  private opponentOf(s: GameState, f: Fixture): ClubId {
    return f.homeId === s.userClubId ? f.awayId : f.homeId;
  }

  private preview(s: GameState): ResolvedPlan | null {
    const f = this.nextFixture(s);
    if (!f) return null;
    const club = s.clubs[s.userClubId]!;
    return resolvePlan({
      club,
      fixture: f,
      planState: s.plans[club.id],
      players: s.players,
      opponentPlayerIds: s.clubs[this.opponentOf(s, f)]?.playerIds ?? [],
    });
  }

  private normalizePlan(s: GameState, plan: MatchPlan): MatchPlan {
    const f = this.nextFixture(s);
    return {
      ...plan,
      clubId: s.userClubId,
      matchId: f?.id ?? plan.matchId ?? null,
      lineup: { starters: [...plan.lineup.starters], bench: [...plan.lineup.bench] },
      conditionals: plan.conditionals.map((c) => ({ ...c, conditions: [...c.conditions] })),
    };
  }

  private assertValid(s: GameState, plan: MatchPlan): void {
    const issues = validatePlanDomain(plan, s.clubs[s.userClubId]!, s.players);
    const errors = issues.filter((i) => i.severity === 'ERROR');
    if (errors.length > 0) throw new GameError('INVALID_PLAN', errors[0]!.message, errors.map((e) => e.message));
  }

  // ── 구독 ───────────────────────────────────────────────────────

  getSnapshot(): GameSnapshot | null {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── 수명 주기 ──────────────────────────────────────────────────

  newGame(opts: NewGameOptions = {}): GameSnapshot {
    const tier = opts.startTier ?? opts.tier ?? DEFAULT_START_TIER;
    const seed = opts.seed ?? hashString(`${this.clock.nowIso()}|${Date.now()}`);
    const s0 = createInitialState(
      seed,
      { clubName: opts.clubName ?? '킥오프 FC', tier, devMode: opts.devMode ?? true, tacCap: opts.tacCap ?? (EngineConstants.DEFAULT_TAC_CAP as TacticCap) },
      this.clock.nowIso(),
    );
    const s = {
      ...s0,
      settings: { ...s0.settings, startTier: tier },
      actionLog: [this.entry(s0, 'SEASON_STARTED', { season: 1, seed: s0.gameSeed }, OWNER_ID)],
    };
    if (opts.slotId !== undefined) {
      this.assertSlot(opts.slotId);
      this.activeSlot = opts.slotId;
    }
    this.replayCache.clear();
    this.commit(s);
    return s;
  }

  loadGame(): GameSnapshot | null {
    const raw = this.storage.load();
    if (!raw) return null;
    try {
      const parsed = this.parseSave(raw); // 손상 세이브면 throw → null (부팅 크래시 루프 방지)
      this.activeSlot = null;
      this.updateStatus();
      this.state = parsed;
      this.replayCache.clear();
      this.notify();
      return parsed;
    } catch {
      return null;
    }
  }

  resetGame(): void {
    this.storage.clear();
    this.close();
  }

  exportSave(): string {
    return JSON.stringify(this.require());
  }

  importSave(json: string, slotId?: SaveSlotId): GameSnapshot {
    if (slotId !== undefined) this.assertSlot(slotId);
    const parsed = this.parseSave(json);
    if (slotId !== undefined) this.activeSlot = slotId;
    this.replayCache.clear();
    this.commit(parsed);
    return parsed;
  }

  // ── 세이브 슬롯 (2.0.0) ────────────────────────────────────────

  listSlots(): Promise<SaveSlotMeta[]> {
    return this.slots.listSlots();
  }

  async openSlot(slotId: SaveSlotId): Promise<GameSnapshot> {
    this.assertSlot(slotId);
    await this.writing; // 진행 중 쓰기가 끝난 뒤 읽는다 (실패분은 failedWrites 에 남아 flush 가 재시도)
    const unsaved = this.pendingWrites.get(slotId) ?? this.failedWrites.get(slotId);
    const raw = unsaved ? JSON.stringify(unsaved.s) : await this.readSlot(slotId);
    if (raw === null) throw new GameError('NOT_FOUND', `슬롯 ${slotId} 이 비어 있습니다`);
    const s = this.parseSave(raw);
    this.activeSlot = slotId;
    this.state = s;
    this.replayCache.clear();
    this.updateStatus();
    this.notify();
    return s;
  }

  async deleteSlot(slotId: SaveSlotId): Promise<void> {
    this.assertSlot(slotId);
    const wasOpen = this.activeSlot === slotId;
    this.deleting.add(slotId);
    try {
      this.pendingWrites.delete(slotId);
      this.failedWrites.delete(slotId);
      await this.writing; // 진행 중 쓰기가 삭제 뒤에 슬롯을 되살리지 않도록
      await this.slots.remove(slotId);
    } finally {
      this.deleting.delete(slotId);
    }
    // 통지는 remove 뒤: 리스너가 listSlots() 를 다시 읽을 때 삭제된 슬롯이 보이지 않게
    if (wasOpen && this.activeSlot === slotId) this.close();
    else this.updateStatus();
  }

  async closeSlot(): Promise<void> {
    await this.flush();
    this.close();
  }

  async flush(): Promise<void> {
    for (const [id, w] of this.failedWrites) {
      const newer = this.pendingWrites.get(id);
      if (newer) newer.save ||= w.save;
      else this.pendingWrites.set(id, w);
    }
    this.failedWrites.clear();
    if (this.pendingWrites.size > 0) this.writing ??= this.drain();
    await this.writing;
    if (this.failedWrites.size > 0) throw new GameError('STORAGE_FULL', this.saveStatus.error ?? '저장하지 못했습니다');
  }

  async exportSlot(slotId: SaveSlotId): Promise<string> {
    this.assertSlot(slotId);
    const mem = slotId === this.activeSlot ? this.state : (this.pendingWrites.get(slotId) ?? this.failedWrites.get(slotId))?.s;
    if (mem) return JSON.stringify(mem);
    const raw = await this.readSlot(slotId);
    if (raw === null) throw new GameError('NOT_FOUND', `슬롯 ${slotId} 이 비어 있습니다`);
    return raw;
  }

  getActiveSlot(): SaveSlotId | null {
    return this.activeSlot;
  }

  getSaveStatus(): SaveStatus {
    return this.saveStatus;
  }

  // ── 역할 ───────────────────────────────────────────────────────

  /** 2.5.0: 표시 필드(name·emoji)가 채워진 현재 멤버 */
  getActor(): ClubMember {
    return this.member(this.require());
  }

  /** 1.x 호환: 그 좌석의 첫 멤버로 전환. 구단주 PIN 이 있으면 구단주 전환은 switchMember(id, pin) 로만 */
  switchRole(seat: 'OWNER' | 'COACH'): Membership {
    const s = this.require();
    const m = this.clubMembers(s).find((x) => x.seat === seat);
    if (!m) throw new GameError('NOT_FOUND', `${seat} 멤버십이 없습니다`);
    return this.switchMember(m.userId);
  }

  // ── 로컬 프로필 (2.5.0, 한 기기 핫시트) ─────────────────────────

  listMembers(): ClubMember[] {
    const s = this.require();
    return this.clubMembers(s).map((m) => this.member(s, m));
  }

  hasOwnerPin(): boolean {
    return !!this.require().ownerPin;
  }

  switchMember(memberId: string, pin?: string): ClubMember {
    const s = this.require();
    const m = this.clubMembers(s).find((x) => x.userId === memberId);
    if (!m) throw new GameError('NOT_FOUND', `멤버 없음: ${memberId}`);
    if (m.userId === s.actorUserId) return this.member(s, m);
    if (m.seat === 'OWNER' && s.ownerPin) {
      if (pin === undefined) throw new GameError('PERMISSION_DENIED', '구단주로 바꾸려면 PIN 4자리를 입력하세요', ['PIN_REQUIRED']);
      if (hashPin(pin, s.ownerPin.salt) !== s.ownerPin.hash) throw new GameError('PERMISSION_DENIED', 'PIN 이 맞지 않아요', ['PIN_WRONG']);
    }
    this.commit(this.withLog({ ...s, actorUserId: m.userId }, 'ROLE_SWITCHED', { seat: m.seat, userId: m.userId }));
    return this.member(this.require(), m);
  }

  private ownerManage(s: GameState): void {
    if (this.membership(s).seat !== 'OWNER') throw new GameError('PERMISSION_DENIED', '멤버 관리는 구단주만 할 수 있어요', ['NOT_OWNER']);
  }

  addMember(name: string, role: RoleLabel, extra: { subRole?: RoleLabel; emoji?: string } = {}): ClubMember {
    const s = this.require();
    this.ownerManage(s);
    if (this.clubMembers(s).filter((m) => m.seat !== 'OWNER').length >= MAX_COACHES) throw new GameError('INVALID_MEMBER', `코치는 최대 ${MAX_COACHES}명이에요`);
    const m: Membership = this.run(() => {
      checkRoles(role, extra.subRole);
      const used = new Set(this.clubMembers(s).map((x) => this.member(s, x).emoji));
      return {
        clubId: s.userClubId,
        userId: nextMemberId(s.memberships),
        seat: 'COACH',
        roleLabel: role,
        ...(extra.subRole ? { subRole: extra.subRole } : {}),
        joinedAt: this.ts(s),
        hasOwnClub: false,
        name: cleanName(name),
        emoji: extra.emoji !== undefined ? cleanEmoji(extra.emoji) : (MEMBER_EMOJIS.find((e) => !used.has(e)) ?? MEMBER_EMOJIS[0]),
      };
    });
    this.commit(this.withLog({ ...s, memberships: [...s.memberships, m] }, 'MEMBER_ADDED', { memberId: m.userId, name: m.name, role }));
    return this.member(this.require(), m);
  }

  updateMember(memberId: string, patch: MemberPatch): ClubMember {
    const s = this.require();
    this.ownerManage(s);
    const i = s.memberships.findIndex((x) => x.userId === memberId && x.clubId === s.userClubId);
    if (i < 0) throw new GameError('NOT_FOUND', `멤버 없음: ${memberId}`);
    const cur = s.memberships[i]!;
    const m: Membership = this.run(() => {
      const next: Membership = { ...cur };
      if (patch.name !== undefined) next.name = cleanName(patch.name);
      if (patch.emoji !== undefined) next.emoji = cleanEmoji(patch.emoji);
      if (cur.seat !== 'OWNER') {
        if (patch.role !== undefined) next.roleLabel = patch.role;
        if (patch.subRole === null) delete next.subRole;
        else if (patch.subRole !== undefined) next.subRole = patch.subRole;
        if (next.subRole === next.roleLabel) delete next.subRole; // 보조 역할을 주 역할로 올린 경우
        checkRoles(next.roleLabel, next.subRole);
      }
      return next;
    });
    const memberships = s.memberships.map((x, k) => (k === i ? m : x));
    this.commit(this.withLog({ ...s, memberships }, 'MEMBER_UPDATED', { memberId, ...patch }));
    return this.member(this.require(), m);
  }

  /** 코치 제거. 그 코치의 미결 제안은 EXPIRED (5.0.3 탈퇴: 미결 카드 폐기) */
  removeMember(memberId: string): void {
    const s = this.require();
    this.ownerManage(s);
    const m = this.clubMembers(s).find((x) => x.userId === memberId);
    if (!m) throw new GameError('NOT_FOUND', `멤버 없음: ${memberId}`);
    if (m.seat === 'OWNER') throw new GameError('INVALID_MEMBER', '구단주는 제거할 수 없어요');
    const at = this.ts(s);
    const close = <T extends Proposal | DealProposal>(rec: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(rec).map(([id, p]) => [id, p.authorId === memberId && p.status === 'OPEN' ? { ...p, status: 'EXPIRED', resolvedAt: at, resolutionNote: '작성자가 구단을 떠났어요' } : p]));
    const next: GameState = {
      ...s,
      memberships: s.memberships.filter((x) => x !== m),
      proposals: close(s.proposals),
      ...(s.dealProposals ? { dealProposals: close(s.dealProposals) } : {}),
    };
    this.commit(this.withLog(next, 'MEMBER_REMOVED', { memberId, name: this.member(s, m).name }));
  }

  /** 구단주 PIN 설정(숫자 4자리)·해제(null). 구단주만. 솔트 해시만 저장한다 */
  setOwnerPin(pin: string | null): void {
    const s = this.require();
    this.ownerManage(s);
    const next: GameState = { ...s };
    if (pin === null) delete next.ownerPin;
    else {
      if (!PIN_RE.test(pin)) throw new GameError('INVALID_MEMBER', 'PIN 은 숫자 4자리예요');
      const salt = randomSalt();
      next.ownerPin = { salt, hash: hashPin(pin, salt) };
    }
    this.commit(this.withLog(next, 'OWNER_PIN_SET', { enabled: pin !== null }));
  }

  // ── 조회 ───────────────────────────────────────────────────────

  getCatalog(): Catalog {
    return CATALOG;
  }

  getSquad(clubId?: ClubId): Player[] {
    const s = this.require();
    const club = s.clubs[clubId ?? s.userClubId];
    if (!club) throw new GameError('NOT_FOUND', `구단 없음: ${clubId}`);
    return club.playerIds
      .map((id) => s.players[id])
      .filter((p): p is Player => !!p)
      .sort((a, b) => POSITION_ORDER.indexOf(a.primary) - POSITION_ORDER.indexOf(b.primary) || b.ovr - a.ovr || a.id.localeCompare(b.id));
  }

  getPlayer(playerId: PlayerId): Player {
    const p = marketPlayer(this.require(), playerId); // NPC 매물 선수 포함 (2.2.1)
    if (!p) throw new GameError('NOT_FOUND', `선수 없음: ${playerId}`);
    return p;
  }

  getStandings(leagueId?: LeagueId): StandingRow[] {
    const s = this.require();
    const user = userLeagueOf(s);
    const league = leagueId === undefined ? user : findLeague(s, leagueId);
    if (!league) throw new GameError('NOT_FOUND', `리그 없음: ${leagueId}`);
    if (this.standingsCache?.state !== s) this.standingsCache = { state: s, rows: new Map() };
    const hit = this.standingsCache.rows.get(league.id);
    if (hit) return hit;
    // 사용자 리그 = 엔진 요약(xG 포함), 다른 리그 = 경량 시뮬 스코어(D7). 판정과 같은 함수(타이브레이크 시드·리그별 승강 구역)
    const rows = leagueTable(s, league);
    this.standingsCache.rows.set(league.id, rows);
    return rows;
  }

  getFixtures(filter: FixtureFilter = {}): Fixture[] {
    const s = this.require();
    const user = userLeagueOf(s);
    const leagueId = filter.leagueId ?? user.id;
    // leagueId 없는 일정(스키마 2) = 사용자 리그
    return s.fixtures
      .filter(
        (f) =>
          (f.leagueId ?? user.id) === leagueId &&
          (filter.clubId === undefined || f.homeId === filter.clubId || f.awayId === filter.clubId) &&
          (filter.day === undefined || f.day === filter.day) &&
          (filter.played === undefined || f.played === filter.played),
      )
      .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  }

  getPyramid(): Pyramid {
    const s = this.require();
    if (this.pyramidCache?.state === s) return this.pyramidCache.pyramid;
    const pyramid = buildPyramid(s);
    this.pyramidCache = { state: s, pyramid };
    return pyramid;
  }

  getCareer(): CareerRecord {
    const s = this.require();
    const outcomes = s.pendingOutcome ? [...s.seasonHistory, s.pendingOutcome] : s.seasonHistory;
    const startTier = s.settings.startTier ?? outcomes[0]?.tier ?? s.settings.tier;
    return buildCareer(s.userClubId, outcomes, startTier, s.settings.tier);
  }

  // ── 이적·계약 (2.2.1, M4.4: 도메인 연결. 경제 설계 5·6장) ──────────

  /** 이적·계약 변경은 OWNER 전용 (v1: 코치 제안 없음) */
  private ownerOnly(s: GameState): void {
    if (this.membership(s).seat !== 'OWNER') throw new GameError('PERMISSION_DENIED', '이적·계약은 구단주만 할 수 있어요', ['OWNER_ONLY']);
  }

  private ownPlayer(s: GameState, playerId: PlayerId): Player {
    const p = s.players[playerId];
    if (!p || p.clubId !== s.userClubId) throw new GameError('NOT_FOUND', `우리 구단 선수가 아니에요: ${playerId}`);
    return p;
  }

  private market(s: GameState): TransferMarketState {
    if (!s.transferMarket) throw new GameError('WINDOW_CLOSED', '지금은 이적 창이 닫혀 있어요');
    return s.transferMarket;
  }

  /** 시장 변경 커밋 (게임 사건: seq +1, 행동 로그 m5) */
  private commitMarket(s: GameState, m: TransferMarketState, kind: ActionLogKind, data: Record<string, unknown>): void {
    this.commit(this.withLog({ ...s, transferMarket: m }, kind, data));
  }

  getTransferWindow(): TransferWindow | null {
    return this.require().transferMarket?.window ?? null;
  }

  listTransferListings(filter: TransferListingFilter = {}): TransferListing[] {
    const s = this.require();
    const m = s.transferMarket;
    if (!m) return [];
    return m.listings
      .filter((l) => {
        const p = marketPlayer(s, l.playerId);
        if (!p) return false;
        if (filter.kind !== undefined && l.kind !== filter.kind) return false;
        if (filter.position !== undefined && p.primary !== filter.position) return false;
        if (filter.minOvr !== undefined && p.ovr < filter.minOvr) return false;
        if (filter.maxPrice !== undefined && (l.kind === 'FA' ? 0 : l.minPrice) > filter.maxPrice) return false;
        return true;
      })
      .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
  }

  placeBid(input: BidInput): Bid {
    const s = this.require();
    this.ownerOnly(s);
    const { m, bid } = this.bidFor(s, input);
    this.commitMarket(s, { ...m, bids: upsertBid(m.bids, bid) }, 'BID_PLACED', { ...bid });
    return bid;
  }

  /** 입찰 검증 (placeBid·이적 제안 공용) */
  private bidFor(s: GameState, input: BidInput): { m: TransferMarketState; bid: Bid } {
    const m = this.market(s);
    const listings = listingRecord(m);
    const listing = listings[input.listingId];
    if (!listing) throw new GameError('NOT_FOUND', `매물이 없어요: ${input.listingId}`);
    const club = marketClubs(s).get(s.userClubId)!;
    const bid = this.run(() =>
      validateBid({
        window: m.window,
        listing,
        input,
        club,
        clubBids: m.bids.filter((b) => b.clubId === s.userClubId),
        listings,
        placedDay: s.time.day,
        playerClubId: marketPlayer(s, listing.playerId)?.clubId ?? null,
        squad: clubPlayers(s, s.userClubId),
        player: marketPlayer(s, listing.playerId),
        releasedIds: new Set(s.releasedThisSeason?.[s.userClubId] ?? []),
      }),
    );
    return { m, bid };
  }

  withdrawBid(listingId: string): void {
    const s = this.require();
    this.ownerOnly(s);
    const m = this.market(s);
    const mine = (b: Bid) => b.listingId === listingId && b.clubId === s.userClubId;
    if (!m.bids.some(mine)) throw new GameError('NOT_FOUND', `이 매물에 낸 입찰이 없어요: ${listingId}`);
    this.commitMarket(s, { ...m, bids: m.bids.filter((b) => !mine(b)) }, 'BID_WITHDRAWN', { listingId });
  }

  listBids(): Bid[] {
    const s = this.require();
    return s.transferMarket?.bids.filter((b) => b.clubId === s.userClubId) ?? [];
  }

  listForSale(playerId: PlayerId, minPrice: number): TransferListing {
    const s = this.require();
    this.ownerOnly(s);
    const p = this.ownPlayer(s, playerId);
    const m = this.market(s);
    const listing = this.run(() => clubListing(m.window, withPendingRenewal(s, p), minPrice)); // 성립 재계약은 새 계약으로 (M4.8)
    // 같은 선수 재등록 = 최저가 수정. 새 최저가보다 낮아진 입찰은 무효라 뺀다
    const bids = m.bids.filter((b) => b.listingId !== listing.id || (b.fee ?? 0) >= listing.minPrice);
    this.commitMarket(s, { ...m, listings: [...m.listings.filter((l) => l.id !== listing.id), listing], bids }, 'LISTING_CREATED', { listingId: listing.id, playerId, minPrice });
    return listing;
  }

  withdrawListing(listingId: string): void {
    const s = this.require();
    this.ownerOnly(s);
    const m = this.market(s);
    if (!m.listings.some((l) => l.id === listingId && l.sellerClubId === s.userClubId)) throw new GameError('NOT_FOUND', `우리 구단 매물이 아니에요: ${listingId}`);
    this.commitMarket(s, { ...m, listings: m.listings.filter((l) => l.id !== listingId), bids: m.bids.filter((b) => b.listingId !== listingId) }, 'LISTING_WITHDRAWN', { listingId });
  }

  getPlayerValue(playerId: PlayerId): { value: number; minPrice: number; maxPrice: number } {
    const s = this.require();
    const p = marketPlayer(s, playerId);
    if (!p) throw new GameError('NOT_FOUND', `선수 없음: ${playerId}`);
    const value = playerValue(p, p.clubId === null);
    return { value, minPrice: round1k(TRANSFER.clubMinMult * value), maxPrice: round1k(TRANSFER.maxMult * value) };
  }

  /** 재계약 판단 기준: 다음 시즌 티어 캡(강등이면 110%), 이 선수를 뺀 다음 시즌 캡 사용(성립 재계약 반영, 만료 예정·은퇴 예정 제외) */
  private renewalContext(s: GameState, p: Player) {
    const club = marketClubs(s).get(s.userClubId)!;
    const move = s.pendingOutcome?.movements?.find((x) => x.clubId === s.userClubId);
    const pending = new Map((s.pendingRenewals ?? []).map((r) => [r.playerId, r]));
    const usageWithoutPlayer = capUsage(
      clubPlayers(s, s.userClubId)
        .filter((x) => x.id !== p.id && !x.retiring)
        .flatMap((x): CapChargeInput[] => {
          const r = pending.get(x.id);
          if (r) return [{ ovr: x.ovr, contract: { salary: r.salary, bonusPerSeason: r.bonusPerSeason } }];
          return x.contract.seasonsLeft > 1 ? [x] : [];
        }),
    );
    return {
      tier: club.tier,
      clubMatches: clubMatches(s, s.userClubId),
      season: s.time.season,
      day: s.time.day,
      usageWithoutPlayer,
      capLimit: capLimit(move?.to ?? club.tier, move?.kind === 'RELEGATED'),
    };
  }

  private renewalNotOpen(): never {
    throw new GameError('RENEWAL_NOT_OPEN', '재계약은 계약이 1시즌 남은 선수와 Day 20~27에만 할 수 있어요');
  }

  getRenewalQuote(playerId: PlayerId): RenewalQuote {
    const s = this.require();
    const p = this.ownPlayer(s, playerId);
    if (!renewalOpen(p, s.time.day)) this.renewalNotOpen();
    return renewalQuote(p, this.renewalContext(s, p));
  }

  offerRenewal(playerId: PlayerId, salary: number, seasons: number): RenewalResult {
    const s = this.require();
    this.ownerOnly(s);
    const p = this.ownPlayer(s, playerId);
    if (!renewalOpen(p, s.time.day)) this.renewalNotOpen();
    // M1: 성립한 재계약은 확정(되돌리기·재협상 없음). 다시 받으면 갱신 보너스가 두 번 나간다
    if (s.pendingRenewals?.some((r) => r.playerId === playerId)) throw new GameError('RENEWAL_NOT_OPEN', '이미 재계약이 성립한 선수예요. 새 계약은 다음 시즌부터 적용돼요', ['ALREADY_RENEWED']);
    if (s.finances[s.userClubId]!.balance < 0 && salary > p.contract.salary) {
      throw new GameError('NEGATIVE_BALANCE_LOCK', '잔액이 0 아래인 동안에는 연봉을 올리는 재계약을 할 수 없어요');
    }
    const d = this.run(() => offerRenewalDomain(p, { salary, seasons }, this.renewalContext(s, p)));
    if (!d.accepted) return { accepted: false, ask: d.ask };
    const next: GameState = { ...this.withLog(s, 'RENEWAL_OFFERED', { playerId, salary, seasons, bonus: -(d.ledger?.amount ?? 0) }), finances: { ...s.finances } };
    upsertRenewal(next, d.pending!);
    if (d.ledger) post(next, s.userClubId, { kind: d.ledger.kind, amount: d.ledger.amount, memo: `${p.name} 갱신 보너스 (${seasons}시즌)` });
    this.commit(next);
    return { accepted: true, ask: d.ask };
  }

  getReleaseQuote(playerId: PlayerId): ReleaseQuote {
    const s = this.require();
    const q = releaseQuote(this.ownPlayer(s, playerId), { day: s.time.day, freeReleasesLeft: s.freeReleasesLeft ?? 0 });
    return { playerId: q.playerId, penalty: q.penalty, exempt: q.exempt };
  }

  releasePlayer(playerId: PlayerId): void {
    const s = this.require();
    this.ownerOnly(s);
    const p = this.ownPlayer(s, playerId);
    const r = this.run(() => releasePlayerDomain(p, { season: s.time.season, day: s.time.day, freeReleasesLeft: s.freeReleasesLeft ?? 0 }));
    const next: GameState = { ...this.withLog(s, 'PLAYER_RELEASED', { playerId, penalty: r.penalty }), players: { ...s.players }, clubs: { ...s.clubs }, finances: { ...s.finances } };
    const club = next.clubs[s.userClubId]!;
    next.clubs[s.userClubId] = { ...club, playerIds: club.playerIds.filter((id) => id !== p.id) };
    if (r.player) {
      next.players[p.id] = r.player;
      next.releasedThisSeason = { ...s.releasedThisSeason, [s.userClubId]: [...(s.releasedThisSeason?.[s.userClubId] ?? []), p.id] };
    } else delete next.players[p.id];
    if (r.freeReleasesLeft > 0) next.freeReleasesLeft = r.freeReleasesLeft;
    else delete next.freeReleasesLeft;
    dropFromMarket(next, new Set([p.id]));
    if (r.ledger) {
      post(next, s.userClubId, { kind: 'RELEASE_PENALTY', amount: r.ledger.amount, memo: `${p.name} 방출 위약금` });
      // 강등 시즌이면 연봉 전용 계정에서 먼저 (경제 5.3)
      const f = next.finances[s.userClubId]!;
      const cover = Math.min(f.parachute ?? 0, r.penalty);
      if (cover > 0) {
        next.finances[s.userClubId] = { ...f, parachute: f.parachute! - cover };
        post(next, s.userClubId, { kind: 'PARACHUTE', amount: cover, memo: '강등 연봉 전용 계정 (방출 위약금)' });
      }
    }
    mailContract(next, [r.event]);
    fillHumanSquads(next);
    this.commit(next);
  }

  // ── 훈련·유스 (2.3.0, M5.1) ────────────────────────────────────

  setTrainingFocus(focus: TrainingFocus): GameSnapshot {
    const s = this.require();
    this.ownerOnly(s);
    if (!TRAINING_FOCI.includes(focus)) throw new GameError('INVALID_TACTIC', `알 수 없는 훈련 포커스: ${String(focus)}`);
    const club = s.clubs[s.userClubId]!;
    const current = trainingFocusOf(club);
    const training = focus === current ? { focus: current } : { focus: current, next: focus };
    const next = this.withLog({ ...s, clubs: { ...s.clubs, [club.id]: { ...club, training } } }, 'TRAINING_FOCUS_SET', { focus });
    this.commit(next);
    return next;
  }

  getYouthIntake(): YouthIntake | null {
    const intake = this.require().youthIntake;
    if (!intake) return null;
    // potential 비노출 원칙: 숨김 값은 ovr 로 가린다
    return { ...intake, candidates: intake.candidates.map((c) => ({ ...c, potential: c.ovr })) };
  }

  decideYouth(promoteIds: readonly PlayerId[]): GameSnapshot {
    const s = this.require();
    this.ownerOnly(s);
    const next: GameState = { ...s, players: { ...s.players }, clubs: { ...s.clubs } };
    const events = this.run(() => decideYouthState(next, promoteIds, false));
    const promoted = events.flatMap((e) => (e.kind === 'YOUTH_PROMOTED' ? [e.playerId] : []));
    const logged = this.withLog(next, 'YOUTH_DECIDED', { promoted });
    this.commit(logged);
    return logged;
  }

  // ── 받은 편지함 (2.2.0) ─────────────────────────────────────────

  getInbox(filter: { unreadOnly?: boolean } = {}): InboxMessage[] {
    const s = this.require();
    const unread = filter.unreadOnly === true;
    const c = this.inboxCache;
    if (c && c.state === s && c.unread === unread) return c.list;
    const list = (s.inbox ?? []).filter((m) => !unread || !m.read).reverse();
    this.inboxCache = { state: s, unread, list };
    return list;
  }

  markRead(ids?: readonly string[]): void {
    const s = this.require();
    const want = ids ? new Set(ids) : null;
    let changed = false;
    const inbox = (s.inbox ?? []).map((m) => {
      if (m.read || (want && !want.has(m.id))) return m;
      changed = true;
      return { ...m, read: true };
    });
    if (changed) this.commit({ ...s, inbox }); // 읽음은 게임 사건이 아니라 seq·행동 로그를 건드리지 않는다
  }

  getNextMatch(): Fixture | null {
    return this.nextFixture(this.require());
  }

  getOpponentScout(clubId: ClubId): OpponentScout {
    const s = this.require();
    if (!s.clubs[clubId]) throw new GameError('NOT_FOUND', `구단 없음: ${clubId}`);
    return buildOpponentScout(s.clubs, Object.values(s.summaries), clubId);
  }

  getFinance(clubId?: ClubId): FinanceSummary {
    const s = this.require();
    const id = clubId ?? s.userClubId;
    const f = s.finances[id];
    if (!f) throw new GameError('NOT_FOUND', `재정 없음: ${id}`);
    const tier = clubTierMap(s).get(id) ?? s.settings.tier;
    const econ = TIER_ECONOMY[tier];
    const total = salaryTotal(s, id);
    // 2.2.1: B = 경제 7.2(창이 열린 정규 오프시즌은 B_off) − 입찰 예약액
    const m = s.transferMarket;
    const reserved = m ? reservedTotal(m.window, id, m.bids, listingRecord(m)) : 0;
    const club = marketClubs(s).get(id);
    const projected = spendable(f.balance, total, Math.max(0, 28 - s.time.day));
    const B = (club?.budget ?? projected) - reserved;
    const season = f.ledger.filter((e) => e.season === s.time.season);
    const income = season.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
    const expense = season.filter((e) => e.amount < 0).reduce((a, e) => a - e.amount, 0);
    return {
      clubId: id,
      tier,
      balance: f.balance,
      transferOnlyBudget: f.transferOnlyBudget,
      spendable: B,
      reserved,
      salaryTotal: total,
      salaryCap: econ.salaryCap,
      capUsage: econ.salaryCap > 0 ? total / econ.salaryCap : 0,
      seasonIncome: income,
      seasonExpense: expense,
      projectedCarry: carryOver({ ...f, balance: projected }, econ),
      recent: f.ledger.slice(-12).reverse(),
    };
  }

  // ── 전술·플랜 ──────────────────────────────────────────────────

  updateTacticSlot(slot: SlotKey, next: TacticSlotInput): TacticUpdateResult {
    const s = this.require();
    this.guard(s, 'EDIT_TACTIC');
    if (slot !== 'A' && slot !== 'B') throw new GameError('INVALID_TACTIC', `슬롯은 A 또는 B: ${String(slot)}`);
    const issues = tacticIssues(next.formation, next.roles, next.instructions);
    if (issues.length > 0) throw new GameError('INVALID_TACTIC', issues[0]!, issues);
    const club = s.clubs[s.userClubId]!;
    const prev = club.tactics[slot];
    const halved = prev.formation !== next.formation;
    const familiarity = halved ? Math.round(prev.familiarity * EngineConstants.FAMILIARITY.formationChangeMult) : prev.familiarity;
    const updated = { key: slot, formation: next.formation, roles: [...next.roles], instructions: { ...next.instructions }, familiarity };
    const nextState = this.withLog(
      { ...s, clubs: { ...s.clubs, [club.id]: { ...club, tactics: { ...club.tactics, [slot]: updated } } } },
      'TACTIC_CHANGED',
      { slot, formation: next.formation, familiarityHalved: halved },
    );
    this.commit(nextState);
    return { slot: updated, familiarityHalved: halved };
  }

  getPlanState(): PlanState {
    const s = this.require();
    this.guard(s, 'VIEW_TODAY_PLAN');
    const f = this.nextFixture(s);
    const ps = s.plans[s.userClubId];
    const club = s.clubs[s.userClubId]!;
    return {
      clubId: s.userClubId,
      matchId: f?.id ?? null,
      opponentId: f ? this.opponentOf(s, f) : null,
      day: s.time.day,
      ...(ps?.draft ? { draft: ps.draft } : {}),
      ...(ps?.confirmed ? { confirmed: ps.confirmed } : {}),
      ...(club.defaultPlan ? { defaultPlan: club.defaultPlan } : {}),
      preview: this.preview(s),
    };
  }

  validatePlan(plan: MatchPlan): PlanValidationIssue[] {
    const s = this.require();
    return validatePlanDomain(this.normalizePlan(s, plan), s.clubs[s.userClubId]!, s.players);
  }

  saveDraft(plan: MatchPlan): PlanRecord {
    const s = this.require();
    this.guard(s, 'EDIT_PLAN');
    if (plan.clubId && plan.clubId !== s.userClubId) throw new GameError('INVALID_PLAN', '다른 구단의 플랜입니다');
    const record: PlanRecord = { plan: this.normalizePlan(s, plan), status: 'DRAFT', updatedBy: s.actorUserId, updatedAt: this.ts(s) };
    const cur = s.plans[s.userClubId] ?? {};
    this.commit(this.withLog({ ...s, plans: { ...s.plans, [s.userClubId]: { ...cur, draft: record } } }, 'PLAN_DRAFT_SAVED', { matchId: record.plan.matchId }));
    return record;
  }

  submitPlan(plan: MatchPlan, opts: SubmitPlanOptions = {}): PlanRecord {
    const s = this.require();
    this.guard(s, 'SUBMIT_PLAN');
    const f = this.nextFixture(s);
    if (!f) throw new GameError('INVALID_PHASE', '제출할 다음 경기가 없습니다');
    const p = this.normalizePlan(s, plan);
    this.assertValid(s, p);
    const isRecommended = opts.origin === 'RECOMMENDED';
    const record: PlanRecord = { plan: p, status: 'CONFIRMED', updatedBy: s.actorUserId, updatedAt: this.ts(s) };
    const cur = s.plans[s.userClubId] ?? {};
    this.commit(
      this.withLog(
        { ...s, plans: { ...s.plans, [s.userClubId]: { ...cur, confirmed: record } } },
        isRecommended ? 'PLAN_RECOMMENDED_SUBMITTED' : 'PLAN_SUBMITTED',
        { matchId: f.id, startSlot: p.startSlot },
      ),
    );
    return record;
  }

  remapLineup(plan: MatchPlan, slot: SlotKey): MatchPlan {
    const s = this.require();
    if (slot !== 'A' && slot !== 'B') throw new GameError('INVALID_PLAN', `슬롯은 A 또는 B: ${String(slot)}`);
    return remapLineupDomain(this.normalizePlan(s, plan), s.clubs[s.userClubId]!, s.players, slot);
  }

  setDefaultPlan(plan: MatchPlan): void {
    const s = this.require();
    this.guard(s, 'SET_DEFAULT_PLAN');
    const p = { ...stripOpponentOrders(this.normalizePlan(s, plan)), matchId: null };
    this.assertValid(s, p);
    const club = s.clubs[s.userClubId]!;
    this.commit(this.withLog({ ...s, clubs: { ...s.clubs, [club.id]: { ...club, defaultPlan: p } } }, 'DEFAULT_PLAN_SET'));
  }

  private recommendFor(s: GameState): MatchPlan {
    const r = this.preview(s);
    if (!r) throw new GameError('INVALID_PHASE', '다음 경기가 없습니다');
    return stripOpponentOrders(r.plan);
  }

  applyStyle(slot: SlotKey, styleId: StyleId, mode: StyleApplyMode): StyleApplyResult {
    const s = this.require();
    const d = STYLES[styleId];
    if (!d) throw new GameError('INVALID_TACTIC', `알 수 없는 스타일: ${String(styleId)}`);
    if (mode !== 'INSTRUCTIONS_ONLY' && mode !== 'FULL') throw new GameError('INVALID_TACTIC', `적용 방식은 INSTRUCTIONS_ONLY 또는 FULL: ${String(mode)}`);
    const cur = s.clubs[s.userClubId]!.tactics[slot];
    if (!cur) throw new GameError('INVALID_TACTIC', `슬롯은 A 또는 B: ${String(slot)}`);
    const next =
      mode === 'FULL'
        ? { formation: d.formation, roles: [...d.roles], instructions: { ...d.instructions } }
        : { formation: cur.formation, roles: [...cur.roles], instructions: { ...d.instructions } };
    const r = this.updateTacticSlot(slot, next);
    return {
      ...r,
      styleId,
      mode,
      ...(r.familiarityHalved ? { warning: `포메이션이 ${cur.formation} → ${d.formation} 로 바뀌어 전술 숙련도가 절반(${r.slot.familiarity})이 되었습니다. 숙련도가 낮으면 전술 이득이 줄어듭니다` } : {}),
    };
  }

  getStyleFits(): StyleFit[] {
    const s = this.require();
    const club = s.clubs[s.userClubId]!;
    return STYLE_IDS.map((id) => {
      const d = STYLES[id];
      const tactic: TacticSlot = { key: 'A', formation: d.formation, roles: [...d.roles], instructions: { ...d.instructions }, familiarity: 100 };
      const lineup = pickLineup({ club, players: s.players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng: mulberry32(1) }, tactic);
      return styleFitOf(id, lineup.starters.map((pid) => (s.players[pid] ? toEnginePlayer(s.players[pid]) : undefined)));
    });
  }

  getMatchupPreview(ourSlot: SlotKey, opponentId: ClubId): MatchupPreview {
    const s = this.require();
    const club = s.clubs[s.userClubId]!;
    const opp = s.clubs[opponentId];
    if (!opp) throw new GameError('NOT_FOUND', `구단 없음: ${opponentId}`);
    const ours = club.tactics[ourSlot];
    if (!ours) throw new GameError('INVALID_TACTIC', `슬롯은 A 또는 B: ${String(ourSlot)}`);
    const summaries = Object.values(s.summaries);
    const last = lastTacticOf(s.clubs, summaries, opponentId);
    const bot = botStyleOf(opp);
    // 상대 전술: 최근 경기 포메이션·지시 (역할은 같은 포메이션의 구단 슬롯, 없으면 기본), 기록이 없으면 슬롯 A
    const base = opp.tactics.A;
    const formation = last?.formation ?? base.formation;
    const roles = last?.roles ?? (opp.tactics.A.formation === formation ? opp.tactics.A.roles : opp.tactics.B.formation === formation ? opp.tactics.B.roles : undefined);
    const theirs: TacticSlot = { key: 'A', formation, roles: roles ? [...roles] : defaultRoles(formation), instructions: { ...(last?.instructions ?? base.instructions) }, familiarity: 100 };
    const lineupOf = (c: typeof club, t: TacticSlot) =>
      pickLineup({ club: c, players: s.players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng: mulberry32(1) }, t).starters.map((pid) => (s.players[pid] ? toEnginePlayer(s.players[pid]) : undefined));
    const usView = staticView(club.id, ours, lineupOf(club, ours));
    const themView = staticView(opp.id, theirs, lineupOf(opp, theirs));
    const r = matchupPreview(usView, themView);
    const style: StyleId | undefined = bot ?? (last ? nearestStyle(last.instructions).id : undefined);
    return { ourSlot, opponentId, ...(style ? { opponentStyle: style } : {}), opponentStyleEstimated: !bot, rules: r.rules, styleEdge: r.styleEdge };
  }

  recommendPlan(): MatchPlan {
    const s = this.require();
    return this.run(() => this.recommendFor(s));
  }

  previewResolvedPlan(): ResolvedPlan | null {
    const s = this.require();
    return this.run(() => this.preview(s));
  }

  // ── 진행 ───────────────────────────────────────────────────────

  private step(s: GameState): { state: GameState; result: DayResult } {
    const out = this.run(() => advanceDayState(s, this.clock.nowIso()));
    const state = {
      ...out.state,
      actionLog: [...out.state.actionLog, this.entry(out.state, 'DAY_ADVANCED', { from: out.result.from, to: out.result.to, userMatchId: out.result.userMatchId ?? null })],
    };
    this.expireDeals(state);
    return { state, result: out.result };
  }

  /** 2.5.0: 이적·재계약 제안 24시간 만료 (expiresAt 날 처리가 끝나면) */
  private expireDeals(state: GameState): void {
    if (!state.dealProposals) return;
    const t = state.time;
    let deals: Record<ProposalId, DealProposal> | null = null;
    for (const d of Object.values(state.dealProposals)) {
      if (d.status !== 'OPEN' || d.expiresAt.season > t.season || (d.expiresAt.season === t.season && d.expiresAt.day > t.day && state.phase !== 'SEASON_OVER')) continue;
      deals ??= { ...state.dealProposals };
      deals[d.id] = { ...d, status: 'EXPIRED', resolvedAt: { season: t.season, day: t.day, seq: state.seq } };
      state.actionLog = [...state.actionLog, this.entry(state, 'PROPOSAL_EXPIRED', { proposalId: d.id }, SYSTEM_ACTOR)];
    }
    if (deals) state.dealProposals = deals;
  }

  advanceDay(): DayResult {
    const s = this.require();
    this.guard(s, 'ADVANCE_DAY');
    if (s.phase === 'SEASON_OVER') throw new GameError('INVALID_PHASE', '시즌이 끝났습니다. 새 시즌을 시작하세요');
    const { state, result } = this.step(s);
    this.commit(state);
    return result;
  }

  advanceDays(n: number): DayResult[] {
    const s0 = this.require();
    this.guard(s0, 'ADVANCE_DAY');
    if (s0.phase === 'SEASON_OVER') throw new GameError('INVALID_PHASE', '시즌이 끝났습니다. 새 시즌을 시작하세요');
    let s = s0;
    const results: DayResult[] = [];
    for (let i = 0; i < Math.max(0, Math.floor(n)) && s.phase !== 'SEASON_OVER'; i++) {
      const out = this.step(s);
      s = out.state;
      results.push(out.result);
    }
    if (results.length > 0) this.commit(s);
    return results;
  }

  advanceToSeasonEnd(): DayResult[] {
    return this.advanceDays(10_000);
  }

  startNewSeason(): GameSnapshot {
    const s = this.require();
    this.guard(s, 'ADVANCE_DAY');
    const next = this.run(() => startNewSeasonState(s, this.clock.nowIso()));
    const logged = { ...next, actionLog: [...next.actionLog, this.entry(next, 'SEASON_STARTED', { season: next.time.season })] };
    this.replayCache.clear();
    this.commit(logged);
    return logged;
  }

  getSeasonOutcome(season?: SeasonNo): SeasonOutcome | null {
    const s = this.require();
    if (season === undefined) return s.pendingOutcome ?? s.seasonHistory[s.seasonHistory.length - 1] ?? null;
    if (s.pendingOutcome?.season === season) return s.pendingOutcome;
    return s.seasonHistory.find((o) => o.season === season) ?? null;
  }

  // ── 리포트 ─────────────────────────────────────────────────────

  private record(s: GameState, matchId: MatchId): StoredMatchRecord {
    const r = s.records[matchId];
    if (!r) throw new GameError('NOT_FOUND', `리포트가 없습니다 (사용자 구단 경기만 저장): ${matchId}`);
    return r;
  }

  getReport(matchId: MatchId): MatchReport {
    return this.record(this.require(), matchId).report;
  }

  getMatchReplay(matchId: MatchId): MatchReplay {
    const s = this.require();
    const rec = this.record(s, matchId);
    const cached = this.replayCache.get(matchId);
    if (cached) return cached;
    if (rec.engineVersion !== ENGINE_VERSION) {
      throw new GameError('SAVE_INCOMPATIBLE', `엔진 버전이 달라(${rec.engineVersion} → ${ENGINE_VERSION}) 중계를 재생할 수 없습니다. 저장된 리포트만 볼 수 있습니다`);
    }
    const result = simulateMatch({
      matchId,
      seed: rec.seed,
      home: rec.home,
      away: rec.away,
      config: { engineVersion: rec.engineVersion, tacCap: rec.tacCap, tacticsEnabled: true, disabledRules: [] },
    });
    const players: Record<string, string> = {};
    for (const t of [rec.home, rec.away]) for (const p of [...t.starters, ...t.bench]) players[p.id] = p.name;
    const clubs: Record<string, string> = { [rec.home.clubId]: rec.home.name, [rec.away.clubId]: rec.away.name };
    const replay: MatchReplay = {
      ...buildReplay(result, { clubs, players }),
      starters: { home: rec.home.starters.map((p) => p.id), away: rec.away.starters.map((p) => p.id) },
    };
    this.replayCache.set(matchId, replay);
    return replay;
  }

  // ── 코치 제안 ──────────────────────────────────────────────────

  private bundle(s: GameState): PlanBundle {
    const club = s.clubs[s.userClubId]!;
    const preview = this.preview(s);
    const fallback: MatchPlan = preview?.plan ?? { clubId: club.id, matchId: null, lineup: { starters: [], bench: [] }, startSlot: 'A', conditionals: [], autoSubThreshold: 55, autoRotation: true };
    return { plan: pickBasePlan(s.plans[club.id], fallback), tactics: club.tactics };
  }

  /** PROPOSE 권한 + 역할 영역 + 코치 1인당 미결 5장(플랜·이적·재계약 합산, 5.0.2) */
  private proposer(s: GameState, kind: ProposalKind): ClubMember {
    const author = this.member(s);
    this.deny(checkProposeKind(author, kind, { now: s.time, pastDeadline: false, clubId: s.userClubId }));
    const open = [...Object.values(s.proposals), ...Object.values(s.dealProposals ?? {})].filter((p) => p.status === 'OPEN' && p.authorId === author.userId);
    if (open.length >= MAX_OPEN_PER_COACH) throw new GameError('PROPOSAL_LIMIT', `미결 제안은 코치 1인당 ${MAX_OPEN_PER_COACH}장까지예요`);
    return author;
  }

  propose(input: ProposalInput): Proposal {
    const s = this.require();
    const author = this.proposer(s, 'PLAN_CHANGE');
    const f = this.nextFixture(s);
    if (!f || input.payload.matchId !== f.id) throw new GameError('PROPOSAL_INVALID', '다음 경기에 대한 제안만 할 수 있습니다');
    const id = `pr-s${s.time.season}-${s.seq + 1}`;
    const proposal = this.run(() => createProposal(input, author, Object.values(s.proposals), this.bundle(s), this.ts(s), id, (pid) => s.players[pid]?.name ?? pid));
    this.commit(this.withLog({ ...s, proposals: { ...s.proposals, [id]: proposal } }, 'PROPOSAL_CREATED', { proposalId: id, paths: proposal.diff.map((d) => d.path) }));
    return proposal;
  }

  private openProposal(s: GameState, id: ProposalId): Proposal {
    const p = s.proposals[id];
    if (!p) throw new GameError('NOT_FOUND', `제안 없음: ${id}`);
    if (p.status !== 'OPEN') throw new GameError('PROPOSAL_NOT_OPEN', `이미 처리된 제안입니다 (${p.status})`);
    return p;
  }

  react(proposalId: ProposalId, choice: 'FOR' | 'AGAINST', reason?: string): Proposal {
    const s = this.require();
    this.guard(s, 'REACT');
    const p = this.openProposal(s, proposalId);
    const next: Proposal = { ...p, reactions: this.reactions(s, p.reactions, choice, reason) };
    this.commit(this.withLog({ ...s, proposals: { ...s.proposals, [p.id]: next } }, 'PROPOSAL_REACTED', { proposalId: p.id, choice }));
    return next;
  }

  approve(proposalId: ProposalId, edits?: PlanChangePatch): ApproveResult {
    const s = this.require();
    this.guard(s, 'APPROVE');
    const p = this.openProposal(s, proposalId);
    const at = this.ts(s);
    const f = this.nextFixture(s);
    const details: string[] = [];
    let after: PlanBundle | null = null;
    if (!f || f.id !== p.payload.matchId) {
      details.push('대상 경기가 이미 지났거나 다음 경기가 아닙니다');
    } else {
      after = this.run(() => applyPatch(this.bundle(s), edits ?? p.payload.patch));
      after.plan = { ...after.plan, clubId: s.userClubId, matchId: f.id };
      const issues = validatePlanDomain(after.plan, s.clubs[s.userClubId]!, s.players);
      for (const i of issues) if (i.severity === 'ERROR') details.push(i.message);
      const lineup = (edits ?? p.payload.patch).lineup;
      if (lineup) {
        for (const id of [...lineup.starters, ...lineup.bench]) {
          const pl = s.players[id];
          if (pl && !isAvailable(pl)) details.push(`${pl.name} ${pl.availability.injuryDays > 0 ? '부상' : '출장 정지'} — 다시 확인이 필요합니다`);
        }
      }
      for (const slot of ['A', 'B'] as SlotKey[]) {
        const t = after.tactics[slot];
        details.push(...tacticIssues(t.formation, t.roles, t.instructions));
      }
    }
    if (details.length > 0 || !after || !f) {
      const stale: Proposal = { ...p, status: 'STALE', resolvedBy: s.actorUserId, resolvedAt: at, resolutionNote: details.join(' / ') };
      this.commit(this.withLog({ ...s, proposals: { ...s.proposals, [p.id]: stale } }, 'PROPOSAL_APPROVED', { proposalId: p.id, result: 'STALE', details }));
      return { ok: false, proposal: stale, reason: 'STALE', details };
    }
    const approved: Proposal = {
      ...p,
      status: 'APPROVED',
      resolvedBy: s.actorUserId,
      resolvedAt: at,
      ...(edits ? { resolutionNote: '수정 후 승인' } : {}),
    };
    const proposals = { ...s.proposals, [p.id]: approved };
    const superseded = findConflicting(p, Object.values(s.proposals)).map((c) => c.id);
    for (const id of superseded) proposals[id] = { ...proposals[id]!, status: 'SUPERSEDED', supersededBy: p.id, resolvedAt: at, resolvedBy: s.actorUserId };
    const club = s.clubs[s.userClubId]!;
    const tactics = { ...club.tactics };
    for (const k of ['A', 'B'] as SlotKey[]) tactics[k] = { ...club.tactics[k], instructions: { ...after.tactics[k].instructions } };
    const record: PlanRecord = { plan: after.plan, status: 'CONFIRMED', updatedBy: OWNER_ID, updatedAt: at, sourceProposalId: p.id };
    const cur = s.plans[club.id] ?? {};
    const next: GameState = {
      ...s,
      proposals,
      clubs: { ...s.clubs, [club.id]: { ...club, tactics } },
      plans: { ...s.plans, [club.id]: { ...cur, confirmed: record } },
    };
    this.commit(this.withLog(next, 'PROPOSAL_APPROVED', { proposalId: p.id, edited: !!edits, superseded }));
    return { ok: true, proposal: approved, superseded };
  }

  reject(proposalId: ProposalId, note?: string): Proposal {
    const s = this.require();
    this.guard(s, 'REJECT');
    const p = this.openProposal(s, proposalId);
    const next: Proposal = { ...p, status: 'REJECTED', resolvedBy: s.actorUserId, resolvedAt: this.ts(s), ...(note ? { resolutionNote: note.slice(0, 80) } : {}) };
    this.commit(this.withLog({ ...s, proposals: { ...s.proposals, [p.id]: next } }, 'PROPOSAL_REJECTED', { proposalId: p.id }));
    return next;
  }

  private reactions(s: GameState, cur: readonly ProposalReaction[], choice: 'FOR' | 'AGAINST', reason?: string): ProposalReaction[] {
    return [...cur.filter((r) => r.userId !== s.actorUserId), { userId: s.actorUserId, choice, ...(reason ? { reason: reason.slice(0, 80) } : {}), name: this.member(s).name }];
  }

  // ── 이적·재계약 제안 (2.5.0) ───────────────────────────────────

  /** 재계약 제안·실행 전 공통 검사 (offerRenewal 과 같은 순서) */
  private renewalTarget(s: GameState, playerId: PlayerId): Player {
    const p = this.ownPlayer(s, playerId);
    if (!renewalOpen(p, s.time.day)) this.renewalNotOpen();
    if (s.pendingRenewals?.some((r) => r.playerId === playerId)) throw new GameError('RENEWAL_NOT_OPEN', '이미 재계약이 성립한 선수예요', ['ALREADY_RENEWED']);
    return p;
  }

  /** 코치가 이적 입찰·재계약을 제안한다. 역할 영역: TRANSFER_BID = SCT·FIN, RENEWAL = SQD·FIN. 만료 = 다음 날 처리(24시간) */
  proposeDeal(input: DealProposalInput): DealProposal {
    const s = this.require();
    const pl = input?.payload;
    if (!pl || (pl.kind !== 'TRANSFER_BID' && pl.kind !== 'RENEWAL')) throw new GameError('PROPOSAL_INVALID', '알 수 없는 제안 종류예요');
    const author = this.proposer(s, pl.kind);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 1 || reason.length > MAX_REASON_LENGTH) throw new GameError('PROPOSAL_INVALID', `제안 사유는 1~${MAX_REASON_LENGTH}자여야 해요`);
    let payload: DealPayload;
    let summary: string;
    if (pl.kind === 'TRANSFER_BID') {
      const { bid } = this.bidFor(s, pl.bid); // 지금 기준으로 유효한 입찰만 (승인 때 다시 검증)
      const listing = listingRecord(this.market(s))[bid.listingId]!;
      const name = marketPlayer(s, listing.playerId)?.name ?? listing.playerId;
      payload = { kind: 'TRANSFER_BID', bid: { listingId: bid.listingId, ...(bid.fee !== undefined ? { fee: bid.fee } : {}), ...(bid.bonus !== undefined ? { bonus: bid.bonus } : {}), ...(bid.salary !== undefined ? { salary: bid.salary } : {}), ...(bid.seasons !== undefined ? { seasons: bid.seasons } : {}) } };
      summary = bid.fee !== undefined ? `${name} 영입 입찰 · 이적료 ${bid.fee.toLocaleString('ko-KR')} KC` : `${name} FA 영입 · 연봉 ${(bid.salary ?? 0).toLocaleString('ko-KR')} KC × ${bid.seasons ?? 1}시즌`;
    } else {
      if (!Number.isInteger(pl.salary) || pl.salary < 1 || !Number.isInteger(pl.seasons) || pl.seasons < 1 || pl.seasons > 4) throw new GameError('PROPOSAL_INVALID', '연봉·계약 시즌이 올바르지 않아요');
      const p = this.renewalTarget(s, pl.playerId);
      payload = { kind: 'RENEWAL', playerId: p.id, salary: pl.salary, seasons: pl.seasons };
      summary = `${p.name} 재계약 · 연봉 ${pl.salary.toLocaleString('ko-KR')} KC × ${pl.seasons}시즌`;
    }
    const dup = Object.values(s.dealProposals ?? {}).find((d) => d.status === 'OPEN' && d.authorId === author.userId && d.kind === pl.kind && dealTarget(d.payload) === dealTarget(payload));
    if (dup) throw new GameError('PROPOSAL_DUPLICATE', '같은 대상의 미결 제안이 이미 있어요', [dup.id]);
    const id = `dp-s${s.time.season}-${s.seq + 1}`;
    const at = this.ts(s);
    const deal: DealProposal = {
      id,
      clubId: s.userClubId,
      authorId: author.userId,
      ...(author.roleLabel ? { authorRole: author.roleLabel } : {}),
      authorName: author.name,
      authorEmoji: author.emoji,
      kind: pl.kind,
      payload,
      summary,
      reason,
      reactions: [],
      createdAt: at,
      expiresAt: { season: s.time.season, day: s.time.day + 1 },
      status: 'OPEN',
    };
    this.commit(this.withLog({ ...s, dealProposals: { ...s.dealProposals, [id]: deal } }, 'PROPOSAL_CREATED', { proposalId: id, kind: pl.kind }));
    return deal;
  }

  private openDeal(s: GameState, id: ProposalId): DealProposal {
    const d = s.dealProposals?.[id];
    if (!d) throw new GameError('NOT_FOUND', `제안 없음: ${id}`);
    if (d.status !== 'OPEN') throw new GameError('PROPOSAL_NOT_OPEN', `이미 처리된 제안입니다 (${d.status})`);
    return d;
  }

  private putDeal(s: GameState, d: DealProposal, kind: ActionLogKind, data: Record<string, unknown>): void {
    this.commit(this.withLog({ ...s, dealProposals: { ...s.dealProposals, [d.id]: d } }, kind, { proposalId: d.id, ...data }));
  }

  reactDeal(proposalId: ProposalId, choice: 'FOR' | 'AGAINST', reason?: string): DealProposal {
    const s = this.require();
    this.guard(s, 'REACT');
    const d = this.openDeal(s, proposalId);
    const next: DealProposal = { ...d, reactions: this.reactions(s, d.reactions, choice, reason) };
    this.putDeal(s, next, 'PROPOSAL_REACTED', { choice });
    return next;
  }

  /** OWNER 전용. 구단주 명의로 placeBid / offerRenewal 실행. 실패(창 닫힘·잔액·선수가 거절)면 STALE */
  approveDeal(proposalId: ProposalId): DealApproveResult {
    const s = this.require();
    this.guard(s, 'APPROVE');
    const d = this.openDeal(s, proposalId);
    const details: string[] = [];
    try {
      if (d.payload.kind === 'TRANSFER_BID') this.placeBid(d.payload.bid);
      else {
        this.renewalTarget(s, d.payload.playerId);
        const r = this.offerRenewal(d.payload.playerId, d.payload.salary, d.payload.seasons);
        if (!r.accepted) details.push(`선수가 연봉 ${r.ask.toLocaleString('ko-KR')} KC 이상을 원해요`);
      }
    } catch (e) {
      details.push(e instanceof Error ? e.message : String(e));
    }
    const s2 = this.require(); // 실행이 커밋했으면 그 상태 위에 기록
    const base = { resolvedBy: s.actorUserId, resolvedAt: this.ts(s2) };
    if (details.length > 0) {
      const stale: DealProposal = { ...d, ...base, status: 'STALE', resolutionNote: details.join(' / ').slice(0, 200) };
      this.putDeal(s2, stale, 'PROPOSAL_APPROVED', { result: 'STALE', details });
      return { ok: false, proposal: stale, reason: 'STALE', details };
    }
    const approved: DealProposal = { ...d, ...base, status: 'APPROVED' };
    this.putDeal(s2, approved, 'PROPOSAL_APPROVED', { kind: d.kind });
    return { ok: true, proposal: approved };
  }

  rejectDeal(proposalId: ProposalId, note?: string): DealProposal {
    const s = this.require();
    this.guard(s, 'REJECT');
    const d = this.openDeal(s, proposalId);
    const next: DealProposal = { ...d, status: 'REJECTED', resolvedBy: s.actorUserId, resolvedAt: this.ts(s), ...(note ? { resolutionNote: note.slice(0, 80) } : {}) };
    this.putDeal(s, next, 'PROPOSAL_REJECTED', {});
    return next;
  }

  listDealProposals(filter: { status?: ProposalStatus } = {}): DealProposal[] {
    const s = this.require();
    return Object.values(s.dealProposals ?? {})
      .filter((p) => filter.status === undefined || p.status === filter.status)
      .sort((a, b) => b.createdAt.season - a.createdAt.season || b.createdAt.seq - a.createdAt.seq);
  }

  listProposals(filter: { status?: ProposalStatus } = {}): Proposal[] {
    const s = this.require();
    return Object.values(s.proposals)
      .filter((p) => filter.status === undefined || p.status === filter.status)
      .sort((a, b) => b.createdAt.season - a.createdAt.season || b.createdAt.seq - a.createdAt.seq);
  }

  // ── 로그 ───────────────────────────────────────────────────────

  logEvent(kind: UiLogKind, data?: Record<string, unknown>): void {
    const s = this.state;
    if (!s) return;
    // 계약 1.1.0: 스냅샷 교체·구독자 알림 없이 로그만 추가하고 저장한다 (UI 재렌더 방지)
    let log = [...s.actionLog, this.entry(s, kind, data)];
    if (log.length > ACTION_LOG_LIMIT) log = log.slice(-ACTION_LOG_LIMIT);
    (s as GameState).actionLog = log;
    if (this.activeSlot !== null) {
      this.scheduleWrite(false); // 로그 저장소에만 쓴다 (세이브 재직렬화 없음)
      return;
    }
    try {
      this.storage.save(JSON.stringify(s));
    } catch {
      // 로그 저장 실패는 게임 진행을 막지 않는다
    }
  }

  exportActionLog(): string {
    return JSON.stringify(this.require().actionLog, null, 2);
  }

  // ── 개발자 패널 ────────────────────────────────────────────────

  setTacCap(cap: TacticCap): void {
    const s = this.require();
    if (!(EngineConstants.TAC_CAP_OPTIONS as readonly number[]).includes(cap)) throw new GameError('INVALID_TACTIC', `tacCap 은 0.25 / 0.35 / 0.5 / 0.6 / 0.7 중 하나: ${cap}`);
    if (s.settings.tacCap === cap) return;
    this.commit({ ...s, settings: { ...s.settings, tacCap: cap } });
  }

  resimulate(matchId: MatchId, overrides: ResimulateOverrides = {}): MatchReport {
    const s = this.require();
    const rec = this.record(s, matchId);
    const result = simulateMatch({
      matchId,
      seed: rec.seed,
      home: rec.home,
      away: rec.away,
      config: {
        engineVersion: ENGINE_VERSION,
        tacCap: overrides.tacCap ?? rec.tacCap,
        tacticsEnabled: overrides.tacticsEnabled ?? true,
        disabledRules: overrides.disabledRules ?? [],
      },
    });
    const ex = explainMatch(result, VALUE_TABLE);
    const summaries = Object.values(s.summaries).filter((x) => x.season === s.time.season);
    const upTo = summaries.filter((x) => x.day <= (s.summaries[matchId]?.day ?? 99));
    const names: Record<string, string> = {};
    for (const t of [rec.home, rec.away]) for (const p of [...t.starters, ...t.bench]) names[p.id] = p.name;
    return buildReport(result, ex, s.userClubId, computeLeagueAverages(summaries), upTo.filter((x) => x.matchId !== matchId), names);
  }

  runCalibration(opts: CalibrationOptions, onProgress?: (p: CalibrationProgress) => void): Promise<CalibrationReport> {
    if (typeof Worker === 'undefined') {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(runCalibrationSync(opts, onProgress));
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }, 0);
      });
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./workers/calibration.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ type: 'progress' | 'done' | 'error'; progress?: CalibrationProgress; report?: CalibrationReport; message?: string }>) => {
        const m = e.data;
        if (m.type === 'progress' && m.progress) onProgress?.(m.progress);
        else if (m.type === 'done' && m.report) {
          worker.terminate();
          resolve(m.report);
        } else if (m.type === 'error') {
          worker.terminate();
          reject(new Error(m.message ?? 'calibration failed'));
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(new Error(err.message));
      };
      worker.postMessage(opts);
    });
  }
}

export function createGameService(deps: GameServiceDeps = {}): GameService {
  return new LocalGameService(deps);
}

export { COACH_ID, OWNER_ID };
