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
  UiLogKind,
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
  OWNER_ID,
  SCHEMA_VERSION,
  TIER_ECONOMY,
  advanceDayState,
  applyPatch,
  botStyleOf,
  buildOpponentScout,
  buildReplay,
  buildReport,
  carryOver,
  checkAction,
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
} from '../domain';
import {
  CONTRACT_VERSION,
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
    for (const pid of c.playerIds) {
      const p = players[pid as string];
      if (!isObj(p) || !isObj(p.attrs) || !isObj(p.availability) || !isObj(p.contract) || !isObj(p.season) || !isNum(p.condition) || !isNum(p.ovr)) return `선수 ${String(pid)} 형식 오류`;
    }
    for (const k of ['A', 'B']) {
      const sl = (c.tactics as Record<string, unknown>)[k];
      const def = isObj(sl) ? FORMATIONS[sl.formation as keyof typeof FORMATIONS] : undefined;
      if (!isObj(sl) || !def || !Array.isArray(sl.roles) || sl.roles.length !== def.slots.length || !isObj(sl.instructions) || !isNum(sl.familiarity)) return `구단 ${id} 전술 ${k} 형식 오류`;
    }
    const f = finances[id];
    if (!isObj(f) || !isNum(f.balance) || !isNum(f.transferOnlyBudget) || !Array.isArray(f.ledger)) return `구단 ${id} 재정 형식 오류`;
  }
  for (const f of x.fixtures as unknown[]) {
    if (!isObj(f) || typeof f.id !== 'string' || !isNum(f.season) || !isNum(f.day) || !isObj(clubs[f.homeId as string]) || !isObj(clubs[f.awayId as string])) return '일정 형식 오류';
  }
  const ms = x.memberships as unknown[];
  if (!ms.some((m) => isObj(m) && m.userId === x.actorUserId && m.clubId === x.userClubId)) return '현재 사용자 멤버십이 없습니다';
  return null;
}

interface PendingWrite {
  s: GameState;
  /** 본문(세이브)도 쓴다. false = 로그만 (logEvent) */
  save: boolean;
}

class LocalGameService implements GameService {
  readonly contractVersion = CONTRACT_VERSION;
  private readonly storage: LegacyStoragePort;
  private readonly slots: StoragePort;
  private readonly clock: Clock;
  private activeSlot: SaveSlotId | null = null;
  /** 쓰기 대기 (슬롯별 최신 상태만 = 합치기). save=false 면 행동 로그만 쓴다 */
  private readonly pendingWrites = new Map<SaveSlotId, PendingWrite>();
  /** 쓰기 실패한 최신 상태. 새 변경이 오면 대체되고, flush 가 재시도한다 */
  private readonly failedWrites = new Map<SaveSlotId, PendingWrite>();
  private writing: Promise<void> | null = null;
  private saveStatus: SaveStatus = { slotId: null, pending: false, lastSavedAt: null, error: null };
  private readonly listeners = new Set<() => void>();
  private state: GameState | null = null;
  private standingsCache: { state: GameState; rows: StandingRow[] } | null = null;
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
    if (this.activeSlot === null || !this.state) return;
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
    return { at: this.clock.nowIso(), gameTime: { ...s.time }, actor: actor ?? s.actorUserId, kind, ...(data ? { data } : {}) };
  }

  private withLog(s: GameState, kind: ActionLogKind, data?: Record<string, unknown>): GameState {
    return { ...s, seq: s.seq + 1, actionLog: [...s.actionLog, this.entry(s, kind, data)] };
  }

  private membership(s: GameState): Membership {
    const m = s.memberships.find((x) => x.userId === s.actorUserId) ?? s.memberships[0];
    if (!m) throw new GameError('NO_GAME', '멤버십이 없습니다');
    return m;
  }

  private guard(s: GameState, action: ActionKind): void {
    const r = checkAction(this.membership(s), action, { now: s.time, pastDeadline: false, clubId: s.userClubId });
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
    const seed = opts.seed ?? hashString(`${this.clock.nowIso()}|${Date.now()}`);
    const s0 = createInitialState(
      seed,
      { clubName: opts.clubName ?? '킥오프 FC', tier: opts.tier ?? 'T3', devMode: opts.devMode ?? true, tacCap: opts.tacCap ?? (EngineConstants.DEFAULT_TAC_CAP as TacticCap) },
      this.clock.nowIso(),
    );
    const s = { ...s0, actionLog: [this.entry(s0, 'SEASON_STARTED', { season: 1, seed: s0.gameSeed }, OWNER_ID)] };
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
    if (this.activeSlot === slotId) this.close();
    this.pendingWrites.delete(slotId);
    this.failedWrites.delete(slotId);
    await this.writing; // 진행 중 쓰기가 삭제 뒤에 슬롯을 되살리지 않도록
    await this.slots.remove(slotId);
    this.updateStatus();
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

  getActor(): Membership {
    return this.membership(this.require());
  }

  switchRole(seat: 'OWNER' | 'COACH'): Membership {
    const s = this.require();
    const m = s.memberships.find((x) => x.seat === seat && x.clubId === s.userClubId);
    if (!m) throw new GameError('NOT_FOUND', `${seat} 멤버십이 없습니다`);
    if (m.userId === s.actorUserId) return m;
    const next = this.withLog({ ...s, actorUserId: m.userId }, 'ROLE_SWITCHED', { seat, userId: m.userId });
    this.commit(next);
    return m;
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
    const p = this.require().players[playerId];
    if (!p) throw new GameError('NOT_FOUND', `선수 없음: ${playerId}`);
    return p;
  }

  getStandings(): StandingRow[] {
    const s = this.require();
    if (this.standingsCache?.state === s) return this.standingsCache.rows;
    const rows = computeStandings(Object.keys(s.clubs).sort(), Object.values(s.summaries), s.time.season, hashString(`${s.gameSeed}|tiebreak|${s.time.season}`));
    this.standingsCache = { state: s, rows };
    return rows;
  }

  getFixtures(filter: FixtureFilter = {}): Fixture[] {
    const s = this.require();
    return s.fixtures
      .filter(
        (f) =>
          (filter.clubId === undefined || f.homeId === filter.clubId || f.awayId === filter.clubId) &&
          (filter.day === undefined || f.day === filter.day) &&
          (filter.played === undefined || f.played === filter.played),
      )
      .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
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
    const econ = TIER_ECONOMY[s.settings.tier];
    const total = salaryTotal(s, id);
    const daysLeft = Math.max(0, 28 - s.time.day);
    const B = spendable(f.balance, total, daysLeft);
    const season = f.ledger.filter((e) => e.season === s.time.season);
    const income = season.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
    const expense = season.filter((e) => e.amount < 0).reduce((a, e) => a - e.amount, 0);
    return {
      clubId: id,
      tier: s.settings.tier,
      balance: f.balance,
      transferOnlyBudget: f.transferOnlyBudget,
      spendable: B,
      salaryTotal: total,
      salaryCap: econ.salaryCap,
      capUsage: econ.salaryCap > 0 ? total / econ.salaryCap : 0,
      seasonIncome: income,
      seasonExpense: expense,
      projectedCarry: carryOver({ ...f, balance: B }, econ),
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
    return { state, result: out.result };
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
    const replay = buildReplay(result, { clubs, players });
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

  propose(input: ProposalInput): Proposal {
    const s = this.require();
    this.guard(s, 'PROPOSE');
    const f = this.nextFixture(s);
    if (!f || input.payload.matchId !== f.id) throw new GameError('PROPOSAL_INVALID', '다음 경기에 대한 제안만 할 수 있습니다');
    const author = this.membership(s);
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
    const reactions = [...p.reactions.filter((r) => r.userId !== s.actorUserId), { userId: s.actorUserId, choice, ...(reason ? { reason: reason.slice(0, 80) } : {}) }];
    const next: Proposal = { ...p, reactions };
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
