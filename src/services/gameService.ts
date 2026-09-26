/**
 * GameService 로컬 구현 (소유: A). 현재는 시그니처 스텁.
 * 구현 원칙: 모든 변경은 (1) checkAction 권한 검사 → (2) 새 GameState 계산(domain 순수 함수)
 * → (3) storage.save → (4) snapshot 교체 → (5) 리스너 통지 순서. 중간 실패 시 이전 상태 유지(원자성).
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
  SeasonNo,
  SeasonOutcome,
  SlotKey,
  StandingRow,
  TacticCap,
  UiLogKind,
} from '../types';
import {
  CONTRACT_VERSION,
  type FixtureFilter,
  type GameService,
  type NewGameOptions,
  type ResimulateOverrides,
  type TacticSlotInput,
  type TacticUpdateResult,
} from './api';
import { createMemoryStorage, systemClock, type Clock, type StoragePort } from './ports';

export interface GameServiceDeps {
  storage?: StoragePort;
  clock?: Clock;
}

function todo(): never {
  throw new Error('TODO');
}

class LocalGameService implements GameService {
  readonly contractVersion = CONTRACT_VERSION;
  private readonly storage: StoragePort;
  private readonly clock: Clock;
  private readonly listeners = new Set<() => void>();
  private snapshot: GameSnapshot | null = null;

  constructor(deps: GameServiceDeps) {
    this.storage = deps.storage ?? createMemoryStorage();
    this.clock = deps.clock ?? systemClock;
  }

  getSnapshot(): GameSnapshot | null {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  newGame(_opts?: NewGameOptions): GameSnapshot {
    void this.storage;
    void this.clock;
    return todo();
  }
  loadGame(): GameSnapshot | null {
    return todo();
  }
  resetGame(): void {
    todo();
  }
  exportSave(): string {
    return todo();
  }
  importSave(_json: string): GameSnapshot {
    return todo();
  }

  getActor(): Membership {
    return todo();
  }
  switchRole(_seat: 'OWNER' | 'COACH'): Membership {
    return todo();
  }

  getCatalog(): Catalog {
    return todo();
  }
  getSquad(_clubId?: ClubId): Player[] {
    return todo();
  }
  getPlayer(_playerId: PlayerId): Player {
    return todo();
  }
  getStandings(): StandingRow[] {
    return todo();
  }
  getFixtures(_filter?: FixtureFilter): Fixture[] {
    return todo();
  }
  getNextMatch(): Fixture | null {
    return todo();
  }
  getOpponentScout(_clubId: ClubId): OpponentScout {
    return todo();
  }
  getFinance(_clubId?: ClubId): FinanceSummary {
    return todo();
  }

  updateTacticSlot(_slot: SlotKey, _next: TacticSlotInput): TacticUpdateResult {
    return todo();
  }
  getPlanState(): PlanState {
    return todo();
  }
  validatePlan(_plan: MatchPlan): PlanValidationIssue[] {
    return todo();
  }
  saveDraft(_plan: MatchPlan): PlanRecord {
    return todo();
  }
  submitPlan(_plan: MatchPlan): PlanRecord {
    return todo();
  }
  setDefaultPlan(_plan: MatchPlan): void {
    todo();
  }
  recommendPlan(): MatchPlan {
    return todo();
  }
  previewResolvedPlan(): ResolvedPlan | null {
    return todo();
  }

  advanceDay(): DayResult {
    return todo();
  }
  advanceDays(_n: number): DayResult[] {
    return todo();
  }
  advanceToSeasonEnd(): DayResult[] {
    return todo();
  }
  startNewSeason(): GameSnapshot {
    return todo();
  }
  getSeasonOutcome(_season?: SeasonNo): SeasonOutcome | null {
    return todo();
  }

  getReport(_matchId: MatchId): MatchReport {
    return todo();
  }
  getMatchReplay(_matchId: MatchId): MatchReplay {
    return todo();
  }

  propose(_input: ProposalInput): Proposal {
    return todo();
  }
  react(_proposalId: ProposalId, _choice: 'FOR' | 'AGAINST', _reason?: string): Proposal {
    return todo();
  }
  approve(_proposalId: ProposalId, _edits?: PlanChangePatch): ApproveResult {
    return todo();
  }
  reject(_proposalId: ProposalId, _note?: string): Proposal {
    return todo();
  }
  listProposals(_filter?: { status?: ProposalStatus }): Proposal[] {
    return todo();
  }

  logEvent(_kind: UiLogKind, _data?: Record<string, unknown>): void {
    todo();
  }
  exportActionLog(): string {
    return todo();
  }

  setTacCap(_cap: TacticCap): void {
    todo();
  }
  resimulate(_matchId: MatchId, _overrides?: ResimulateOverrides): MatchReport {
    return todo();
  }
  runCalibration(
    _opts: CalibrationOptions,
    _onProgress?: (p: CalibrationProgress) => void,
  ): Promise<CalibrationReport> {
    return Promise.reject(new Error('TODO'));
  }
}

export function createGameService(deps: GameServiceDeps = {}): GameService {
  return new LocalGameService(deps);
}
