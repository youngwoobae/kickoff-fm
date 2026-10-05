/**
 * GameService 가짜 구현 (소유: B, 개발 전용).
 * - 화면 개발용 메모리 상태 + localStorage(별도 키) 보존. 규칙은 근사치다(실제 규칙은 A 의 domain).
 * - `implements GameService` 로 계약 적합성을 타입 체크가 보장한다.
 * - VITE_FAKE_SERVICE=1 이거나 URL 에 ?fake=1 이 있으면 이 구현을 쓴다(ui/service/serviceHost.ts).
 */
import type {
  ApproveResult,
  CalibrationOptions,
  CalibrationProgress,
  CalibrationReport,
  CalibrationTarget,
  Catalog,
  ChanceType,
  ClubId,
  CommentaryLine,
  DayResult,
  FactorCard,
  FinanceSummary,
  FitLevel,
  FormLetter,
  Fixture,
  FormationDef,
  FormationId,
  GameSnapshot,
  GameState,
  LedgerEntry,
  LedgerKind,
  MatchId,
  MatchPlan,
  MatchReplay,
  Lane,
  PitchCue,
  MatchReport,
  MatchSummary,
  Membership,
  OpponentScout,
  PlanAdjustment,
  PlanChangePatch,
  PlanRecord,
  PlanSource,
  PlanState,
  PlanValidationIssue,
  Player,
  PlayerId,
  Position,
  StyleDef,
  StyleFit,
  StyleId,
  MatchupPreview,
  MatchupRuleHint,
  Proposal,
  ProposalDiffItem,
  ProposalId,
  ProposalInput,
  ProposalStatus,
  ResolvedPlan,
  RuleId,
  SaveSlotId,
  SaveSlotMeta,
  SaveStatus,
  SeasonNo,
  SeasonOutcome,
  SlotKey,
  StandingRow,
  Step,
  Suggestion,
  TacticCap,
  TacticSlot,
  TeamInstructions,
  TeamSummaryLite,
  TimelineItem,
  UiLogKind,
  ActionLogKind,
  CareerRecord,
  CareerSeason,
  ClubMovement,
  LeagueId,
  LeagueInfo,
  Pyramid,
  Tier,
  Bid,
  BidInput,
  InboxKind,
  InboxMessage,
  ListingKind,
  ReleaseQuote,
  RenewalQuote,
  RenewalResult,
  TransferLedgerKind,
  TransferListing,
  TransferListingFilter,
  TransferWindow,
  WindowKind,
} from '../../types';
import {
  CONTRACT_VERSION,
  SAVE_SLOT_IDS,
  GameError,
  type FixtureFilter,
  type GameService,
  type NewGameOptions,
  type ResimulateOverrides,
  type TacticSlotInput,
  type TacticUpdateResult,
  type StyleApplyMode,
  type StyleApplyResult,
} from '../../services';
import {
  ADJACENT,
  BALANCED_INSTR,
  BOT_STYLES,
  CATALOG,
  CLUB_NAMES,
  FOLD_TAG,
  KEY_ATTRS,
  RULES,
  STYLES,
  hashString,
  koreanName,
  mulberry32,
} from './fakeData';
import { TIER_NAME, conditionalText, formatKc, nearestStyle } from '../format';
import { YELLOW_LIMIT, trainingOf, type TrainingFocus, type YouthCandidate, type YouthIntake } from '../types23';

// ── 2.3.0 (M5.1) 근사: 훈련 포커스·유스·경고 누적 ──
const TIER_REF_OVR: Record<Tier, number> = { T1: 72, T2: 66, T3: 60, T4: 54, T5: 48 }; // domain TIER_REFERENCE_OVR 사본
const WEEK_STARTS = [1, 8, 15, 22];
const LIFE_YOUTH_DEADLINE = 7;
const YOUTH_POS: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'FB', 'FB', 'FB', 'FB', 'DM', 'DM', 'CM', 'CM', 'CM', 'AM', 'AM', 'W', 'W', 'ST', 'ST', 'ST'];
const gradeOf = (v: number): Player['scoutRange'][0] => (v >= 80 ? 'S' : v >= 72 ? 'A' : v >= 65 ? 'B' : v >= 58 ? 'C' : v >= 50 ? 'D' : 'E');
const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());


const FAKE_SAVE_KEY = 'kickoff-fm/fake/v2';
const SCHEMA = 2;
const USER_CLUB: ClubId = 'c00';
const OWNER_ID = 'u-owner';
const COACH_ID = 'u-coach';
const ECON = { budget: 60_000_000, cap: 48_000_000, win: 1_200_000, draw: 500_000, loss: 200_000 };
const FIT_MULT: Record<FitLevel, number> = { NATURAL: 1, ACCOMPLISHED: 0.95, CAPABLE: 0.88, UNSUITED: 0.75 };
const SQUAD_TEMPLATE: Position[] = [
  'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'FB', 'FB', 'FB', 'FB', 'DM', 'DM',
  'CM', 'CM', 'CM', 'AM', 'W', 'W', 'W', 'ST', 'ST', 'ST',
];

// ── 가짜 피라미드 (2.1.0) ──────────────────────────────────────────
// 사용자 리그 외 4리그(56구단)는 이름·결과만 있는 가상 구단 'v{그룹}-{nn}'. 선수·재정·플랜은 사용자 리그만.
// ponytail: 승강은 사용자 티어만 바꾸고 가상 구단은 리그를 옮기지 않는다(그룹↔티어 재배치). 실제 이동은 실제 서비스(M3.3) 몫.
const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];
const PROMOTE: Record<Tier, number> = { T1: 0, T2: 2, T3: 2, T4: 3, T5: 3 };
const RELEGATE: Record<Tier, number> = { T1: 2, T2: 2, T3: 3, T4: 3, T5: 0 };
const leagueIdOf = (t: Tier): LeagueId => `L-${t}`;
const VIRTUAL_PLACES = (
  '수원 인천 부천 안양 성남 고양 용인 화성 평택 김포 파주 의정부 남양주 광명 ' +
  '춘천 원주 강릉 청주 충주 천안 아산 대전 세종 전주 군산 광주 목포 여수 ' +
  '순천 대구 포항 경주 구미 안동 울산 부산 창원 김해 진주 거제 제주 서귀포 ' +
  '시흥 안산 오산 이천 여주 양평 속초 동해 제천 공주 논산 익산 정읍 나주'
).split(' ');
const VIRTUAL_SUFFIX = ['FC', '시티', '유나이티드', 'SC'];
const isVirtual = (id: ClubId) => id.startsWith('v');
const virtualIds = (g: number): ClubId[] => Array.from({ length: 14 }, (_, i) => `v${g}-${String(i).padStart(2, '0')}`);
const userIds = (s: GameState): ClubId[] => Object.keys(s.clubs).filter((id) => !isVirtual(id));
const hasVirtual = (s: GameState) => !!s.clubs['v0-00'];
/** 가상 그룹 g 의 티어 = 사용자 티어를 뺀 나머지 티어 순서 */
const otherTiers = (s: GameState): Tier[] => TIERS.filter((t) => t !== s.settings.tier);
type LiteSide = Pick<TeamSummaryLite, 'clubId' | 'goals' | 'xg' | 'xPts'>;

/** 결과 목록 → 순위표. 구역 인원은 티어별(PROMOTE/RELEGATE) */
function tableOf(s: GameState, ids: ClubId[], results: { home: LiteSide; away: LiteSide }[], tier: Tier): StandingRow[] {
  const rows: Record<ClubId, StandingRow> = {};
  for (const id of ids) {
    rows[id] = { position: 0, clubId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, xgFor: 0, xgAgainst: 0, xPts: 0, form: [], zone: 'NONE' };
  }
  for (const m of results) {
    for (const [me, op] of [[m.home, m.away], [m.away, m.home]] as const) {
      const r = rows[me.clubId];
      if (!r) continue;
      r.played++;
      r.goalsFor += me.goals;
      r.goalsAgainst += op.goals;
      r.xgFor = round2(r.xgFor + me.xg);
      r.xgAgainst = round2(r.xgAgainst + op.xg);
      r.xPts = round2(r.xPts + me.xPts);
      const res: FormLetter = me.goals > op.goals ? 'W' : me.goals === op.goals ? 'D' : 'L';
      if (res === 'W') {
        r.won++;
        r.points += 3;
      } else if (res === 'D') {
        r.drawn++;
        r.points += 1;
      } else r.lost++;
      r.form = [...r.form, res].slice(-5);
    }
  }
  const list = Object.values(rows);
  for (const r of list) r.goalDiff = r.goalsFor - r.goalsAgainst;
  list.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      (s.clubs[a.clubId]?.name ?? '').localeCompare(s.clubs[b.clubId]?.name ?? ''),
  );
  list.forEach((r, i) => {
    r.position = i + 1;
    r.zone = i < PROMOTE[tier] ? 'PROMOTION' : i >= list.length - RELEGATE[tier] ? 'RELEGATION' : 'NONE';
  });
  return list;
}

interface FakeSave {
  state: GameState;
  reports: Record<MatchId, MatchReport>;
  replays: Record<MatchId, MatchReplay>;
}

const clone = <T>(v: T): T => structuredClone(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const clampStep = (v: number): Step => clamp(Math.round(v), -2, 2) as Step;
const round1k = (v: number) => Math.round(v / 1000) * 1000;

/** fake 이적 상태 (GameState 에 덧붙여 세이브에 함께 저장) */
interface FakeMarket {
  window: TransferWindow | null;
  listings: TransferListing[];
  bids: Bid[];
  /** 이번 시즌 영입 수 */
  signings: number;
  nextId: number;
}
type FakeState = GameState & { market?: FakeMarket };
/** 경제 3.2 근사: S(60) ≈ 3.0M, OVR 1점당 ×1.075 */
const fakeS = (ovr: number) => 3_000_000 * 1.075 ** (ovr - 60);
/** 경제 6.1 근사 평가가치 V (잠재력계수는 공개 정보가 없어 1.0) */
function fakeValue(p: Player): number {
  const age = p.age <= 21 ? 1.3 : p.age <= 27 ? 1 : p.age <= 30 ? 0.8 : 0.5;
  const left = !p.clubId || p.contract.seasonsLeft >= 3 ? 1 : p.contract.seasonsLeft === 2 ? 0.85 : 0.6;
  return round1k(5 * fakeS(p.ovr) * age * left);
}
function seasonsRangeOf(age: number): [number, number] {
  return age <= 23 ? [1, 3] : age <= 29 ? [1, 4] : age <= 32 ? [1, 2] : [1, 1];
}

function fitOf(p: Player, pos: Position): FitLevel {
  if (p.primary === pos) return 'NATURAL';
  return p.positions[pos] ?? 'UNSUITED';
}
function available(p: Player | undefined): boolean {
  return !!p && p.availability.injuryDays <= 0 && p.availability.suspendedMatches <= 0;
}
function condEff(c: number): number {
  if (c >= 90) return 1;
  if (c >= 60) return 0.85 + ((c - 60) / 30) * 0.15;
  return 0.8;
}
function formationOf(id: FormationId): FormationDef {
  return CATALOG.formations.find((f) => f.id === id) ?? (CATALOG.formations[0] as FormationDef);
}
function poisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 12);
  return k - 1;
}
function poissonPmf(lambda: number, k: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}
function xPoints(xgFor: number, xgAgainst: number): number {
  let w = 0;
  let d = 0;
  for (let a = 0; a <= 10; a++) {
    for (let b = 0; b <= 10; b++) {
      const p = poissonPmf(Math.max(0.05, xgFor), a) * poissonPmf(Math.max(0.05, xgAgainst), b);
      if (a > b) w += p;
      else if (a === b) d += p;
    }
  }
  return round2(3 * w + d);
}
const LEDGER_MEMO: Partial<Record<LedgerKind, string>> = {
  SEASON_BUDGET: '시즌 기본 배정금',
  SALARY: '연봉 일할 차감',
  MATCH_WIN: '승리 수당',
  MATCH_DRAW: '무승부 수당',
  MATCH_LOSS: '패배 수당',
  PRIZE: '순위 상금',
  CHAMPION_BONUS: '우승 수당',
  CARRY_EXCESS_SPLIT: '이월 상한 초과분 → 한정 예산',
};

// ─────────────────────────────────────────────────────────────────────────────

function genPlayer(rng: () => number, id: PlayerId, clubId: ClubId, pos: Position, level: number): Player {
  const base = level / 5;
  const keys = KEY_ATTRS[pos];
  const attrs = {} as Player['attrs'];
  for (const k of [
    'passing', 'dribbling', 'finishing', 'crossing', 'tackling', 'vision', 'positioning',
    'composure', 'workRate', 'pace', 'stamina', 'physical', 'reflexes', 'aerialCommand', 'kicking',
  ] as const) {
    const isGkAttr = k === 'reflexes' || k === 'aerialCommand' || k === 'kicking';
    let v: number;
    if (isGkAttr && pos !== 'GK') v = 1 + Math.floor(rng() * 5);
    else if (!isGkAttr && pos === 'GK' && !keys.includes(k)) v = base - 5 + rng() * 4;
    else v = base - 3 + rng() * 5 + (keys.includes(k) ? 2 : 0);
    attrs[k] = clamp(Math.round(v), 1, 20);
  }
  const ovr = Math.round((keys.reduce((s, k) => s + attrs[k], 0) / keys.length) * 5);
  const positions: Player['positions'] = { [pos]: 'NATURAL' };
  for (const [adj, fit] of Object.entries(ADJACENT[pos]) as [Position, FitLevel][]) {
    positions[adj] = rng() < 0.25 ? 'ACCOMPLISHED' : fit;
  }
  const age = 18 + Math.floor(rng() * 16);
  const grades = ['E', 'D', 'C', 'B', 'A', 'S'] as const;
  const g = clamp(Math.floor(ovr / 17), 0, 4);
  return {
    id,
    clubId,
    name: koreanName(rng),
    age,
    primary: pos,
    positions,
    attrs,
    ovr,
    potential: ovr + Math.floor(rng() * 10),
    scoutRange: [grades[g] ?? 'C', grades[g + 1] ?? 'S'],
    condition: 85 + Math.floor(rng() * 16),
    morale: 0,
    contract: { seasonsLeft: 1 + Math.floor(rng() * 4), salary: 0 },
    availability: { injuryDays: 0, suspendedMatches: 0 },
    isTemporary: false,
    season: { apps: 0, starts: 0, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0, yellowCards: 0 },
  };
}

function genFixtures(season: SeasonNo, clubIds: ClubId[], rng: () => number): Fixture[] {
  const ids = [...clubIds].sort(() => rng() - 0.5);
  const n = ids.length;
  const rounds: [ClubId, ClubId][][] = [];
  const arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [ClubId, ClubId][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i] as ClubId;
      const b = arr[n - 1 - i] as ClubId;
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    const last = arr.pop() as ClubId;
    arr.splice(1, 0, last);
  }
  const fixtures: Fixture[] = [];
  rounds.forEach((pairs, r) => {
    for (const [h, a] of pairs) {
      fixtures.push({ id: `s${season}-d${r + 1}-${h}-${a}`, season, day: r + 1, homeId: h, awayId: a, played: false });
      const d2 = r + 1 + (n - 1);
      fixtures.push({ id: `s${season}-d${d2}-${a}-${h}`, season, day: d2, homeId: a, awayId: h, played: false });
    }
  });
  return fixtures.sort((x, y) => x.day - y.day || x.id.localeCompare(y.id));
}

function styleOf(id: StyleId): StyleDef {
  const st = STYLES.find((x) => x.id === id) ?? STYLES[0];
  if (!st) throw new Error('카탈로그에 스타일이 없습니다');
  return st;
}
function mkSlot(key: SlotKey, styleId: StyleId, familiarity: number): TacticSlot {
  const st = styleOf(styleId);
  return { key, formation: st.formation, roles: [...st.roles], instructions: { ...st.instructions }, familiarity };
}

function describeInstr(i: TeamInstructions): string {
  const parts: string[] = [];
  const lab: [keyof TeamInstructions, string][] = [
    ['mentality', '공격성향'], ['press', '압박'], ['line', '라인'], ['width', '폭'], ['tempo', '템포'], ['directness', '패스'],
  ];
  for (const [k, l] of lab) {
    const v = i[k] as number;
    if (v !== 0) parts.push(`${l} ${v > 0 ? '+' : ''}${v}`);
  }
  if (i.counter) parts.push('역습');
  if (i.offsideTrap) parts.push('오프사이드 트랩');
  return parts.length ? parts.join(' · ') : '모두 보통';
}


// ─────────────────────────────────────────────────────────────────────────────

export class FakeGameService implements GameService {
  readonly contractVersion = CONTRACT_VERSION;
  private state: GameState | null = null;
  private reports: Record<MatchId, MatchReport> = {};
  private replays: Record<MatchId, MatchReplay> = {};
  private readonly listeners = new Set<() => void>();
  private readonly persist: boolean;
  /** 2.0.0 슬롯: persist 면 localStorage(`${FAKE_SAVE_KEY}/slot/{n}`), 아니면 메모리 */
  private readonly mem = new Map<string, string>();
  private slot: SaveSlotId | null = null;
  private status: SaveStatus = { slotId: null, pending: false, lastSavedAt: null, error: null };

  constructor(opts: { persist?: boolean } = {}) {
    this.persist = opts.persist ?? true;
  }

  private kv(key: string, value?: string | null): string | null {
    if (!this.persist) {
      if (value === null) this.mem.delete(key);
      else if (value !== undefined) this.mem.set(key, value);
      return this.mem.get(key) ?? null;
    }
    if (value === null) globalThis.localStorage?.removeItem(key);
    else if (value !== undefined) globalThis.localStorage?.setItem(key, value);
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  private slotKey(id: SaveSlotId): string {
    return `${FAKE_SAVE_KEY}/slot/${id}`;
  }
  private setSlot(id: SaveSlotId | null, lastSavedAt: string | null = this.status.lastSavedAt): void {
    this.slot = id;
    if (this.status.slotId !== id || this.status.lastSavedAt !== lastSavedAt) this.status = { slotId: id, pending: false, lastSavedAt, error: null };
  }
  private notify(): void {
    for (const l of this.listeners) l();
  }

  // ── 내부 유틸 ─────────────────────────────────────────────────────
  private req(): GameState {
    if (!this.state) throw new GameError('NO_GAME', '진행 중인 게임이 없습니다');
    return this.state;
  }
  private commit(next: GameState): void {
    this.state = next;
    this.save();
    for (const l of this.listeners) l();
  }
  private save(): void {
    if (!this.state) return;
    const payload: FakeSave = { state: this.state, reports: this.reports, replays: this.replays };
    try {
      if (this.slot === null) {
        if (this.persist) globalThis.localStorage?.setItem(FAKE_SAVE_KEY, JSON.stringify(payload));
        return;
      }
      const s = this.state;
      const meta: SaveSlotMeta = {
        slotId: this.slot,
        clubName: s.clubs[s.userClubId]?.name ?? '?',
        tier: s.settings.tier,
        season: s.time.season,
        day: s.time.day,
        phase: s.phase,
        savedAt: new Date().toISOString(),
        schemaVersion: s.schemaVersion,
      };
      this.kv(this.slotKey(this.slot), JSON.stringify(payload));
      this.kv(`${this.slotKey(this.slot)}/meta`, JSON.stringify(meta));
      this.setSlot(this.slot, meta.savedAt);
    } catch (e) {
      // 실제 서비스처럼 상태는 유지하고 오류만 알린다 (오류가 바뀔 때만 통지는 commit 이 어차피 통지하므로 생략)
      this.status = { ...this.status, pending: true, error: e instanceof Error ? e.message : String(e) };
    }
  }
  private log(s: GameState, kind: ActionLogKind, data?: Record<string, unknown>): void {
    s.actionLog.push({ at: new Date().toISOString(), gameTime: { ...s.time }, actor: s.actorUserId, kind, data });
    if (s.actionLog.length > 5000) s.actionLog.splice(0, s.actionLog.length - 5000);
  }
  private seat(s: GameState): Membership['seat'] {
    return s.memberships.find((m) => m.userId === s.actorUserId)?.seat ?? 'COACH_SPECTATOR';
  }
  private requireOwner(s: GameState): void {
    if (this.seat(s) !== 'OWNER') throw new GameError('PERMISSION_DENIED', '구단주만 할 수 있습니다 (코치는 제안하기를 사용하세요)');
  }
  private requireCoach(s: GameState): void {
    if (this.seat(s) !== 'COACH') throw new GameError('PERMISSION_DENIED', '코치만 제안할 수 있습니다');
  }
  private ts(s: GameState) {
    s.seq += 1;
    return { season: s.time.season, day: s.time.day, seq: s.seq };
  }
  private nextFixture(s: GameState, clubId: ClubId = s.userClubId): Fixture | null {
    if (s.phase !== 'MATCHDAY') return null;
    return (
      s.fixtures.find((f) => !f.played && f.day >= s.time.day && (f.homeId === clubId || f.awayId === clubId)) ?? null
    );
  }
  private squadOf(s: GameState, clubId: ClubId): Player[] {
    const club = s.clubs[clubId];
    if (!club) throw new GameError('NOT_FOUND', `구단 없음: ${clubId}`);
    return club.playerIds.map((id) => s.players[id]).filter((p): p is Player => !!p);
  }

  /** 슬롯 A(또는 지정 슬롯) 포메이션 기준 최고 11명 + 벤치 7명 */
  private systemPlan(s: GameState, clubId: ClubId, matchId: MatchId | null, slot: SlotKey = 'A'): MatchPlan {
    const club = s.clubs[clubId];
    if (!club) throw new GameError('NOT_FOUND', clubId);
    const f = formationOf(club.tactics[slot].formation);
    const pool = this.squadOf(s, clubId).filter(available);
    const used = new Set<PlayerId>();
    const starters: PlayerId[] = [];
    for (const sl of f.slots) {
      let best: Player | undefined;
      let bestScore = -1;
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const score = p.ovr * FIT_MULT[fitOf(p, sl.position)] * condEff(p.condition) * (sl.position === 'GK' ? (p.primary === 'GK' ? 1 : 0.3) : p.primary === 'GK' ? 0.2 : 1);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (best) {
        used.add(best.id);
        starters.push(best.id);
      }
    }
    const rest = pool.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
    const gk = rest.find((p) => p.primary === 'GK');
    const bench = [...(gk ? [gk] : []), ...rest.filter((p) => p !== gk)].slice(0, 7).map((p) => p.id);
    return { clubId, matchId, lineup: { starters, bench }, startSlot: slot, conditionals: [], autoSubThreshold: 55, autoRotation: true };
  }

  /** 4.7 근사: 후보 선택 → 보정 */
  private resolve(s: GameState, clubId: ClubId, fx: Fixture | null): ResolvedPlan {
    const ps = s.plans[clubId] ?? {};
    const club = s.clubs[clubId];
    if (!club) throw new GameError('NOT_FOUND', clubId);
    let source: PlanSource = 'SYSTEM';
    let plan: MatchPlan;
    if (ps.confirmed) {
      source = 'CONFIRMED';
      plan = clone(ps.confirmed.plan);
    } else if (club.defaultPlan) {
      source = 'DEFAULT';
      plan = clone(club.defaultPlan);
    } else if (club.lastUsedPlan) {
      source = 'LAST_USED';
      plan = clone(club.lastUsedPlan);
      delete plan.opponentOrders;
    } else {
      plan = this.systemPlan(s, clubId, fx?.id ?? null);
    }
    plan.matchId = fx?.id ?? null;
    const adjustments = this.adjust(s, plan, fx);
    return { plan, source, adjustments };
  }

  private adjust(s: GameState, plan: MatchPlan, fx: Fixture | null): PlanAdjustment[] {
    const adj: PlanAdjustment[] = [];
    const club = s.clubs[plan.clubId];
    if (!club) return adj;
    const oppId = fx ? (fx.homeId === plan.clubId ? fx.awayId : fx.homeId) : null;
    if (plan.opponentOrders && plan.opponentOrders.opponentId !== oppId) {
      delete plan.opponentOrders;
      adj.push({ kind: 'OPP_ORDERS_CLEARED', note: '다른 상대 기준 맞춤 지시라서 제거했어요' });
    }
    const f = formationOf(club.tactics[plan.startSlot].formation);
    const inPlan = new Set([...plan.lineup.starters, ...plan.lineup.bench]);
    const squad = this.squadOf(s, plan.clubId);
    const pickReplacement = (pos: Position, minCond: number): Player | undefined =>
      [...plan.lineup.bench.map((id) => s.players[id]), ...squad.filter((p) => !inPlan.has(p.id))]
        .filter((p): p is Player => available(p) && (p?.condition ?? 0) >= minCond && !plan.lineup.starters.includes(p!.id))
        .sort((a, b) => b.ovr * FIT_MULT[fitOf(b, pos)] - a.ovr * FIT_MULT[fitOf(a, pos)])[0];
    const swapIn = (i: number, p: Player) => {
      const outId = plan.lineup.starters[i];
      plan.lineup.starters[i] = p.id;
      const bi = plan.lineup.bench.indexOf(p.id);
      if (bi >= 0 && outId) plan.lineup.bench[bi] = outId;
      else if (bi >= 0) plan.lineup.bench.splice(bi, 1);
      inPlan.add(p.id);
    };
    plan.lineup.starters.forEach((id, i) => {
      const p = s.players[id];
      const pos = f.slots[i]?.position ?? 'CM';
      if (!available(p) || p?.clubId !== plan.clubId) {
        const r = pickReplacement(pos, 0);
        if (r) {
          swapIn(i, r);
          adj.push({ kind: 'UNAVAILABLE_REPLACED', playerOut: id, playerIn: r.id, note: `${p?.name ?? id} 출전 불가 → ${r.name}` });
        }
      } else if (plan.autoRotation && p && p.condition < 70) {
        const r = pickReplacement(pos, 70);
        if (r && r.ovr >= p.ovr - 12) {
          swapIn(i, r);
          adj.push({ kind: 'AUTO_ROTATION', playerOut: id, playerIn: r.id, note: `${p.name} 휴식(컨디션 ${Math.round(p.condition)}) → ${r.name}` });
        }
      }
    });
    const okBench = (id: PlayerId) => available(s.players[id]) && s.players[id]?.clubId === plan.clubId;
    const bad = plan.lineup.bench.filter((id) => !okBench(id));
    if (bad.length) {
      plan.lineup.bench = plan.lineup.bench.filter(okBench);
      adj.push({ kind: 'VALIDITY_FIX', note: `벤치 출전 불가 선수 ${bad.length}명 제외` });
    }
    const all = new Set([...plan.lineup.starters, ...plan.lineup.bench]);
    for (const c of plan.conditionals) {
      if (c.enabled && c.action.kind === 'SWITCH_SLOT' && !club.tactics[c.action.slot]) {
        c.enabled = false;
        adj.push({ kind: 'CONDITIONAL_DISABLED', conditionalId: c.id, note: '없는 슬롯 참조' });
      }
    }
    void all;
    return adj;
  }

  // ── 구독 ──────────────────────────────────────────────────────────
  getSnapshot(): GameSnapshot | null {
    return this.state;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── 수명 주기 ──────────────────────────────────────────────────────
  newGame(opts: NewGameOptions = {}): GameSnapshot {
    const seed = opts.seed ?? (Date.now() & 0x7fffffff);
    const rng = mulberry32(seed);
    const clubs: GameState['clubs'] = {};
    const players: GameState['players'] = {};
    CLUB_NAMES.forEach(([name, short], idx) => {
      const id = `c${String(idx).padStart(2, '0')}`;
      const isHuman = id === USER_CLUB;
      const style = isHuman ? undefined : BOT_STYLES[idx - 1];
      const level = isHuman ? 62 : 62 * (0.9 + rng() * 0.18);
      const playerIds: PlayerId[] = [];
      SQUAD_TEMPLATE.forEach((pos, j) => {
        const pid = `${id}-p${String(j).padStart(2, '0')}`;
        const p = genPlayer(rng, pid, id, pos, level + (j % 2 === 0 ? 4 : -3) + (rng() * 8 - 4));
        players[pid] = p;
        playerIds.push(pid);
      });
      const totalOvr = playerIds.reduce((s, pid) => s + (players[pid]?.ovr ?? 0), 0);
      for (const pid of playerIds) {
        const p = players[pid];
        if (p) p.contract.salary = Math.round(((ECON.cap * 0.94 * p.ovr) / totalOvr) / 1000) * 1000;
      }
      clubs[id] = {
        id,
        name: isHuman && opts.clubName ? opts.clubName : name,
        shortName: isHuman && opts.clubName ? opts.clubName.trim().split(/\s+/)[0]?.slice(0, 4) ?? short : short,
        isHuman,
        ownerUserId: isHuman ? OWNER_ID : undefined,
        style,
        playerIds,
        tactics: { A: mkSlot('A', style ?? 'BALANCED', 70), B: mkSlot('B', 'BALANCED', 40) },
      };
    });
    const clubIds = Object.keys(clubs);
    const finances: GameState['finances'] = {};
    for (const id of clubIds) finances[id] = { clubId: id, balance: 0, transferOnlyBudget: 0, ledger: [] };
    for (let g = 0; g < 4; g++) {
      virtualIds(g).forEach((id, i) => {
        const place = VIRTUAL_PLACES[g * 14 + i] ?? id;
        clubs[id] = { id, name: `${place} ${VIRTUAL_SUFFIX[i % 4]}`, shortName: place, isHuman: false, playerIds: [], tactics: { A: mkSlot('A', 'BALANCED', 50), B: mkSlot('B', 'BALANCED', 50) } };
      });
    }
    const startTier = opts.startTier ?? opts.tier ?? 'T5';
    const s: GameState = {
      schemaVersion: SCHEMA,
      engineVersion: 'fake-0',
      gameSeed: seed,
      createdAt: new Date().toISOString(),
      time: { season: 1, day: 1 },
      phase: 'MATCHDAY',
      seq: 0,
      settings: { tier: startTier, startTier, tacCap: opts.tacCap ?? 0.7, devMode: opts.devMode ?? true },
      userClubId: USER_CLUB,
      actorUserId: OWNER_ID,
      clubs,
      players,
      fixtures: genFixtures(1, clubIds, rng),
      summaries: {},
      records: {},
      plans: {},
      finances,
      memberships: [
        { clubId: USER_CLUB, userId: OWNER_ID, seat: 'OWNER', joinedAt: { season: 1, day: 1, seq: 0 }, hasOwnClub: true },
        { clubId: USER_CLUB, userId: COACH_ID, seat: 'COACH', roleLabel: 'TAC', joinedAt: { season: 0, day: 1, seq: 0 }, hasOwnClub: false },
      ],
      proposals: {},
      seasonHistory: [],
      actionLog: [],
    };
    for (const id of clubIds) {
      this.ledger(s, id, 'SEASON_BUDGET', ECON.budget);
      this.paySalary(s, id);
    }
    // 데모: 경고 누적 4장·출장 정지 선수 한 명씩 (배지 확인용)
    const demo = clubs[USER_CLUB]?.playerIds ?? [];
    const warned = players[demo[5] ?? ''];
    const banned = players[demo[7] ?? ''];
    if (warned) {
      warned.availability.yellowAccum = 4;
      warned.season.yellowCards = 4;
    }
    if (banned) {
      banned.availability.suspendedMatches = 1;
      banned.season.yellowCards = 5;
    }
    this.genYouth(s);
    this.reports = {};
    this.replays = {};
    if (opts.slotId !== undefined) this.setSlot(opts.slotId);
    this.commit(s);
    return s;
  }

  loadGame(): GameSnapshot | null {
    if (this.state) return this.state;
    if (!this.persist) return null;
    try {
      const raw = globalThis.localStorage?.getItem(FAKE_SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as FakeSave;
      if (parsed?.state?.schemaVersion !== SCHEMA) return null;
      this.reports = parsed.reports ?? {};
      this.replays = parsed.replays ?? {};
      this.state = parsed.state;
      for (const l of this.listeners) l();
      return this.state;
    } catch {
      return null;
    }
  }
  resetGame(): void {
    this.state = null;
    this.setSlot(null, null);
    this.reports = {};
    this.replays = {};
    try {
      globalThis.localStorage?.removeItem(FAKE_SAVE_KEY);
    } catch {
      /* noop */
    }
    for (const l of this.listeners) l();
  }
  exportSave(): string {
    const payload: FakeSave = { state: this.req(), reports: this.reports, replays: this.replays };
    return JSON.stringify(payload);
  }
  importSave(json: string, slotId?: SaveSlotId): GameSnapshot {
    let parsed: FakeSave;
    try {
      parsed = JSON.parse(json) as FakeSave;
    } catch {
      throw new GameError('SAVE_INCOMPATIBLE', 'JSON 형식이 아닙니다');
    }
    const st = (parsed as Partial<FakeSave>).state ?? (parsed as unknown as GameState);
    if (!st || st.schemaVersion !== SCHEMA || !st.clubs) throw new GameError('SAVE_INCOMPATIBLE', '호환되지 않는 세이브입니다');
    this.reports = parsed.reports ?? {};
    this.replays = parsed.replays ?? {};
    if (slotId !== undefined) this.setSlot(slotId);
    this.commit(st);
    return st;
  }

  // ── 세이브 슬롯 (2.0.0, 메모리/localStorage 3칸) ──────────────────
  async listSlots(): Promise<SaveSlotMeta[]> {
    const out: SaveSlotMeta[] = [];
    for (const id of SAVE_SLOT_IDS) {
      const raw = this.kv(`${this.slotKey(id)}/meta`);
      try {
        if (raw) out.push(JSON.parse(raw) as SaveSlotMeta);
      } catch {
        /* 메타 손상 = 빈 슬롯 (실제 어댑터와 같음) */
      }
    }
    return out;
  }
  async openSlot(slotId: SaveSlotId): Promise<GameSnapshot> {
    const raw = this.kv(this.slotKey(slotId));
    if (raw === null) throw new GameError('NOT_FOUND', `슬롯 ${slotId} 이 비어 있습니다`);
    let parsed: FakeSave;
    try {
      parsed = JSON.parse(raw) as FakeSave;
    } catch {
      throw new GameError('SAVE_INCOMPATIBLE', '세이브가 손상되었습니다');
    }
    if (parsed?.state?.schemaVersion !== SCHEMA) throw new GameError('SAVE_INCOMPATIBLE', '호환되지 않는 세이브입니다');
    this.reports = parsed.reports ?? {};
    this.replays = parsed.replays ?? {};
    this.state = parsed.state;
    this.setSlot(slotId, null);
    this.notify();
    return this.state;
  }
  async deleteSlot(slotId: SaveSlotId): Promise<void> {
    if (this.slot === slotId) await this.closeSlot();
    this.kv(this.slotKey(slotId), null);
    this.kv(`${this.slotKey(slotId)}/meta`, null);
  }
  async closeSlot(): Promise<void> {
    this.state = null;
    this.reports = {};
    this.replays = {};
    this.setSlot(null, null);
    this.notify();
  }
  async flush(): Promise<void> {
    if (this.status.error) this.save();
    if (this.status.error) throw new GameError('STORAGE_FULL', this.status.error);
  }
  async exportSlot(slotId: SaveSlotId): Promise<string> {
    if (slotId === this.slot) return this.exportSave();
    const raw = this.kv(this.slotKey(slotId));
    if (raw === null) throw new GameError('NOT_FOUND', `슬롯 ${slotId} 이 비어 있습니다`);
    return raw;
  }
  getActiveSlot(): SaveSlotId | null {
    return this.slot;
  }
  getSaveStatus(): SaveStatus {
    return this.status;
  }

  // ── 역할 ──────────────────────────────────────────────────────────
  getActor(): Membership {
    const s = this.req();
    const m = s.memberships.find((x) => x.userId === s.actorUserId);
    if (!m) throw new GameError('NOT_FOUND', '멤버십 없음');
    return m;
  }
  switchRole(seat: 'OWNER' | 'COACH'): Membership {
    const s = clone(this.req());
    s.actorUserId = seat === 'OWNER' ? OWNER_ID : COACH_ID;
    this.log(s, 'ROLE_SWITCHED', { seat });
    this.commit(s);
    return this.getActor();
  }

  // ── 조회 ──────────────────────────────────────────────────────────
  getCatalog(): Catalog {
    return CATALOG;
  }
  getSquad(clubId?: ClubId): Player[] {
    const s = this.req();
    return this.squadOf(s, clubId ?? s.userClubId);
  }
  getPlayer(playerId: PlayerId): Player {
    const p = this.req().players[playerId];
    if (!p) throw new GameError('NOT_FOUND', `선수 없음: ${playerId}`);
    return p;
  }
  getStandings(leagueId?: LeagueId): StandingRow[] {
    const s = this.req();
    if (leagueId === undefined || leagueId === leagueIdOf(s.settings.tier)) return this.standingsOf(s);
    const g = this.groupOf(s, leagueId);
    if (g < 0) throw new GameError('NOT_FOUND', `리그 없음: ${leagueId}`);
    return this.virtualLeague(s, g).table;
  }
  private standingsOf(s: GameState): StandingRow[] {
    const sums = Object.values(s.summaries)
      .filter((m) => m.season === s.time.season)
      .sort((a, b) => a.day - b.day);
    return tableOf(s, userIds(s), sums, s.settings.tier);
  }
  private groupOf(s: GameState, leagueId: LeagueId): number {
    return hasVirtual(s) ? otherTiers(s).findIndex((t) => leagueIdOf(t) === leagueId) : -1;
  }
  /** 가상 리그 한 시즌: 시드·시즌·그룹으로 결정적. allPlayed 가 아니면 지난 날짜만 반영 */
  private virtualLeague(s: GameState, g: number, allPlayed = s.phase !== 'MATCHDAY'): { tier: Tier; fixtures: Fixture[]; table: StandingRow[] } {
    const tier = otherTiers(s)[g] ?? 'T5';
    const ids = virtualIds(g);
    const rng = mulberry32(s.gameSeed ^ hashString(`${s.time.season}/${g}`));
    const str: Record<ClubId, number> = {};
    for (const id of ids) str[id] = 0.8 + rng() * 0.4;
    const results: { home: LiteSide; away: LiteSide }[] = [];
    const fixtures = genFixtures(s.time.season, ids, rng).map((f) => {
      const h = str[f.homeId] ?? 1;
      const a = str[f.awayId] ?? 1;
      const lh = (1.45 * h) / a;
      const la = (1.15 * a) / h;
      const hg = poisson(rng, lh);
      const ag = poisson(rng, la);
      const played = allPlayed || f.day < s.time.day;
      if (played) {
        results.push({
          home: { clubId: f.homeId, goals: hg, xg: round2(lh), xPts: xPoints(lh, la) },
          away: { clubId: f.awayId, goals: ag, xg: round2(la), xPts: xPoints(la, lh) },
        });
      }
      return { ...f, leagueId: leagueIdOf(tier), played };
    });
    return { tier, fixtures, table: tableOf(s, ids, results, tier) };
  }
  private pyr: { s: GameState; p: Pyramid } | null = null;
  getPyramid(): Pyramid {
    const s = this.req();
    if (this.pyr?.s === s) return this.pyr.p;
    const info = (tier: Tier, clubIds: ClubId[], isUserLeague: boolean): LeagueInfo => ({
      id: leagueIdOf(tier), tier, name: TIER_NAME[tier], clubIds, promoteCount: PROMOTE[tier], relegateCount: RELEGATE[tier], isUserLeague,
    });
    const leagues = TIERS.flatMap((t) => {
      if (t === s.settings.tier) return [info(t, userIds(s).sort(), true)];
      return hasVirtual(s) ? [info(t, virtualIds(otherTiers(s).indexOf(t)), false)] : [];
    });
    const p: Pyramid = { season: s.time.season, leagues, userLeagueId: leagueIdOf(s.settings.tier) };
    this.pyr = { s, p };
    return p;
  }
  getCareer(): CareerRecord {
    const s = this.req();
    const outs = [...s.seasonHistory, ...(s.pendingOutcome ? [s.pendingOutcome] : [])];
    const seasons: CareerSeason[] = outs.flatMap((o) => {
      const r = o.finalTable.find((x) => x.clubId === s.userClubId);
      if (!r) return [];
      return [{
        season: o.season, tier: o.tier, leagueId: o.leagueId ?? leagueIdOf(o.tier), position: r.position, points: r.points,
        won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst,
        label: o.labels[s.userClubId] ?? 'STAYED', champion: o.championId === s.userClubId,
      }];
    });
    const highestTier = [s.settings.tier, ...seasons.map((x) => x.tier)].sort()[0] ?? s.settings.tier;
    return {
      clubId: s.userClubId,
      startTier: s.settings.startTier ?? seasons[0]?.tier ?? s.settings.tier,
      currentTier: s.settings.tier,
      seasons,
      trophies: seasons.filter((x) => x.champion).map((x) => ({ season: x.season, tier: x.tier, kind: 'LEAGUE_TITLE' as const })),
      highestTier,
    };
  }
  getFixtures(filter: FixtureFilter = {}): Fixture[] {
    const s = this.req();
    const match = (f: Fixture) =>
      (filter.clubId === undefined || f.homeId === filter.clubId || f.awayId === filter.clubId) &&
      (filter.day === undefined || f.day === filter.day) &&
      (filter.played === undefined || f.played === filter.played);
    if (filter.leagueId !== undefined && filter.leagueId !== leagueIdOf(s.settings.tier)) {
      const g = this.groupOf(s, filter.leagueId);
      return g < 0 ? [] : this.virtualLeague(s, g).fixtures.filter(match);
    }
    return s.fixtures.filter(match);
  }
  getNextMatch(): Fixture | null {
    return this.nextFixture(this.req());
  }
  getOpponentScout(clubId: ClubId): OpponentScout {
    const s = this.req();
    const club = s.clubs[clubId];
    if (!club) throw new GameError('NOT_FOUND', clubId);
    const last5 = Object.values(s.summaries)
      .filter((m) => m.season === s.time.season && (m.home.clubId === clubId || m.away.clubId === clubId))
      .sort((a, b) => b.day - a.day)
      .slice(0, 5)
      .map((m) => {
        const me = m.home.clubId === clubId ? m.home : m.away;
        const op = m.home.clubId === clubId ? m.away : m.home;
        return { matchId: m.matchId, day: m.day, opponentId: op.clubId, goalsFor: me.goals, goalsAgainst: op.goals, formation: me.formation, instructionsSummary: describeInstr(me.instructions) };
      });
    const style = club.style ?? nearestStyle(STYLES, club.tactics.A.instructions)?.style.id;
    const st = style ? styleOf(style) : undefined;
    const weakness = st ? st.weaknesses.map((r: string) => `${RULES.find((x) => x.id === r)?.label ?? r}`).join(' · ') + '에 약해요' : '특이점 없음';
    return { clubId, botStyle: club.style ? FOLD_TAG[club.style] : undefined, style, styleEstimated: !club.style, last5, weakness };
  }
  getFinance(clubId?: ClubId): FinanceSummary {
    const s = this.req();
    const id = clubId ?? s.userClubId;
    const fin = s.finances[id];
    if (!fin) throw new GameError('NOT_FOUND', id);
    const salaryTotal = this.squadOf(s, id).reduce((a, p) => a + p.contract.salary, 0);
    const season = fin.ledger.filter((l) => l.season === s.time.season);
    const remaining = Math.max(0, 28 - s.time.day);
    const cap = Math.round(ECON.budget * 0.2);
    const bal = fin.balance;
    return {
      clubId: id,
      tier: s.settings.tier,
      balance: bal,
      transferOnlyBudget: fin.transferOnlyBudget,
      spendable: Math.round(bal - (salaryTotal * remaining) / 28 - (id === s.userClubId ? this.reservedTotal(s) : 0)),
      reserved: id === s.userClubId ? this.reservedTotal(s) : 0,
      salaryTotal,
      salaryCap: ECON.cap,
      capUsage: salaryTotal / ECON.cap,
      seasonIncome: season.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0),
      seasonExpense: season.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0),
      projectedCarry: { total: bal, cap, carried: Math.max(0, Math.min(bal, cap)), excess: Math.max(0, bal - cap) },
      recent: [...fin.ledger].reverse().slice(0, 30),
    };
  }

  // ── 전술·플랜 ──────────────────────────────────────────────────────
  updateTacticSlot(slot: SlotKey, next: TacticSlotInput): TacticUpdateResult {
    const s = clone(this.req());
    this.requireOwner(s);
    const club = s.clubs[s.userClubId];
    if (!club) throw new GameError('NO_GAME', '구단 없음');
    const prev = club.tactics[slot];
    const f = formationOf(next.formation);
    if (next.roles.length !== 11) throw new GameError('INVALID_TACTIC', '역할은 11개여야 합니다');
    next.roles.forEach((r, i) => {
      if (!f.slots[i]?.allowedRoles.includes(r)) throw new GameError('INVALID_TACTIC', `${i + 1}번 자리에 허용되지 않는 역할`);
    });
    if (next.instructions.offsideTrap && next.instructions.line < 1) {
      throw new GameError('INVALID_TACTIC', '오프사이드 트랩은 수비 라인 +1 이상에서만 켤 수 있습니다');
    }
    const halved = prev.formation !== next.formation;
    const updated: TacticSlot = { ...clone(next), key: slot, familiarity: halved ? Math.round(prev.familiarity * 0.5) : prev.familiarity };
    club.tactics[slot] = updated;
    this.log(s, 'TACTIC_CHANGED', { slot, formation: next.formation, halved });
    this.commit(s);
    return { slot: updated, familiarityHalved: halved };
  }

  applyStyle(slot: SlotKey, styleId: StyleId, mode: StyleApplyMode): StyleApplyResult {
    const cur = this.req().clubs[this.req().userClubId]?.tactics[slot];
    if (!cur) throw new GameError('NO_GAME', '구단 없음');
    const st = styleOf(styleId);
    const next: TacticSlotInput =
      mode === 'FULL' ? { formation: st.formation, roles: [...st.roles], instructions: { ...st.instructions } } : { formation: cur.formation, roles: [...cur.roles], instructions: { ...st.instructions } };
    const r = this.updateTacticSlot(slot, next);
    const warning = r.familiarityHalved ? `포메이션 ${cur.formation} → ${st.formation}: 숙련도 ${Math.round(cur.familiarity)} → ${Math.round(r.slot.familiarity)} (절반)` : undefined;
    return { ...r, styleId, mode, ...(warning ? { warning } : {}) };
  }

  /** 가짜: 요구치 × (스쿼드 평균 OVR·해시) 로 실제값을 흉내 낸다 */
  getStyleFits(): StyleFit[] {
    const s = this.req();
    const squad = this.squadOf(s, s.userClubId);
    const avg = squad.reduce((a, p) => a + p.ovr, 0) / Math.max(1, squad.length);
    return STYLES.map((st) => {
      const reqs = st.requirements.map((r) => ({ ...r, actual: Math.round(r.min * (avg / 62) * (0.82 + (hashString(`${s.gameSeed}|${st.id}|${r.key}`) % 30) / 100)) }));
      const fit = Math.min(1, reqs.reduce((a, r) => a * Math.min(1, r.actual / Math.max(1, r.min)), 1));
      const missing = reqs.filter((r) => r.actual < r.min).map((r) => ({ key: r.key, label: r.label, actual: r.actual, required: r.min }));
      return { styleId: st.id, fit: round2(fit), level: fit >= 0.95 ? 'GOOD' : fit >= 0.8 ? 'OK' : 'POOR', missing };
    });
  }

  /** 가짜: 스타일 강점·약점 교차로 힌트를 만들고 양 팀 대표 선수 수치를 문장에 넣는다 */
  getMatchupPreview(ourSlot: SlotKey, opponentId: ClubId): MatchupPreview {
    const s = this.req();
    const opp = s.clubs[opponentId];
    const me = s.clubs[s.userClubId];
    if (!opp || !me) throw new GameError('NOT_FOUND', `구단 없음: ${opponentId}`);
    const ours = nearestStyle(STYLES, me.tactics[ourSlot].instructions)?.style ?? styleOf('BALANCED');
    const theirs = opp.style ? styleOf(opp.style) : (nearestStyle(STYLES, opp.tactics.A.instructions)?.style ?? styleOf('BALANCED'));
    const best = (id: ClubId, pos: Position) => this.squadOf(s, id).filter((p) => p.primary === pos).sort((a, b) => b.ovr - a.ovr)[0];
    const reason = (sign: 1 | -1) => {
      const [att, def] = sign > 0 ? [best(s.userClubId, 'ST'), best(opponentId, 'CB')] : [best(opponentId, 'ST'), best(s.userClubId, 'CB')];
      const side = sign > 0 ? ['우리', '상대'] : ['상대', '우리'];
      return `${side[0]} ST ${att?.name ?? '?'} 속도 ${att?.attrs.pace ?? '?'} vs ${side[1]} CB ${def?.name ?? '?'} 속도 ${def?.attrs.pace ?? '?'}`;
    };
    const rules: MatchupRuleHint[] = [];
    for (const r of ours.strengths) rules.push({ id: r, dp: 'DP4', sign: 1, size: theirs.weaknesses.includes(r) ? 'L' : 'S', reason: reason(1) });
    for (const r of theirs.strengths) rules.push({ id: r, dp: 'DP4', sign: -1, size: ours.weaknesses.includes(r) ? 'L' : 'M', reason: reason(-1) });
    const w = { S: 1, M: 2, L: 3 } as const;
    rules.sort((a, b) => w[b.size] - w[a.size]);
    const net = rules.reduce((a, r) => a + r.sign * w[r.size], 0) + (ours.goodAgainst.includes(theirs.id) ? 3 : 0) - (ours.badAgainst.includes(theirs.id) ? 3 : 0);
    const styleEdge = clamp(Math.round(net / 3), -2, 2) as MatchupPreview['styleEdge'];
    return { ourSlot, opponentId, opponentStyle: theirs.id, opponentStyleEstimated: !opp.style, rules: rules.slice(0, 6), styleEdge };
  }
  getPlanState(): PlanState {
    const s = this.req();
    const fx = this.nextFixture(s);
    const ps = s.plans[s.userClubId] ?? {};
    const club = s.clubs[s.userClubId];
    return {
      clubId: s.userClubId,
      matchId: fx?.id ?? null,
      opponentId: fx ? (fx.homeId === s.userClubId ? fx.awayId : fx.homeId) : null,
      day: s.time.day,
      draft: ps.draft,
      confirmed: ps.confirmed,
      defaultPlan: club?.defaultPlan,
      preview: fx ? this.resolve(s, s.userClubId, fx) : null,
    };
  }
  validatePlan(plan: MatchPlan): PlanValidationIssue[] {
    const s = this.req();
    const issues: PlanValidationIssue[] = [];
    const { starters, bench } = plan.lineup;
    if (starters.length !== 11) issues.push({ severity: 'ERROR', code: 'STARTERS_COUNT', message: `선발은 11명이어야 합니다 (현재 ${starters.length})` });
    if (bench.length > 7) issues.push({ severity: 'ERROR', code: 'BENCH_COUNT', message: '벤치는 최대 7명입니다' });
    const all = [...starters, ...bench];
    if (new Set(all).size !== all.length) issues.push({ severity: 'ERROR', code: 'DUPLICATE', message: '같은 선수가 두 번 들어가 있습니다' });
    const club = s.clubs[plan.clubId];
    const f = club ? formationOf(club.tactics[plan.startSlot].formation) : undefined;
    starters.forEach((id, i) => {
      const p = s.players[id];
      if (!p) {
        issues.push({ severity: 'ERROR', code: 'UNKNOWN_PLAYER', message: `알 수 없는 선수 ${id}` });
        return;
      }
      if (!available(p)) issues.push({ severity: 'WARNING', code: 'UNAVAILABLE', message: `${p.name}: 출전 불가 (마감 시 자동 대체)`, playerId: id });
      const pos = f?.slots[i]?.position;
      if (pos === 'GK' && p.primary !== 'GK') issues.push({ severity: 'ERROR', code: 'NO_GK', message: '골키퍼 자리에 골키퍼가 아닙니다', playerId: id });
      else if (pos && fitOf(p, pos) === 'UNSUITED') issues.push({ severity: 'WARNING', code: 'UNSUITED', message: `${p.name}: ${pos} 부적합`, playerId: id });
      if (p.condition < 70) issues.push({ severity: 'WARNING', code: 'LOW_CONDITION', message: `${p.name}: 컨디션 ${Math.round(p.condition)}`, playerId: id });
    });
    if (plan.conditionals.length > 3) issues.push({ severity: 'ERROR', code: 'COND_COUNT', message: '조건부 지시는 최대 3개입니다' });
    for (const c of plan.conditionals) {
      if (c.conditions.length === 0 || c.conditions.length > 2) issues.push({ severity: 'ERROR', code: 'COND_SHAPE', message: '조건은 1~2개여야 합니다' });
      if (c.action.kind === 'HT_ADJUST' && !c.conditions.some((k) => k.kind === 'TIME' && k.after === 'HT')) {
        issues.push({ severity: 'ERROR', code: 'HT_ONLY', message: '하프타임 조정은 하프타임 조건과만 쓸 수 있습니다' });
      }
    }
    return issues;
  }
  private checkPlan(s: GameState, plan: MatchPlan): void {
    const errs = this.validatePlan(plan).filter((i) => i.severity === 'ERROR');
    if (errs.length) throw new GameError('INVALID_PLAN', errs[0]?.message ?? '플랜 오류', errs.map((e) => e.message));
    if (plan.clubId !== s.userClubId) throw new GameError('PERMISSION_DENIED', '다른 구단 플랜');
  }
  saveDraft(plan: MatchPlan): PlanRecord {
    const s = clone(this.req());
    this.requireOwner(s);
    if (s.phase !== 'MATCHDAY') throw new GameError('INVALID_PHASE', '경기일이 아닙니다');
    const rec: PlanRecord = { plan: clone(plan), status: 'DRAFT', updatedBy: s.actorUserId, updatedAt: this.ts(s) };
    s.plans[s.userClubId] = { ...(s.plans[s.userClubId] ?? {}), draft: rec };
    this.log(s, 'PLAN_DRAFT_SAVED');
    this.commit(s);
    return rec;
  }
  submitPlan(plan: MatchPlan): PlanRecord {
    const s = clone(this.req());
    this.requireOwner(s);
    if (s.phase !== 'MATCHDAY') throw new GameError('INVALID_PHASE', '경기일이 아닙니다');
    this.checkPlan(s, plan);
    const rec: PlanRecord = { plan: clone(plan), status: 'CONFIRMED', updatedBy: s.actorUserId, updatedAt: this.ts(s) };
    s.plans[s.userClubId] = { draft: undefined, confirmed: rec };
    this.log(s, 'PLAN_SUBMITTED');
    this.commit(s);
    return rec;
  }
  setDefaultPlan(plan: MatchPlan): void {
    const s = clone(this.req());
    this.requireOwner(s);
    this.checkPlan(s, plan);
    const p = clone(plan);
    delete p.opponentOrders;
    p.matchId = null;
    const club = s.clubs[s.userClubId];
    if (club) club.defaultPlan = p;
    this.log(s, 'DEFAULT_PLAN_SET');
    this.commit(s);
  }
  recommendPlan(): MatchPlan {
    const s = this.req();
    const fx = this.nextFixture(s);
    const r = this.resolve(s, s.userClubId, fx);
    const plan = clone(r.plan);
    delete plan.opponentOrders;
    return plan;
  }
  previewResolvedPlan(): ResolvedPlan | null {
    const s = this.req();
    const fx = this.nextFixture(s);
    return fx ? this.resolve(s, s.userClubId, fx) : null;
  }

  // ── 진행 ──────────────────────────────────────────────────────────
  advanceDay(): DayResult {
    const s = clone(this.req());
    const r = this.step(s);
    this.commit(s);
    return r;
  }
  advanceDays(n: number): DayResult[] {
    const s = clone(this.req());
    const out: DayResult[] = [];
    for (let i = 0; i < n && s.phase !== 'SEASON_OVER'; i++) out.push(this.step(s));
    this.commit(s);
    return out;
  }
  advanceToSeasonEnd(): DayResult[] {
    const s = clone(this.req());
    const out: DayResult[] = [];
    while (s.phase !== 'SEASON_OVER') out.push(this.step(s));
    this.commit(s);
    return out;
  }
  startNewSeason(): GameSnapshot {
    const s = clone(this.req());
    if (s.phase !== 'SEASON_OVER') throw new GameError('INVALID_PHASE', '시즌이 끝나지 않았습니다');
    const out = s.pendingOutcome;
    if (out) s.seasonHistory.push(out);
    s.pendingOutcome = undefined;
    // 성장 기록(Player.history) + 가짜 성장·노화
    const grow = mulberry32(s.gameSeed + s.time.season * 7919);
    for (const p of Object.values(s.players)) {
      p.history = [...(p.history ?? []), { season: s.time.season, age: p.age, ovr: p.ovr, clubId: p.clubId, tier: s.settings.tier, apps: p.season.apps, goals: p.season.goals }];
      p.ovr = clamp(p.ovr + (p.age <= 23 ? 2 : p.age >= 31 ? -2 : 0) + Math.round(grow() * 2 - 1), 30, 99);
    }
    const mv = out?.movements?.find((m) => m.clubId === s.userClubId);
    if (mv) s.settings.tier = mv.to;
    s.summaries = {};
    s.records = {};
    this.reports = {};
    this.replays = {};
    s.time = { season: s.time.season + 1, day: 1 };
    s.phase = 'MATCHDAY';
    // 계약 경계(실제 서비스 2.2.1 근사): 우리 구단은 성립 재계약 적용, 재계약 안 한 만료자는 FA 로. AI 는 자동 1시즌 재계약
    const renewals = new Map((s.pendingRenewals ?? []).map((r) => [r.playerId, r]));
    for (const p of this.squadOf(s, s.userClubId)) {
      const r = renewals.get(p.id);
      if (r) p.contract = { seasonsLeft: r.seasons + 1, salary: r.salary, bonusPerSeason: r.bonusPerSeason };
      else if (p.contract.seasonsLeft <= 1) {
        this.movePlayer(s, p, null);
        p.contract = { seasonsLeft: 0, salary: 0 };
        this.inbox(s, 'CONTRACT_EXPIRED', `${p.name} 계약 만료`, `${p.name} 선수의 계약이 끝나 FA 풀로 떠났어요.`, { playerId: p.id, clubId: s.userClubId });
      }
    }
    s.pendingRenewals = [];
    for (const p of Object.values(s.players)) {
      p.age += 1;
      if (p.clubId) p.contract.seasonsLeft = Math.max(1, p.contract.seasonsLeft - 1);
      p.season = { apps: 0, starts: 0, minutes: 0, goals: 0, shots: 0, keyPasses: 0, tackles: 0, redCards: 0, yellowCards: 0 };
      p.condition = 100;
      p.availability.yellowAccum = 0; // 경고 누적만 초기화, 남은 정지는 유지 (D24)
    }
    s.fixtures = genFixtures(s.time.season, userIds(s), mulberry32(s.gameSeed + s.time.season));
    s.plans = {};
    for (const id of userIds(s)) {
      this.ledger(s, id, 'SEASON_BUDGET', ECON.budget);
      this.paySalary(s, id);
    }
    this.mkt(s).signings = 0;
    s.releasedThisSeason = {};
    s.emergencySignedThisSeason = {};
    this.emergencyFill(s);
    this.weekStart(s);
    this.genYouth(s);
    this.log(s, 'SEASON_STARTED', { season: s.time.season });
    this.commit(s);
    return s;
  }
  getSeasonOutcome(season?: SeasonNo): SeasonOutcome | null {
    const s = this.req();
    if (season === undefined) return s.pendingOutcome ?? s.seasonHistory[s.seasonHistory.length - 1] ?? null;
    if (s.pendingOutcome?.season === season) return s.pendingOutcome;
    return s.seasonHistory.find((o) => o.season === season) ?? null;
  }

  private ledger(s: GameState, clubId: ClubId, kind: LedgerKind, amount: number): LedgerEntry {
    const fin = s.finances[clubId];
    const e: LedgerEntry = { season: s.time.season, day: s.time.day, kind, amount, memo: LEDGER_MEMO[kind] };
    if (fin) {
      fin.balance += amount;
      fin.ledger.push(e);
      if (fin.ledger.length > 200) fin.ledger.splice(0, fin.ledger.length - 200);
    }
    return e;
  }
  private paySalary(s: GameState, clubId: ClubId): LedgerEntry {
    const total = this.squadOf(s, clubId).reduce((a, p) => a + p.contract.salary, 0);
    return this.ledger(s, clubId, 'SALARY', -Math.round(total / 28));
  }

  /** 하루 진행 (s 를 제자리 수정) */
  private step(s: GameState): DayResult {
    if (s.phase === 'SEASON_OVER') throw new GameError('INVALID_PHASE', '시즌이 끝났습니다. 새 시즌을 시작하세요');
    const from = { ...s.time };
    const userLedger: LedgerEntry[] = [];
    const matches: MatchSummary[] = [];
    const expired: ProposalId[] = [];
    const notices: string[] = [];
    let userMatchId: MatchId | undefined;
    let userResolvedPlan: ResolvedPlan | undefined;
    let seasonOutcome: SeasonOutcome | undefined;

    if (s.phase === 'MATCHDAY') {
      const day = s.time.day;
      for (const p of Object.values(s.proposals)) {
        if (p.status === 'OPEN' && p.expiresAt.season === s.time.season && p.expiresAt.day === day) {
          p.status = 'EXPIRED';
          expired.push(p.id);
          this.log(s, 'PROPOSAL_EXPIRED', { id: p.id });
        }
      }
      const todays = s.fixtures.filter((f) => f.day === day && f.season === s.time.season && !f.played).sort((a, b) => a.id.localeCompare(b.id));
      for (const fx of todays) {
        const rh = this.resolve(s, fx.homeId, fx);
        const ra = this.resolve(s, fx.awayId, fx);
        const sim = this.simulate(s, fx, rh, ra);
        matches.push(sim.summary);
        s.summaries[fx.id] = sim.summary;
        fx.played = true;
        for (const [side, other, rp] of [[sim.summary.home, sim.summary.away, rh], [sim.summary.away, sim.summary.home, ra]] as const) {
          const kind: LedgerKind = side.goals > other.goals ? 'MATCH_WIN' : side.goals === other.goals ? 'MATCH_DRAW' : 'MATCH_LOSS';
          const amt = kind === 'MATCH_WIN' ? ECON.win : kind === 'MATCH_DRAW' ? ECON.draw : ECON.loss;
          const e = this.ledger(s, side.clubId, kind, amt);
          if (side.clubId === s.userClubId) userLedger.push(e);
          const club = s.clubs[side.clubId];
          if (club) {
            const used = rp.plan;
            club.tactics[used.startSlot].familiarity = clamp(club.tactics[used.startSlot].familiarity + 6, 0, 100);
            const lu = clone(used);
            delete lu.opponentOrders;
            club.lastUsedPlan = lu;
            for (const pid of club.playerIds) {
              const pl = s.players[pid];
              if (!pl) continue;
              pl.morale = clampStep(pl.morale + (kind === 'MATCH_WIN' ? 1 : kind === 'MATCH_LOSS' ? -1 : 0) * (Math.random() < 0.5 ? 1 : 0));
            }
          }
          s.plans[side.clubId] = {};
        }
        if (fx.homeId === s.userClubId || fx.awayId === s.userClubId) {
          userMatchId = fx.id;
          userResolvedPlan = fx.homeId === s.userClubId ? rh : ra;
          this.reports[fx.id] = sim.report;
          this.replays[fx.id] = sim.replay;
          const us = fx.homeId === s.userClubId ? sim.summary.home : sim.summary.away;
          const them = fx.homeId === s.userClubId ? sim.summary.away : sim.summary.home;
          notices.push(`${us.goals}:${them.goals} ${us.goals > them.goals ? '승' : us.goals === them.goals ? '무' : '패'} vs ${s.clubs[them.clubId]?.name ?? ''}`);
          for (const p of Object.values(s.proposals)) {
            if (p.status === 'OPEN' && p.payload.matchId === fx.id) {
              p.status = 'EXPIRED';
              expired.push(p.id);
            }
          }
        }
      }
      if (day === 26) {
        seasonOutcome = this.judge(s);
        s.pendingOutcome = seasonOutcome;
      }
      s.time = { season: s.time.season, day: day + 1 };
      this.daily(s, userLedger);
      if (s.time.day === 27) {
        s.phase = 'OFFSEASON';
        const out = s.pendingOutcome;
        if (out) {
          for (const [cid, amt] of Object.entries(out.prizes)) {
            const e = this.ledger(s, cid, 'PRIZE', amt);
            if (cid === s.userClubId) userLedger.push(e);
          }
          const e = this.ledger(s, out.championId, 'CHAMPION_BONUS', Math.round(ECON.budget * 0.1));
          if (out.championId === s.userClubId) userLedger.push(e);
        }
      }
    } else if (s.phase === 'OFFSEASON') {
      if (s.time.day === 27) {
        s.time = { season: s.time.season, day: 28 };
        this.daily(s, userLedger);
        for (const fin of Object.values(s.finances)) {
          const cap = Math.round(ECON.budget * 0.2);
          const excess = Math.max(0, fin.balance - cap);
          fin.transferOnlyBudget = excess;
          if (fin.clubId === s.userClubId && excess > 0) {
            notices.push(`이월 상한 초과분 ${(excess / 1e6).toFixed(1)}M 은 이적 한정 예산으로 분리됩니다`);
          }
        }
      } else {
        s.phase = 'SEASON_OVER';
        seasonOutcome = s.pendingOutcome;
        notices.push('시즌이 끝났습니다. 리그 화면에서 결산을 확인하세요');
      }
    }
    if (s.phase !== 'SEASON_OVER') this.marketTick(s, notices, userLedger);
    const processedAt = this.ts(s);
    this.log(s, 'DAY_ADVANCED', { from, to: s.time });
    return {
      from,
      to: { ...s.time },
      phaseAfter: s.phase,
      matches,
      userMatchId,
      userResolvedPlan,
      ledger: userLedger,
      expiredProposals: expired,
      seasonOutcome,
      notices,
      processedAt,
    };
  }

  private daily(s: GameState, userLedger: LedgerEntry[]): void {
    if (s.phase === 'MATCHDAY' && WEEK_STARTS.includes(s.time.day)) this.weekStart(s);
    if (s.time.day === LIFE_YOUTH_DEADLINE + 1) this.youthDeadline(s);
    const focus = trainingOf(s.clubs[s.userClubId]).focus;
    for (const p of Object.values(s.players)) {
      const bonus = focus === 'RECOVERY' && p.clubId === s.userClubId ? 4 : 0;
      p.condition = clamp(p.condition + 14 + p.attrs.stamina * 0.3 + bonus, 0, 100);
      if (p.availability.injuryDays > 0) p.availability.injuryDays -= 1;
    }
    for (const club of Object.values(s.clubs)) {
      if (isVirtual(club.id)) continue;
      const tactical = club.id === s.userClubId && focus === 'TACTICAL';
      for (const k of ['A', 'B'] as const) {
        const used = club.lastUsedPlan?.startSlot === k;
        if (tactical) club.tactics[k].familiarity = clamp(club.tactics[k].familiarity + 3, 0, 100);
        else if (!used) club.tactics[k].familiarity = clamp(club.tactics[k].familiarity - 2, 0, 100);
      }
      const e = this.paySalary(s, club.id);
      if (club.id === s.userClubId) userLedger.push(e);
    }
  }

  private judge(s: GameState): SeasonOutcome {
    const table = this.standingsOf(s);
    const labels: SeasonOutcome['labels'] = {};
    const prizes: SeasonOutcome['prizes'] = {};
    for (const r of table) {
      labels[r.clubId] = r.zone === 'PROMOTION' ? 'PROMOTED' : r.zone === 'RELEGATION' ? 'RELEGATED' : 'STAYED';
      const rate = r.position === 1 ? 0.2 : r.position <= 3 ? 0.15 : r.position <= 6 ? 0.1 : r.position <= 10 ? 0.06 : 0.03;
      prizes[r.clubId] = Math.round(ECON.budget * rate);
    }
    const movements: ClubMovement[] = [];
    const push = (rows: StandingRow[], tier: Tier) => {
      for (const r of rows) {
        const up = r.position <= PROMOTE[tier];
        const down = r.position > rows.length - RELEGATE[tier];
        if (!up && !down) continue;
        const to = TIERS[TIERS.indexOf(tier) + (up ? -1 : 1)] ?? tier;
        movements.push({ clubId: r.clubId, from: tier, to, kind: up ? 'PROMOTED' : 'RELEGATED', position: r.position, isHuman: !!s.clubs[r.clubId]?.isHuman });
      }
    };
    push(table, s.settings.tier);
    if (hasVirtual(s)) otherTiers(s).forEach((t, g) => push(this.virtualLeague(s, g, true).table, t));
    return {
      season: s.time.season, tier: s.settings.tier, leagueId: leagueIdOf(s.settings.tier), finalTable: table, championId: table[0]?.clubId ?? '', labels, prizes,
      // 구 가짜 세이브(가상 구단 없음)는 실제 이동 없음 → UI 는 labels 폴백
      ...(hasVirtual(s) ? { movements } : {}),
    };
  }

  private strengthOf(s: GameState, rp: ResolvedPlan): number {
    const club = s.clubs[rp.plan.clubId];
    if (!club) return 50;
    const f = formationOf(club.tactics[rp.plan.startSlot].formation);
    const vals = rp.plan.lineup.starters.map((id, i) => {
      const p = s.players[id];
      if (!p) return 30;
      return p.ovr * FIT_MULT[fitOf(p, f.slots[i]?.position ?? 'CM')] * condEff(p.condition);
    });
    const fam = club.tactics[rp.plan.startSlot].familiarity;
    return (vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)) * (0.95 + fam / 2000);
  }

  private simulate(s: GameState, fx: Fixture, rh: ResolvedPlan, ra: ResolvedPlan) {
    const rng = mulberry32(hashString(`${s.gameSeed}|${fx.id}`));
    const home = s.clubs[fx.homeId];
    const away = s.clubs[fx.awayId];
    if (!home || !away) throw new GameError('NOT_FOUND', fx.id);
    const ih = home.tactics[rh.plan.startSlot].instructions;
    const ia = away.tactics[ra.plan.startSlot].instructions;
    const sh = this.strengthOf(s, rh);
    const sa = this.strengthOf(s, ra);
    // 가짜 상성: 간단한 규칙 몇 개
    const tac = (me: TeamInstructions, op: TeamInstructions) =>
      (me.press >= 1 && op.directness <= 0 ? 0.08 : 0) +
      (me.directness >= 1 && op.line >= 1 ? 0.08 : 0) +
      (me.width >= 1 && op.width <= -1 ? 0.06 : 0) +
      (me.counter && op.mentality >= 1 ? 0.1 : 0) -
      (me.line >= 2 && op.directness >= 1 ? 0.06 : 0);
    const th = tac(ih, ia);
    const ta = tac(ia, ih);
    const lamH = clamp(1.3 * Math.exp((sh - sa) / 18 + th) + 0.12 + ih.mentality * 0.08, 0.2, 4);
    const lamA = clamp(1.3 * Math.exp((sa - sh) / 18 + ta) + away.tactics[ra.plan.startSlot].instructions.mentality * 0.08, 0.2, 4);
    const gh = poisson(rng, lamH);
    const ga = poisson(rng, lamA);
    const xgH = round2(lamH * (0.75 + rng() * 0.5));
    const xgA = round2(lamA * (0.75 + rng() * 0.5));
    const shotsH = Math.max(gh, Math.round(xgH * 7 + rng() * 4) + 2);
    const shotsA = Math.max(ga, Math.round(xgA * 7 + rng() * 4) + 2);
    const possH = round2(clamp(0.5 + (sh - sa) / 150 - 0.03 * (ih.directness - ia.directness) + (rng() - 0.5) * 0.08, 0.3, 0.7));

    const scorerOf = (rp: ResolvedPlan): PlayerId => {
      const club = s.clubs[rp.plan.clubId];
      const f = club ? formationOf(club.tactics[rp.plan.startSlot].formation) : undefined;
      const w: number[] = rp.plan.lineup.starters.map((_, i) => {
        const pos = f?.slots[i]?.position ?? 'CM';
        return pos === 'ST' ? 5 : pos === 'W' || pos === 'AM' ? 3 : pos === 'CM' ? 1.5 : pos === 'GK' ? 0 : 0.6;
      });
      let r = rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < w.length; i++) {
        r -= w[i] ?? 0;
        if (r <= 0) return rp.plan.lineup.starters[i] ?? '';
      }
      return rp.plan.lineup.starters[0] ?? '';
    };
    const chances: ChanceType[] = ['CROSS', 'THROUGH', 'CUTBACK', 'LONG', 'SOLO', 'COUNTER', 'CORNER'];
    // 추가시간: 88분 이후 이벤트는 90+N 으로 (계약 1.2 addedMinute)
    const at = (): { minute: number; addedMinute?: number } => {
      const m = 1 + Math.floor(rng() * 94);
      return m > 90 ? { minute: 90, addedMinute: m - 90 } : { minute: m };
    };
    const goals: { minute: number; addedMinute?: number; clubId: ClubId; playerId: PlayerId; chance: ChanceType }[] = [];
    for (let i = 0; i < gh; i++) goals.push({ ...at(), clubId: fx.homeId, playerId: scorerOf(rh), chance: chances[Math.floor(rng() * chances.length)] ?? 'CROSS' });
    for (let i = 0; i < ga; i++) goals.push({ ...at(), clubId: fx.awayId, playerId: scorerOf(ra), chance: chances[Math.floor(rng() * chances.length)] ?? 'CROSS' });
    goals.sort((a, b) => a.minute - b.minute || (a.addedMinute ?? 0) - (b.addedMinute ?? 0));
    const yellowCards = [[fx.homeId, rh], [fx.awayId, ra]].flatMap(([clubId, rp]) =>
      Array.from({ length: Math.floor(rng() * 4) }, () => ({ ...at(), clubId: clubId as ClubId, playerId: (rp as ResolvedPlan).plan.lineup.starters[1 + Math.floor(rng() * 10)] ?? '' })),
    );
    const extra = (clubId: ClubId, shots: number, g: number) => ({
      sot: Math.max(g, Math.round(shots * (0.28 + rng() * 0.12))),
      corners: 2 + Math.floor(rng() * 7),
      yellows: yellowCards.filter((y) => y.clubId === clubId).length,
    });
    const exH = extra(fx.homeId, shotsH, gh);
    const exA = extra(fx.awayId, shotsA, ga);
    const scoreAt = (minute: number): [number, number] => [
      goals.filter((g) => g.minute <= minute && g.clubId === fx.homeId).length,
      goals.filter((g) => g.minute <= minute && g.clubId === fx.awayId).length,
    ];

    // 조건부 지시 발동
    const triggers: { minute: number; clubId: ClubId; text: string }[] = [];
    for (const [rp, isHome] of [[rh, true], [ra, false]] as const) {
      for (const c of rp.plan.conditionals) {
        if (!c.enabled) continue;
        for (const m of [45, 50, 55, 60, 65, 70, 75, 80, 85]) {
          const [h, a] = scoreAt(m);
          const diff = isHome ? h - a : a - h;
          const ok = c.conditions.every((k) =>
            k.kind === 'TIME'
              ? m >= (k.after === 'HT' ? 45 : k.after) && (k.after !== 'HT' || m === 45)
              : k.state === 'LEAD'
                ? diff >= (k.minDiff ?? 1)
                : k.state === 'TRAIL'
                  ? -diff >= (k.minDiff ?? 1)
                  : diff === 0,
          );
          if (ok) {
            triggers.push({ minute: m, clubId: rp.plan.clubId, text: conditionalText(c) });
            break;
          }
        }
      }
    }

    // 선수 상태
    const subs: { minute: number; clubId: ClubId; out: PlayerId; in: PlayerId }[] = [];
    const injuries: { minute: number; clubId: ClubId; playerId: PlayerId; days: number }[] = [];
    for (const [rp, instr] of [[rh, ih], [ra, ia]] as const) {
      const drain = 26 + instr.press * 2 + instr.tempo;
      const starters = rp.plan.lineup.starters;
      const nSubs = 2 + Math.floor(rng() * 2);
      const byCond = [...starters].filter((id) => s.players[id]?.primary !== 'GK').sort((a, b) => (s.players[a]?.condition ?? 0) - (s.players[b]?.condition ?? 0));
      const benchAvail = rp.plan.lineup.bench.filter((id) => s.players[id]?.primary !== 'GK');
      for (let i = 0; i < nSubs && i < benchAvail.length; i++) {
        const out = byCond[i];
        const inn = benchAvail[i];
        if (out && inn) subs.push({ minute: 58 + Math.floor(rng() * 25), clubId: rp.plan.clubId, out, in: inn });
      }
      for (const id of starters) {
        const p = s.players[id];
        if (!p) continue;
        const sub = subs.find((x) => x.out === id);
        const mins = sub ? sub.minute : 90;
        p.condition = clamp(p.condition - drain * (mins / 90) - rng() * 6 + p.attrs.stamina * 0.15, 20, 100);
        p.season.apps++;
        p.season.starts++;
        p.season.minutes += mins;
        if (rng() < 0.012) {
          const days = 1 + Math.floor(rng() * 7);
          p.availability.injuryDays = days;
          injuries.push({ minute: 1 + Math.floor(rng() * 89), clubId: rp.plan.clubId, playerId: id, days });
        }
      }
      for (const sb of subs.filter((x) => x.clubId === rp.plan.clubId)) {
        const p = s.players[sb.in];
        if (!p) continue;
        const mins = 90 - sb.minute;
        p.condition = clamp(p.condition - drain * (mins / 90), 20, 100);
        p.season.apps++;
        p.season.minutes += mins;
      }
      // 출장 정지 소화: 구단이 경기를 치르고 선수가 안 뛰면 −1
      const played = new Set([...starters, ...subs.filter((x) => x.clubId === rp.plan.clubId).map((x) => x.in)]);
      for (const id of s.clubs[rp.plan.clubId]?.playerIds ?? []) {
        const p = s.players[id];
        if (p && !played.has(id) && p.availability.suspendedMatches > 0) p.availability.suspendedMatches--;
      }
    }
    for (const y of yellowCards) this.applyYellow(s, y.playerId);
    for (const g of goals) {
      const p = s.players[g.playerId];
      if (p) {
        p.season.goals++;
        p.season.shots++;
      }
    }

    const lite = (clubId: ClubId, rp: ResolvedPlan, g: number, xg: number, shots: number, poss: number, xgOpp: number): TeamSummaryLite => {
      const club = s.clubs[clubId];
      const slot = club?.tactics[rp.plan.startSlot];
      const z = (a: number, r: number) => ({ attempts: a, successes: Math.round(a * r) });
      return {
        clubId,
        goals: g,
        xg,
        shots,
        possession: poss,
        formation: slot?.formation ?? '4-4-2',
        instructions: slot ? clone(slot.instructions) : BALANCED_INSTR,
        zonePass: { z0: z(50 + Math.round(rng() * 20), 0.75 + rng() * 0.15), z1: z(35 + Math.round(rng() * 15), 0.55 + rng() * 0.15), z2: z(18 + Math.round(rng() * 10), 0.3 + rng() * 0.15) },
        ruleFires: { R1: Math.round(rng() * 8), R2: Math.round(rng() * 4), R5: Math.round(rng() * 3) },
        xPts: xPoints(xg, xgOpp),
      };
    };
    const summary: MatchSummary = {
      matchId: fx.id,
      season: fx.season,
      day: fx.day,
      home: lite(fx.homeId, rh, gh, xgH, shotsH, possH, xgA),
      away: lite(fx.awayId, ra, ga, xgA, shotsA, round2(1 - possH), xgH),
      engineVersion: 'fake-0',
      seed: hashString(fx.id),
    };

    // 리포트·중계 (사용자 경기만 쓰이지만 계산은 단순해서 모두 만든다)
    const userIsHome = fx.homeId === s.userClubId;
    const usId = userIsHome ? fx.homeId : fx.awayId;
    const themId = userIsHome ? fx.awayId : fx.homeId;
    const us = userIsHome ? summary.home : summary.away;
    const them = userIsHome ? summary.away : summary.home;
    const nameOf = (id: PlayerId) => s.players[id]?.name ?? '선수';
    const clubName = (id: ClubId) => s.clubs[id]?.shortName ?? id;

    const ruleIds: RuleId[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R10', 'TEMPO'];
    const ruleXg: Partial<Record<RuleId, number>> = {};
    for (const r of ruleIds) ruleXg[r] = round2((rng() - 0.5) * 0.6);
    const factorText: Record<string, (b: 'US' | 'THEM', n: number) => string> = {
      R1: (b, n) => (b === 'US' ? `전방 압박으로 상대 빌드업 ${n}회 차단` : `상대 압박에 빌드업 ${n}회 끊김`),
      R2: (b, n) => (b === 'US' ? `롱볼로 압박을 넘겨 ${n}회 전진` : `상대 롱볼에 뒷공간 ${n}회 노출`),
      R3: (b, n) => (b === 'US' ? `낮은 블록으로 상대 슈팅 ${n}회 억제` : `상대 밀집 수비에 막혀 ${n}회 무산`),
      R4: (b, n) => (b === 'US' ? `넓은 폭으로 크로스 찬스 ${n}회` : `측면에서 크로스 ${n}회 허용`),
      R5: (b, n) => (b === 'US' ? `역습으로 ${n}회 찬스 창출` : `공격 가담 뒤 역습 ${n}회 허용`),
      R6: (b, n) => (b === 'US' ? `오프사이드 트랩 → 상대 오프사이드 ${n}회` : `상대 트랩에 오프사이드 ${n}회`),
      R7: (b, n) => (b === 'US' ? `중원 수적 우위로 점유 ${n}회 유지` : `중원 수적 열세로 ${n}회 턴오버`),
      R10: (b, n) => (b === 'US' ? `공략 측면 돌파 ${n}회` : `약한 측면을 ${n}회 공략당함`),
      TEMPO: (b, n) => (b === 'US' ? `템포 조절로 턴오버 ${n}회 감소` : `빠른 템포로 턴오버 ${n}회`),
    };
    const keyFactors: FactorCard[] = ruleIds
      .map((r) => ({ r, x: ruleXg[r] ?? 0 }))
      .sort((a, b) => Math.abs(b.x) - Math.abs(a.x))
      .slice(0, 3)
      .map(({ r, x }) => {
        const beneficiary = x >= 0 ? 'US' : 'THEM';
        const count = 1 + Math.floor(rng() * 7);
        return { ruleId: r, beneficiary, count, leagueAvgCount: round2(2 + rng() * 3), xg: x, text: (factorText[r] ?? (() => r))(beneficiary, count) };
      });
    const tacticsSum = round2(keyFactors.reduce((a, k) => a + k.xg, 0));
    const luckDelta = round2(us.goals - them.goals - (us.xg - them.xg));
    const timeline: TimelineItem[] = [
      ...goals.map((g) => ({ minute: g.minute, ...(g.addedMinute ? { addedMinute: g.addedMinute } : {}), kind: 'GOAL' as const, clubId: g.clubId, text: `${nameOf(g.playerId)} 골 (${clubName(g.clubId)})` })),
      // TimelineKind 에 YELLOW_CARD 가 없어 캐스트 (계약 부족분)
      ...yellowCards.map((y) => ({ minute: y.minute, ...(y.addedMinute ? { addedMinute: y.addedMinute } : {}), kind: 'YELLOW_CARD' as unknown as 'RED_CARD', clubId: y.clubId, text: `${nameOf(y.playerId)} 경고` })),
      ...triggers.map((t) => ({ minute: t.minute, kind: 'TRIGGER' as const, clubId: t.clubId, text: `지시 발동: ${t.text}` })),
      ...subs.map((x) => ({ minute: x.minute, kind: 'SUB' as const, clubId: x.clubId, text: `${nameOf(x.out)} ↔ ${nameOf(x.in)}` })),
      ...injuries.map((x) => ({ minute: x.minute, kind: 'INJURY' as const, clubId: x.clubId, text: `${nameOf(x.playerId)} 부상 (${x.days}일)` })),
    ].sort((a, b) => a.minute - b.minute || ((a as { addedMinute?: number }).addedMinute ?? 0) - ((b as { addedMinute?: number }).addedMinute ?? 0));
    const worst = keyFactors.filter((k) => k.beneficiary === 'THEM');
    const patchFor: Partial<Record<RuleId, Partial<TeamInstructions>>> = {
      R1: { directness: 2 }, R5: { mentality: 0 }, R3: { width: 2 }, R6: { tempo: -1 }, R2: { line: -1 }, R4: { width: 1 },
    };
    const suggestions: Suggestion[] = worst.slice(0, 2).map((k) => ({
      ruleId: k.ruleId,
      text: RULES.find((r) => r.id === k.ruleId)?.counter ?? '',
      instructionPatch: patchFor[k.ruleId],
    }));
    const prevPts = Object.values(s.summaries)
      .filter((m) => m.season === fx.season && (m.home.clubId === usId || m.away.clubId === usId))
      .reduce(
        (acc, m) => {
          const me = m.home.clubId === usId ? m.home : m.away;
          const op = m.home.clubId === usId ? m.away : m.home;
          return { expected: acc.expected + me.xPts, actual: acc.actual + (me.goals > op.goals ? 3 : me.goals === op.goals ? 1 : 0) };
        },
        { expected: 0, actual: 0 },
      );
    const report: MatchReport = {
      matchId: fx.id,
      clubId: usId,
      opponentId: themId,
      summary: {
        goalsFor: us.goals, goalsAgainst: them.goals, xgFor: us.xg, xgAgainst: them.xg, possession: us.possession, shotsFor: us.shots, shotsAgainst: them.shots, isHome: userIsHome,
        // 계약 밖 선택 필드 (UI 는 있으면 표시): 1.2 ReportSummary 에는 새 통계가 없다
        ...{
          shotsOnTargetFor: (userIsHome ? exH : exA).sot,
          shotsOnTargetAgainst: (userIsHome ? exA : exH).sot,
          cornersFor: (userIsHome ? exH : exA).corners,
          cornersAgainst: (userIsHome ? exA : exH).corners,
          yellowCardsFor: (userIsHome ? exH : exA).yellows,
          yellowCardsAgainst: (userIsHome ? exA : exH).yellows,
          possessionTime: round2(clamp(us.possession + (rng() - 0.5) * 0.06, 0.25, 0.75)),
        },
      },
      luck: {
        level: luckDelta <= -1 ? 'UNLUCKY' : luckDelta >= 1 ? 'LUCKY' : 'NEUTRAL',
        delta: luckDelta,
        text: luckDelta <= -1 ? '기대보다 결과가 나빴어요. 경기 내용은 괜찮았습니다' : luckDelta >= 1 ? '기대 이상으로 운이 따랐어요' : '경기 내용대로의 결과입니다',
      },
      keyFactors,
      factorBars: { strength: round2(((userIsHome ? sh - sa : sa - sh) / 20) * 1.2), prep: round2((rng() - 0.5) * 0.3), state: round2((rng() - 0.5) * 0.2), tactics: tacticsSum, luck: luckDelta },
      zoneFlow: [
        { zone: 0, label: '빌드업 (Z0→Z1)', passRate: us.zonePass.z0.successes / Math.max(1, us.zonePass.z0.attempts), leagueAvg: 0.8 },
        { zone: 1, label: '전진 (Z1→Z2)', passRate: us.zonePass.z1.successes / Math.max(1, us.zonePass.z1.attempts), leagueAvg: 0.62 },
        { zone: 2, label: '마무리 (Z2→슈팅)', passRate: us.zonePass.z2.successes / Math.max(1, us.zonePass.z2.attempts), leagueAvg: 0.37 },
      ],
      timeline,
      suggestions,
      seasonPoints: {
        expected: round2(prevPts.expected + us.xPts),
        actual: prevPts.actual + (us.goals > them.goals ? 3 : us.goals === them.goals ? 1 : 0),
      },
      debug: { ruleXg, conservationError: 0 },
    };

    const lines: CommentaryLine[] = [];
    const neutral = [
      (c: string) => `${c}, 후방에서 천천히 공을 돌립니다`,
      (c: string) => `${c}의 측면 돌파 시도 — 수비에 막힙니다`,
      (c: string) => `${c}, 중원에서 공을 끊어냅니다`,
      (c: string) => `${c}의 크로스, 골키퍼가 잡아냅니다`,
      (c: string) => `${c}, 스루패스를 노렸지만 조금 길었습니다`,
    ];
    // 2.4.0 2D 큐: rng 순서를 바꾸지 않도록 해시로만 만든다
    const hq = (k: string) => hashString(`${fx.id}|${k}`);
    const LANES: Lane[] = ['L', 'C', 'R'];
    const teamOf = (c: ClubId): 'HOME' | 'AWAY' => (c === fx.homeId ? 'HOME' : 'AWAY');
    const startersOf = (c: ClubId) => (c === fx.homeId ? rh : ra).plan.lineup.starters;
    lines.push({ minute: 0, kind: 'PERIOD', event: 'KICK_OFF', pitch: { team: 'HOME', zone: 1, lane: 'C' }, text: '킥오프!', score: [0, 0] });
    for (let m = 3; m < 90; m += 3 + Math.floor(rng() * 4)) {
      const c = rng() < possH ? fx.homeId : fx.awayId;
      const tpl = neutral[Math.floor(rng() * neutral.length)] ?? neutral[0];
      const chance = rng() < 0.25;
      const lane = LANES[hq(`l${m}`) % 3] ?? 'C';
      const pitch: PitchCue = chance
        ? { team: teamOf(c), zone: 2, lane, playerId: startersOf(c)[7 + (hq(`p${m}`) % 4)], chance: chances[hq(`c${m}`) % chances.length] ?? 'CROSS', onTarget: hq(`o${m}`) % 3 === 0 }
        : { team: teamOf(c), zone: ([0, 1, 1, 2] as const)[hq(`z${m}`) % 4] ?? 1, lane };
      lines.push({ minute: m, kind: chance ? 'CHANCE' : 'NEUTRAL', clubId: c, ...(chance ? { event: 'SHOT' as const } : {}), pitch, text: tpl ? tpl(clubName(c)) : '', score: scoreAt(m) });
      if (m < 45 && m + 4 >= 45) lines.push({ minute: 45, kind: 'PERIOD', event: 'HALF_TIME', text: '전반 종료', score: scoreAt(45) });
    }
    for (const g of goals) lines.push({ minute: g.minute, ...(g.addedMinute ? { addedMinute: g.addedMinute } : {}), kind: 'GOAL', clubId: g.clubId, event: 'GOAL', pitch: { team: teamOf(g.clubId), zone: 2, lane: LANES[hq(`g${g.minute}`) % 3] ?? 'C', playerId: g.playerId, chance: g.chance, onTarget: true }, text: `골! ${nameOf(g.playerId)} (${clubName(g.clubId)})`, score: scoreAt(g.minute) });
    for (const y of yellowCards) lines.push({ minute: y.minute, ...(y.addedMinute ? { addedMinute: y.addedMinute } : {}), kind: 'CARD', clubId: y.clubId, event: 'YELLOW_CARD', text: `경고! ${clubName(y.clubId)} ${nameOf(y.playerId)}`, score: scoreAt(y.minute) });
    for (const t of triggers) lines.push({ minute: t.minute, kind: 'TACTIC', clubId: t.clubId, event: 'TRIGGER_FIRED', text: `[전술] ${clubName(t.clubId)} 지시 발동: ${t.text}`, score: scoreAt(t.minute) });
    for (const x of subs) lines.push({ minute: x.minute, kind: 'SUB', clubId: x.clubId, event: 'SUBSTITUTION', text: `교체: ${nameOf(x.out)} → ${nameOf(x.in)}`, score: scoreAt(x.minute) });
    for (const x of injuries) lines.push({ minute: x.minute, kind: 'CARD', clubId: x.clubId, event: 'INJURY', text: `${nameOf(x.playerId)} 부상으로 쓰러집니다`, score: scoreAt(x.minute) });
    const order: Record<string, number> = { PERIOD: 0, GOAL: 1 };
    const added = (l: CommentaryLine) => (l as CommentaryLine & { addedMinute?: number }).addedMinute ?? 0;
    lines.sort((a, b) => a.minute - b.minute || added(a) - added(b) || (order[a.kind] ?? 2) - (order[b.kind] ?? 2));
    lines.push({ minute: 90, kind: 'PERIOD', event: 'FULL_TIME', text: `경기 종료 ${gh} : ${ga}`, score: [gh, ga] });
    const momentum = Array.from({ length: 18 }, () => round2(clamp((possH - 0.5) * 2 + (rng() - 0.5) * 1.2, -1, 1)));
    const zoneBars = Array.from({ length: 18 }, () => {
      const a = rng() + 0.3;
      const b = rng() + 0.3;
      const c = rng() * 0.8 + 0.1;
      const t = a + b + c;
      return [round2(a / t), round2(b / t), round2(c / t)] as [number, number, number];
    });
    const ballTrack: NonNullable<MatchReplay['ballTrack']> = Array.from({ length: 70 }, (_, i) => {
      const t = hq(`bt${i}`) % 100 < possH * 100 ? 0 : 1;
      return [Math.min(90, 1 + Math.floor(i * 1.3)), t, ([0, 1, 1, 2] as const)[hq(`bz${i}`) % 4] ?? 1, (hq(`bl${i}`) % 3) as 0 | 1 | 2];
    });
    const replay: MatchReplay = {
      matchId: fx.id,
      homeId: fx.homeId,
      awayId: fx.awayId,
      lines,
      momentum,
      zoneBars,
      formations: { home: summary.home.formation, away: summary.away.formation },
      starters: { home: [...rh.plan.lineup.starters], away: [...ra.plan.lineup.starters] },
      ballTrack,
    };
    return { summary, report, replay };
  }

  // ── 리포트 ─────────────────────────────────────────────────────────
  getReport(matchId: MatchId): MatchReport {
    this.req();
    const r = this.reports[matchId];
    if (!r) throw new GameError('NOT_FOUND', '리포트가 없습니다 (사용자 구단 경기만 제공)');
    return r;
  }
  getMatchReplay(matchId: MatchId): MatchReplay {
    this.req();
    const r = this.replays[matchId];
    if (!r) throw new GameError('NOT_FOUND', '중계 데이터가 없습니다');
    return r;
  }

  // ── 코치 제안 ──────────────────────────────────────────────────────
  private baseBundlePlan(s: GameState): MatchPlan {
    const ps = s.plans[s.userClubId] ?? {};
    return clone(ps.confirmed?.plan ?? ps.draft?.plan ?? this.recommendPlan());
  }
  private diffOf(s: GameState, base: MatchPlan, patch: PlanChangePatch): ProposalDiffItem[] {
    const out: ProposalDiffItem[] = [];
    const nm = (id?: PlayerId) => (id ? (s.players[id]?.name ?? id) : '없음');
    if (patch.lineup) {
      patch.lineup.starters.forEach((id, i) => {
        const b = base.lineup.starters[i];
        if (b !== id) out.push({ path: `lineup.starters[${i}]`, label: `선발 ${i + 1}번 자리`, before: nm(b), after: nm(id) });
      });
      const bb = base.lineup.bench.join(',');
      if (bb !== patch.lineup.bench.join(',')) out.push({ path: 'lineup.bench', label: '벤치', before: `${base.lineup.bench.length}명`, after: `${patch.lineup.bench.length}명 (변경)` });
    }
    if (patch.startSlot && patch.startSlot !== base.startSlot) out.push({ path: 'startSlot', label: '시작 슬롯', before: base.startSlot, after: patch.startSlot });
    if (patch.instructions) {
      const club = s.clubs[s.userClubId];
      const cur = club?.tactics[patch.instructions.slot].instructions;
      const labels: Record<string, string> = { mentality: '공격 성향', press: '압박 강도', line: '수비 라인', width: '경기 폭', tempo: '템포', directness: '패스 방식', counter: '역습', offsideTrap: '오프사이드 트랩' };
      for (const [k, v] of Object.entries(patch.instructions.patch)) {
        const before = cur ? String(cur[k as keyof TeamInstructions]) : '?';
        if (before !== String(v)) out.push({ path: `instructions.${patch.instructions.slot}.${k}`, label: `[${patch.instructions.slot}] ${labels[k] ?? k}`, before, after: String(v) });
      }
    }
    if (patch.conditionals) out.push({ path: 'conditionals', label: '조건부 지시', before: `${base.conditionals.length}개`, after: patch.conditionals.map(conditionalText).join(' / ') || '없음' });
    if (patch.opponentOrders !== undefined) out.push({ path: 'opponentOrders', label: '상대 맞춤 지시', before: base.opponentOrders ? '있음' : '없음', after: patch.opponentOrders ? '변경' : '제거' });
    return out;
  }
  propose(input: ProposalInput): Proposal {
    const s = clone(this.req());
    this.requireCoach(s);
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 80) throw new GameError('PROPOSAL_INVALID', '사유는 1~80자로 입력하세요');
    const mine = Object.values(s.proposals).filter((p) => p.authorId === s.actorUserId && p.status === 'OPEN');
    if (mine.length >= 5) throw new GameError('PROPOSAL_LIMIT', '동시에 열린 제안은 최대 5개입니다');
    const fx = this.nextFixture(s);
    if (!fx) throw new GameError('INVALID_PHASE', '다음 경기가 없습니다');
    const diff = this.diffOf(s, this.baseBundlePlan(s), input.payload.patch);
    if (diff.length === 0) throw new GameError('PROPOSAL_INVALID', '바뀐 내용이 없습니다');
    const paths = diff.map((d) => d.path).sort().join('|');
    if (mine.some((p) => p.diff.map((d) => d.path).sort().join('|') === paths)) throw new GameError('PROPOSAL_DUPLICATE', '같은 항목을 바꾸는 제안이 이미 있습니다');
    const id = `pr-${s.seq + 1}`;
    const prop: Proposal = {
      id,
      clubId: s.userClubId,
      authorId: s.actorUserId,
      authorRole: 'TAC',
      kind: 'PLAN_CHANGE',
      payload: { kind: 'PLAN_CHANGE', matchId: fx.id, patch: clone(input.payload.patch) },
      reason,
      diff,
      reactions: [],
      createdAt: this.ts(s),
      expiresAt: { season: fx.season, day: fx.day },
      status: 'OPEN',
    };
    s.proposals[id] = prop;
    this.log(s, 'PROPOSAL_CREATED', { id });
    this.commit(s);
    return prop;
  }
  react(proposalId: ProposalId, choice: 'FOR' | 'AGAINST', reason?: string): Proposal {
    const s = clone(this.req());
    this.requireCoach(s);
    const p = s.proposals[proposalId];
    if (!p) throw new GameError('NOT_FOUND', proposalId);
    if (p.status !== 'OPEN') throw new GameError('PROPOSAL_NOT_OPEN', '열린 제안이 아닙니다');
    p.reactions = [...p.reactions.filter((r) => r.userId !== s.actorUserId), { userId: s.actorUserId, choice, reason }];
    this.log(s, 'PROPOSAL_REACTED', { id: proposalId, choice });
    this.commit(s);
    return p;
  }
  approve(proposalId: ProposalId, edits?: PlanChangePatch): ApproveResult {
    const s = clone(this.req());
    this.requireOwner(s);
    const p = s.proposals[proposalId];
    if (!p) throw new GameError('NOT_FOUND', proposalId);
    if (p.status !== 'OPEN') throw new GameError('PROPOSAL_NOT_OPEN', '열린 제안이 아닙니다');
    const patch = edits ?? p.payload.patch;
    const plan = this.baseBundlePlan(s);
    if (patch.lineup) plan.lineup = clone(patch.lineup);
    if (patch.startSlot) plan.startSlot = patch.startSlot;
    if (patch.conditionals) plan.conditionals = clone(patch.conditionals);
    if (patch.opponentOrders === null) delete plan.opponentOrders;
    else if (patch.opponentOrders) plan.opponentOrders = clone(patch.opponentOrders);
    const details = [
      ...this.validatePlan(plan).filter((i) => i.severity === 'ERROR').map((i) => i.message),
      ...plan.lineup.starters.filter((id) => !available(s.players[id])).map((id) => `${s.players[id]?.name ?? id} 출전 불가`),
    ];
    const ts = this.ts(s);
    if (details.length) {
      p.status = 'STALE';
      p.resolvedAt = ts;
      p.resolvedBy = s.actorUserId;
      this.commit(s);
      return { ok: false, proposal: p, reason: 'STALE', details };
    }
    const club = s.clubs[s.userClubId];
    if (patch.instructions && club) {
      const slot = club.tactics[patch.instructions.slot];
      slot.instructions = { ...slot.instructions, ...patch.instructions.patch };
      if (slot.instructions.line < 1) slot.instructions.offsideTrap = false;
    }
    s.plans[s.userClubId] = { confirmed: { plan, status: 'CONFIRMED', updatedBy: s.actorUserId, updatedAt: ts, sourceProposalId: p.id } };
    p.status = 'APPROVED';
    p.resolvedBy = s.actorUserId;
    p.resolvedAt = ts;
    const myPaths = new Set(p.diff.map((d) => d.path));
    const superseded: ProposalId[] = [];
    for (const o of Object.values(s.proposals)) {
      if (o.id !== p.id && o.status === 'OPEN' && o.diff.some((d) => myPaths.has(d.path))) {
        o.status = 'SUPERSEDED';
        o.supersededBy = p.id;
        superseded.push(o.id);
      }
    }
    this.log(s, 'PROPOSAL_APPROVED', { id: p.id, edited: !!edits });
    this.commit(s);
    return { ok: true, proposal: p, superseded };
  }
  reject(proposalId: ProposalId, note?: string): Proposal {
    const s = clone(this.req());
    this.requireOwner(s);
    const p = s.proposals[proposalId];
    if (!p) throw new GameError('NOT_FOUND', proposalId);
    if (p.status !== 'OPEN') throw new GameError('PROPOSAL_NOT_OPEN', '열린 제안이 아닙니다');
    p.status = 'REJECTED';
    p.resolutionNote = note;
    p.resolvedBy = s.actorUserId;
    p.resolvedAt = this.ts(s);
    this.log(s, 'PROPOSAL_REJECTED', { id: p.id });
    this.commit(s);
    return p;
  }
  listProposals(filter: { status?: ProposalStatus } = {}): Proposal[] {
    return Object.values(this.req().proposals)
      .filter((p) => !filter.status || p.status === filter.status)
      .sort((a, b) => b.createdAt.seq - a.createdAt.seq);
  }

  // ── 로그 ──────────────────────────────────────────────────────────
  logEvent(kind: UiLogKind, data?: Record<string, unknown>): void {
    if (!this.state) return;
    // 가짜 구현: 리렌더를 피하려고 스냅샷 교체 없이 로그만 덧붙인다
    this.log(this.state, kind, data);
    this.save();
  }
  exportActionLog(): string {
    return JSON.stringify(this.req().actionLog, null, 2);
  }

  // ── 개발자 ────────────────────────────────────────────────────────
  setTacCap(cap: TacticCap): void {
    const s = clone(this.req());
    s.settings.tacCap = cap;
    this.commit(s);
  }
  resimulate(matchId: MatchId, overrides: ResimulateOverrides = {}): MatchReport {
    const base = this.getReport(matchId);
    const r = clone(base);
    const factor = overrides.tacticsEnabled === false ? 0 : (overrides.tacCap ?? this.req().settings.tacCap) / 0.7;
    const disabled = new Set(overrides.disabledRules ?? []);
    const ruleXg: Partial<Record<RuleId, number>> = {};
    for (const [k, v] of Object.entries(base.debug?.ruleXg ?? {}) as [RuleId, number][]) ruleXg[k] = disabled.has(k) ? 0 : round2(v * factor);
    r.debug = { ruleXg, conservationError: 0 };
    r.keyFactors = r.keyFactors.filter((k) => !disabled.has(k.ruleId)).map((k) => ({ ...k, xg: round2(k.xg * factor) }));
    r.factorBars = { ...r.factorBars, tactics: round2(r.keyFactors.reduce((a, k) => a + k.xg, 0)) };
    return r;
  }
  // ── 이적·계약·받은 편지함 (2.2.0 가짜 구현, 경제 설계 5·6장 근사) ─────────
  // 일정은 실제 서비스(2.2.1 transferDaily)와 같다. 날짜 = 처리 중인 새 날:
  // Day 11 중간 창 열림 → Day 15 정산 / Day 20 재계약 창 / Day 25 정규 창 열림 / Day 28 만료 예정자 FA 매물 → 다음 시즌 Day 2 정산.
  // AI 경쟁 입찰은 V × (1.0~1.25) 난수 하나로 근사한다.
  private mkt(s: GameState): FakeMarket {
    const f = s as FakeState;
    f.market ??= { window: null, listings: [], bids: [], signings: 0, nextId: 1 };
    return f.market;
  }
  private inbox(s: GameState, kind: InboxKind, title: string, body: string, ref: Partial<Pick<InboxMessage, 'playerId' | 'clubId' | 'listingId' | 'matchId'>> = {}): void {
    const m = this.mkt(s);
    (s.inbox ??= []).push({ id: `s${s.time.season}-d${s.time.day}-${kind}-${m.nextId++}`, season: s.time.season, day: s.time.day, kind, title, body, read: false, ...ref });
    if (s.inbox.length > 200) s.inbox.splice(0, s.inbox.length - 200);
  }
  private tledger(s: GameState, clubId: ClubId, kind: TransferLedgerKind, amount: number): LedgerEntry {
    return this.ledger(s, clubId, kind, amount);
  }
  private remainingSalary(s: GameState): number {
    const salary = this.squadOf(s, s.userClubId).reduce((a, p) => a + p.contract.salary, 0);
    return (salary * Math.max(0, 28 - s.time.day)) / 28;
  }
  private reservationOf(s: GameState, b: Bid): number {
    return (b.fee ?? 0) + (b.bonus ?? 0) + Math.round(((b.salary ?? 0) * Math.max(0, 28 - s.time.day)) / 28);
  }
  private reservedTotal(s: GameState, except?: string): number {
    return this.mkt(s).bids.filter((b) => b.listingId !== except).reduce((a, b) => a + this.reservationOf(s, b), 0);
  }
  private requireWindow(s: GameState): TransferWindow {
    const w = this.mkt(s).window;
    if (!w) throw new GameError('WINDOW_CLOSED', '지금은 이적 창이 닫혀 있어요');
    return w;
  }
  private myPlayer(s: GameState, playerId: PlayerId): Player {
    const p = s.players[playerId];
    if (!p || p.clubId !== s.userClubId) throw new GameError('NOT_FOUND', `우리 구단 선수가 아니에요: ${playerId}`);
    return p;
  }
  private openWindow(s: GameState, kind: WindowKind, settleDay: number, settleSeason: SeasonNo): void {
    const m = this.mkt(s);
    const rng = mulberry32(s.gameSeed + s.time.season * 131 + s.time.day);
    m.window = { kind, season: s.time.season, openDay: s.time.day, settleDay, settleSeason };
    m.listings = [];
    m.bids = [];
    const POS: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];
    const add = (lk: ListingKind, p: Player, sellerClubId: ClubId | null, minRate = 1) => {
      const V = fakeValue(p);
      const S = fakeS(p.ovr);
      const id = `L${s.time.season}-${s.time.day}-${m.nextId++}`;
      m.listings.push(
        lk === 'FA'
          ? { id, kind: lk, playerId: p.id, sellerClubId: null, value: V, minPrice: 0, maxPrice: 0, bonusMax: round1k(S), salaryFloor: round1k(Math.max(200_000, 0.9 * S)), seasonsRange: seasonsRangeOf(p.age) }
          : { id, kind: lk, playerId: p.id, sellerClubId, value: V, minPrice: round1k(V * minRate), maxPrice: round1k(V * 1.3) },
      );
    };
    const pos = () => POS[Math.floor(rng() * POS.length)] ?? 'CM';
    for (let i = 0; i < (kind === 'REGULAR' ? 10 : 6); i++) {
      const pid = `n${s.time.season}-${s.time.day}-${i}`;
      const p = genPlayer(rng, pid, USER_CLUB, pos(), 42 + rng() * 14);
      p.clubId = null;
      p.age = 19 + Math.floor(rng() * 12);
      s.players[pid] = p;
      add('NPC', p, null);
    }
    for (let i = 0; i < 4; i++) {
      const pid = `f${s.time.season}-${s.time.day}-${i}`;
      const p = genPlayer(rng, pid, USER_CLUB, pos(), 40 + rng() * 14);
      p.clubId = null;
      p.contract = { seasonsLeft: 0, salary: 0 };
      s.players[pid] = p;
      add('FA', p, null);
    }
    for (const club of Object.values(s.clubs)) {
      if (club.isHuman || isVirtual(club.id) || rng() < 0.6) continue;
      const pid = club.playerIds[Math.floor(rng() * club.playerIds.length)];
      const p = pid ? s.players[pid] : undefined;
      if (p) add('CLUB', p, club.id, 0.85 + rng() * 0.3);
    }
    this.inbox(s, 'WINDOW_OPENED', `${kind === 'MID' ? '시즌 중간' : '정규'} 이적 창이 열렸어요`, `매물 ${m.listings.length}건이 올라왔어요. 정산은 ${settleSeason > s.time.season ? '다음 시즌' : `시즌 ${settleSeason}`} Day ${settleDay}에 해요.`);
  }
  /** Day 28: 재계약 안 된 만료 예정자를 FA 매물로 (아직 소속 구단이 있다. 우리 구단 선수도 포함) */
  private registerExpiringFa(s: GameState): void {
    const m = this.mkt(s);
    if (m.window?.kind !== 'REGULAR') return;
    const renewed = new Set((s.pendingRenewals ?? []).map((r) => r.playerId));
    const listed = new Set(m.listings.map((l) => l.playerId));
    for (const club of Object.values(s.clubs)) {
      for (const p of this.squadOf(s, club.id)) {
        if (p.contract.seasonsLeft > 1 || p.isTemporary || renewed.has(p.id) || listed.has(p.id)) continue;
        const S = fakeS(p.ovr);
        m.listings.push({ id: `L${s.time.season}-${s.time.day}-${m.nextId++}`, kind: 'FA', playerId: p.id, sellerClubId: null, value: fakeValue(p), minPrice: 0, maxPrice: 0, bonusMax: round1k(S), salaryFloor: round1k(Math.max(200_000, 0.9 * S)), seasonsRange: seasonsRangeOf(p.age) });
      }
    }
  }
  private movePlayer(s: GameState, p: Player, to: ClubId | null): void {
    if (p.clubId) {
      const from = s.clubs[p.clubId];
      if (from) from.playerIds = from.playerIds.filter((x) => x !== p.id);
    }
    p.clubId = to;
    if (to) s.clubs[to]?.playerIds.push(p.id);
  }
  private settleWindow(s: GameState, notices: string[], userLedger: LedgerEntry[]): void {
    const m = this.mkt(s);
    const rng = mulberry32(s.gameSeed ^ (s.time.season * 977 + s.time.day));
    const me = s.userClubId;
    for (const L of m.listings) {
      const p = s.players[L.playerId];
      if (!p) continue;
      const bid = m.bids.find((b) => b.listingId === L.id);
      const ai = L.value * (1 + rng() * 0.25);
      if (bid) {
        const offer = L.kind === 'FA' ? (bid.bonus ?? 0) + (bid.salary ?? 0) * (bid.seasons ?? 1) * 0.5 : bid.fee ?? 0;
        if (offer >= ai || rng() < 0.25) {
          const cost = L.kind === 'FA' ? bid.bonus ?? 0 : bid.fee ?? 0;
          userLedger.push(this.tledger(s, me, L.kind === 'FA' ? 'SIGNING_BONUS' : 'TRANSFER_FEE_PAID', -cost));
          if (L.kind === 'CLUB' && L.sellerClubId) {
            this.tledger(s, L.sellerClubId, 'TRANSFER_FEE_RECEIVED', cost);
            this.tledger(s, L.sellerClubId, 'TRANSFER_TAX', -Math.round(cost * 0.1));
          }
          this.movePlayer(s, p, me);
          p.contract =
            L.kind === 'FA'
              ? { seasonsLeft: bid.seasons ?? 1, salary: bid.salary ?? 0, bonusPerSeason: Math.round((bid.bonus ?? 0) / (bid.seasons ?? 1)) }
              : { seasonsLeft: Math.min(3, seasonsRangeOf(p.age)[1]), salary: round1k(fakeS(p.ovr)) };
          m.signings += 1;
          this.inbox(s, 'BID_WON', `${p.name} 영입에 성공했어요`, `${L.kind === 'FA' ? '계약금' : '이적료'} ${formatKc(cost)} · 연봉 ${formatKc(p.contract.salary)} · ${p.contract.seasonsLeft}시즌 계약이에요.`, { playerId: p.id, listingId: L.id });
          notices.push(`${p.name} 영입 성공`);
        } else {
          this.inbox(s, 'BID_LOST', `${p.name} 입찰에서 졌어요`, '다른 구단이 더 좋은 조건을 냈어요. 예약했던 금액은 풀렸어요.', { playerId: p.id, listingId: L.id });
          notices.push(`${p.name} 입찰 실패`);
        }
        continue;
      }
      if (L.kind === 'CLUB' && L.sellerClubId === me) {
        if (rng() < 0.6) {
          const price = round1k(L.minPrice + rng() * (L.maxPrice - L.minPrice));
          const buyer = Object.values(s.clubs).find((c) => !c.isHuman && !isVirtual(c.id) && rng() < 0.3) ?? s.clubs.c01;
          userLedger.push(this.tledger(s, me, 'TRANSFER_FEE_RECEIVED', price));
          userLedger.push(this.tledger(s, me, 'TRANSFER_TAX', -Math.round(price * 0.1)));
          this.movePlayer(s, p, buyer?.id ?? null);
          this.inbox(s, 'PLAYER_SOLD', `${p.name} 판매가 끝났어요`, `${buyer?.name ?? 'AI 구단'}에 ${formatKc(price)}에 팔렸어요. 이적세 10%를 뺀 ${formatKc(Math.round(price * 0.9))}이 들어왔어요.`, { playerId: p.id, clubId: buyer?.id, listingId: L.id });
          notices.push(`${p.name} 판매 완료`);
        } else {
          this.inbox(s, 'LISTING_UNSOLD', `${p.name} 판매가 이뤄지지 않았어요`, '사려는 구단이 없어서 선수단에 그대로 남아요.', { playerId: p.id, listingId: L.id });
        }
      }
    }
    // 팔리지 않은 신규·FA 선수는 무소속(clubId null)으로 남는다 — 편지함 '선수 보기'가 계속 열리도록
    m.window = null;
    m.listings = [];
    m.bids = [];
  }
  /** step() 이 날짜를 바꾼 뒤 부른다. 실제 서비스처럼 s.time = 처리 중인 새 날 */
  private marketTick(s: GameState, notices: string[], userLedger: LedgerEntry[]): void {
    const m = this.mkt(s);
    const d = s.time.day;
    if (m.window && s.time.season === m.window.settleSeason && d === m.window.settleDay) this.settleWindow(s, notices, userLedger);
    if (!m.window) {
      if (d === 11) this.openWindow(s, 'MID', 15, s.time.season);
      if (d === 25) this.openWindow(s, 'REGULAR', 2, s.time.season + 1);
    }
    if (d === 28) this.registerExpiringFa(s);
    if (d === 20) {
      const due = this.squadOf(s, s.userClubId).filter((p) => p.contract.seasonsLeft === 1 && !p.isTemporary);
      if (due.length)
        this.inbox(s, 'RENEWAL_OPEN', `재계약 기간이 시작됐어요 (${due.length}명)`, `${due.map((p) => p.name).join(', ')}의 계약이 이번 시즌에 끝나요. Day 27까지 선수 상세에서 재계약할 수 있어요.`, { playerId: due[0]?.id });
    }
  }

  getTransferWindow(): TransferWindow | null {
    return this.mkt(this.req()).window;
  }
  listTransferListings(filter: TransferListingFilter = {}): TransferListing[] {
    const s = this.req();
    return this.mkt(s)
      .listings.filter((l) => {
        const p = s.players[l.playerId];
        if (!p) return false;
        if (filter.kind && l.kind !== filter.kind) return false;
        if (filter.position && p.primary !== filter.position) return false;
        if (filter.minOvr !== undefined && p.ovr < filter.minOvr) return false;
        if (filter.maxPrice !== undefined && l.minPrice > filter.maxPrice) return false;
        return true;
      })
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  }
  placeBid(input: BidInput): Bid {
    const s = clone(this.req());
    this.requireOwner(s);
    this.requireWindow(s);
    const m = this.mkt(s);
    const L = m.listings.find((l) => l.id === input.listingId);
    if (!L) throw new GameError('NOT_FOUND', `매물이 없어요: ${input.listingId}`);
    if (L.sellerClubId === s.userClubId) throw new GameError('BID_OUT_OF_RANGE', '우리 구단 매물에는 입찰할 수 없어요');
    const fin = s.finances[s.userClubId];
    if ((fin?.balance ?? 0) < 0) throw new GameError('NEGATIVE_BALANCE_LOCK', '잔액이 0 아래인 동안에는 입찰할 수 없어요');
    const bid: Bid = { listingId: L.id, clubId: s.userClubId, placedDay: s.time.day };
    if (L.kind === 'FA') {
      if (s.releasedThisSeason?.[s.userClubId]?.includes(L.playerId)) throw new GameError('BID_OUT_OF_RANGE', '이번 시즌에 방출한 선수는 FA로 다시 데려올 수 없어요', ['RELEASED']);
      const [lo, hi] = L.seasonsRange ?? [1, 1];
      const bonus = input.bonus ?? 0;
      const salary = input.salary ?? 0;
      const seasons = input.seasons ?? lo;
      if (bonus < 0 || bonus > (L.bonusMax ?? 0)) throw new GameError('BID_OUT_OF_RANGE', `계약금은 0~${formatKc(L.bonusMax ?? 0)} 사이여야 해요`);
      if (salary < (L.salaryFloor ?? 0)) throw new GameError('BID_OUT_OF_RANGE', `연봉은 ${formatKc(L.salaryFloor ?? 0)} 이상이어야 해요`);
      if (seasons < lo || seasons > hi) throw new GameError('BID_OUT_OF_RANGE', `계약 기간은 ${lo}~${hi}시즌 사이여야 해요`);
      Object.assign(bid, { bonus, salary, seasons });
    } else {
      const fee = input.fee ?? 0;
      if (fee < L.minPrice || fee > L.maxPrice) throw new GameError('BID_OUT_OF_RANGE', `입찰가는 ${formatKc(L.minPrice)}~${formatKc(L.maxPrice)} 사이여야 해요`);
      bid.fee = fee;
    }
    const others = m.bids.filter((b) => b.listingId !== L.id);
    const squad = this.squadOf(s, s.userClubId);
    if (squad.length + others.length + 1 > 25) throw new GameError('SQUAD_FULL', '선수단이 25명으로 꽉 차요. 선수를 판매하거나 방출한 뒤 입찰해 주세요');
    if (m.signings + others.length + 1 > 8) throw new GameError('SIGNING_LIMIT', '이번 시즌 영입 한도(8명)를 넘어요');
    const newSalary = L.kind === 'FA' ? bid.salary ?? 0 : fakeS(s.players[L.playerId]?.ovr ?? 50);
    const salaryTotal = squad.reduce((a, x) => a + x.contract.salary, 0);
    if (salaryTotal + newSalary > ECON.cap) throw new GameError('CAP_EXCEEDED', `영입하면 연봉 캡을 넘어요 (연봉 합계 ${formatKc(salaryTotal + newSalary)}, 캡 ${formatKc(ECON.cap)})`);
    const spendable = (fin?.balance ?? 0) - this.remainingSalary(s) - this.reservedTotal(s, L.id);
    const need = this.reservationOf(s, bid);
    if (need > spendable) throw new GameError('INSUFFICIENT_FUNDS', `지출 가능액이 모자라요. 이 입찰에 쓸 수 있는 돈은 ${formatKc(Math.max(0, Math.round(spendable)))}까지예요 (필요 ${formatKc(need)})`);
    m.bids = [...others, bid];
    this.commit(s);
    return bid;
  }
  withdrawBid(listingId: string): void {
    const s = clone(this.req());
    this.requireOwner(s);
    this.requireWindow(s);
    const m = this.mkt(s);
    if (!m.bids.some((b) => b.listingId === listingId)) throw new GameError('NOT_FOUND', '이 매물에 낸 입찰이 없어요');
    m.bids = m.bids.filter((b) => b.listingId !== listingId);
    this.commit(s);
  }
  listBids(): Bid[] {
    return this.mkt(this.req()).bids;
  }
  listForSale(playerId: PlayerId, minPrice: number): TransferListing {
    const s = clone(this.req());
    this.requireOwner(s);
    const w = this.requireWindow(s);
    const p = this.myPlayer(s, playerId);
    const m = this.mkt(s);
    if (w.kind === 'REGULAR' && p.contract.seasonsLeft <= 1) throw new GameError('BID_OUT_OF_RANGE', '계약이 이번 시즌에 끝나는 선수는 정규 창에 올릴 수 없어요');
    const V = fakeValue(p);
    const lo = round1k(V * 0.7);
    const hi = round1k(V * 1.3);
    if (minPrice < lo || minPrice > hi) throw new GameError('BID_OUT_OF_RANGE', `최저가는 ${formatKc(lo)}~${formatKc(hi)} 사이로 정해 주세요`);
    // 같은 선수 재등록 = 최저가 수정 (실제 서비스와 같다)
    const prev = m.listings.find((l) => l.playerId === playerId);
    const L: TransferListing = { id: prev?.id ?? `L${s.time.season}-${s.time.day}-${m.nextId++}`, kind: 'CLUB', playerId, sellerClubId: s.userClubId, value: V, minPrice: round1k(minPrice), maxPrice: hi };
    m.listings = [...m.listings.filter((l) => l.id !== L.id), L];
    this.commit(s);
    return L;
  }
  withdrawListing(listingId: string): void {
    const s = clone(this.req());
    this.requireOwner(s);
    this.requireWindow(s);
    const m = this.mkt(s);
    if (!m.listings.some((l) => l.id === listingId && l.sellerClubId === s.userClubId)) throw new GameError('NOT_FOUND', '내 명단이 아니에요');
    m.listings = m.listings.filter((l) => l.id !== listingId);
    this.commit(s);
  }
  private renewalAsk(s: GameState, p: Player): number {
    const games = s.fixtures.filter((f) => f.played && f.season === s.time.season && (f.homeId === s.userClubId || f.awayId === s.userClubId)).length;
    let mult = 1;
    if (games > 0 && p.season.starts >= games / 2) mult += 0.1;
    if (p.age >= 33) mult -= 0.2;
    else if (p.age >= 31) mult -= 0.1;
    return round1k(fakeS(p.ovr) * clamp(mult, 0.9, 1.3));
  }
  getRenewalQuote(playerId: PlayerId): RenewalQuote {
    const s = this.req();
    const p = this.myPlayer(s, playerId);
    if (s.time.day < 20 || s.time.day > 27 || p.contract.seasonsLeft !== 1 || p.isTemporary) throw new GameError('RENEWAL_NOT_OPEN', '재계약은 계약이 1시즌 남은 선수와 Day 20~27에만 할 수 있어요');
    return { playerId, askSalary: this.renewalAsk(s, p), seasonsRange: seasonsRangeOf(p.age), bonusPerSeasonRate: 0.1 };
  }
  offerRenewal(playerId: PlayerId, salary: number, seasons: number): RenewalResult {
    const s = clone(this.req());
    this.requireOwner(s);
    // 2.4.1: 성립한 재계약은 다시 제안할 수 없다 (덮어쓰기로 보너스를 두 번 받는 우회 차단)
    if (s.pendingRenewals?.some((r) => r.playerId === playerId)) throw new GameError('RENEWAL_NOT_OPEN', '이미 재계약한 선수예요. 새 계약은 다음 시즌부터 적용돼요', ['ALREADY_RENEWED']);
    const q = this.getRenewalQuote(playerId);
    const p = this.myPlayer(s, playerId);
    if ((s.finances[s.userClubId]?.balance ?? 0) < 0 && salary > p.contract.salary) throw new GameError('NEGATIVE_BALANCE_LOCK', '잔액이 0 아래인 동안에는 연봉을 올리는 재계약을 할 수 없어요');
    const total = this.squadOf(s, s.userClubId).reduce((a, x) => a + x.contract.salary, 0) - p.contract.salary + salary;
    if (total > ECON.cap) throw new GameError('CAP_EXCEEDED', `재계약하면 연봉 캡을 넘어요 (연봉 합계 ${formatKc(total)}, 캡 ${formatKc(ECON.cap)})`);
    const accepted = salary >= q.askSalary && seasons >= q.seasonsRange[0] && seasons <= q.seasonsRange[1];
    if (!accepted) return { accepted, ask: q.askSalary };
    const bonus = round1k(q.bonusPerSeasonRate * salary * seasons);
    // 실제 서비스처럼 성립 재계약은 pendingRenewals 에 두고 시즌 경계에 적용
    s.pendingRenewals = [...(s.pendingRenewals ?? []), { playerId, salary, seasons, bonusPerSeason: Math.round(bonus / seasons) }];
    this.tledger(s, s.userClubId, 'RENEWAL_BONUS', -bonus);
    this.commit(s);
    return { accepted, ask: q.askSalary };
  }
  getReleaseQuote(playerId: PlayerId): ReleaseQuote {
    const s = this.req();
    const p = this.myPlayer(s, playerId);
    const remaining = (p.contract.salary * Math.max(0, 28 - s.time.day)) / 28 + p.contract.salary * Math.max(0, p.contract.seasonsLeft - 1);
    const exempt = p.isTemporary;
    return { playerId, penalty: exempt ? 0 : round1k(0.5 * remaining), exempt };
  }
  releasePlayer(playerId: PlayerId): void {
    const s = clone(this.req());
    this.requireOwner(s);
    const p = this.myPlayer(s, playerId);
    const q = this.getReleaseQuote(playerId);
    if (q.penalty > 0) this.tledger(s, s.userClubId, 'RELEASE_PENALTY', -q.penalty);
    this.movePlayer(s, p, null);
    const m = this.mkt(s);
    const gone = new Set(m.listings.filter((l) => l.playerId === playerId).map((l) => l.id));
    m.listings = m.listings.filter((l) => !gone.has(l.id));
    m.bids = m.bids.filter((b) => !gone.has(b.listingId));
    s.pendingRenewals = s.pendingRenewals?.filter((r) => r.playerId !== playerId);
    p.contract = { seasonsLeft: 0, salary: 0 };
    // 2.4.1: 이번 시즌 방출 선수는 FA 로 다시 데려올 수 없다
    const rel = (s.releasedThisSeason ??= {});
    rel[s.userClubId] = [...(rel[s.userClubId] ?? []), playerId];
    this.inbox(s, 'PLAYER_RELEASED', `${p.name} 방출`, q.penalty > 0 ? `${p.name} 선수와 계약을 끝냈어요. 위약금 ${formatKc(q.penalty)}를 냈어요.` : `${p.name} 선수와 위약금 없이 계약을 끝냈어요.`, { playerId, clubId: s.userClubId });
    this.emergencyFill(s);
    this.commit(s);
  }
  /** 등록 18명 미만이면 긴급 FA 1시즌 임시 계약 (실제 서비스는 FA 풀에서, fake 는 새로 만든다). 방출·시즌 경계 뒤. 2.4.1: 시즌당 2명 상한 */
  private emergencyFill(s: GameState): void {
    const m = this.mkt(s);
    const signed: string[] = [];
    const em = (s.emergencySignedThisSeason ??= {});
    const done = (em[s.userClubId] ??= []);
    while (this.squadOf(s, s.userClubId).length < 18 && done.length < 2) {
      const tid = `t${s.time.season}-${s.time.day}-${m.nextId++}`;
      const t = genPlayer(mulberry32(s.gameSeed + m.nextId), tid, s.userClubId, 'CM', 45);
      t.contract = { seasonsLeft: 1, salary: 200_000 };
      t.isTemporary = true;
      done.push(tid);
      s.players[tid] = t;
      s.clubs[s.userClubId]?.playerIds.push(tid);
      signed.push(t.name);
    }
    if (signed.length) this.inbox(s, 'GENERAL', '긴급 FA 계약', `선수단이 18명 아래로 줄어 FA ${signed.length}명(${signed.join(', ')})과 1시즌 계약했어요.`, { clubId: s.userClubId });
  }
  getPlayerValue(playerId: PlayerId): { value: number; minPrice: number; maxPrice: number } {
    const p = this.req().players[playerId];
    if (!p) throw new GameError('NOT_FOUND', `선수 없음: ${playerId}`);
    const value = fakeValue(p);
    return { value, minPrice: round1k(value * 0.7), maxPrice: round1k(value * 1.3) };
  }
  // ── 2.3.0 훈련 포커스·유스·경고 누적 (fake 근사) ──
  setTrainingFocus(focus: TrainingFocus): GameSnapshot {
    const s = clone(this.req());
    this.requireOwner(s);
    const club = s.clubs[s.userClubId];
    if (!club) throw new GameError('NOT_FOUND', '구단을 찾지 못했어요');
    const cur = trainingOf(club).focus;
    club.training = focus === cur ? { focus: cur } : { focus: cur, next: focus };
    this.commit(s);
    return s;
  }
  /** 주 시작(Day 1·8·15·22 00:00): 예약한 포커스 적용 */
  private weekStart(s: GameState): void {
    const club = s.clubs[s.userClubId];
    if (club?.training?.next) club.training = { focus: club.training.next };
  }
  private applyYellow(s: GameState, id: PlayerId): void {
    const p = s.players[id];
    if (!p) return;
    const av = p.availability;
    const se = p.season;
    se.yellowCards = (se.yellowCards ?? 0) + 1;
    let accum = (av.yellowAccum ?? 0) + 1;
    const mine = p.clubId === s.userClubId;
    if (accum >= YELLOW_LIMIT) {
      accum -= YELLOW_LIMIT;
      p.availability.suspendedMatches += 1;
      if (mine) this.inbox(s, 'SUSPENDED', `${p.name} 출장 정지`, `경고가 ${YELLOW_LIMIT}장 쌓여 다음 경기에 뛸 수 없어요. 선발을 확인해 주세요.`, { playerId: p.id });
    } else if (accum === YELLOW_LIMIT - 1 && mine) {
      this.inbox(s, 'DISCIPLINE_WARNING', `${p.name} 경고 누적 ${accum}장`, '한 장 더 받으면 1경기 출장 정지예요.', { playerId: p.id });
    }
    av.yellowAccum = accum;
  }
  /** Day 1: 사람 구단 유스 후보 3~5명 (수명주기 7.2 근사) */
  private genYouth(s: GameState): void {
    const rng = mulberry32(s.gameSeed + s.time.season * 104729);
    const ref = TIER_REF_OVR[s.settings.tier];
    const n = 3 + Math.floor(rng() * 3);
    const candidates: YouthCandidate[] = Array.from({ length: n }, (_, i) => {
      const pos = YOUTH_POS[Math.floor(rng() * YOUTH_POS.length)] ?? 'CM';
      const age = 16 + Math.floor(rng() * 2);
      let pot = ref - 10 + gauss(rng) * 8;
      if (rng() < 0.05) pot += 18;
      pot = clamp(Math.round(pot), 30, 92);
      const gap = age === 16 ? 14 + rng() * 10 : 12 + rng() * 10;
      const p = genPlayer(rng, `y${s.time.season}-${s.userClubId}-${i}`, s.userClubId, pos, clamp(pot - gap, 15, 90));
      return {
        ...p,
        age,
        potential: Math.max(pot, p.ovr),
        scoutRange: [gradeOf(pot - 8), gradeOf(pot + 8)],
        // U3 상대 척도: 티어 기준 OVR 을 T3 기준(60, C)으로 옮긴 등급
        tierRange: [gradeOf(pot - 8 + 60 - ref), gradeOf(pot + 8 + 60 - ref)],
        clubId: null,
        contract: { seasonsLeft: 3, salary: 300_000 },
        academyClubId: s.userClubId,
      };
    });
    s.youthIntake = { season: s.time.season, clubId: s.userClubId, tier: s.settings.tier, candidates, deadlineDay: LIFE_YOUTH_DEADLINE };
    this.inbox(s, 'YOUTH_INTAKE', `유스 후보 ${n}명이 도착했어요`, `Day ${LIFE_YOUTH_DEADLINE}까지 최대 2명을 1군으로 올릴 수 있어요. 정하지 않으면 유망주만 최대 1명 자동으로 올려요.`);
  }
  private promoteYouth(s: GameState, c: YouthCandidate): void {
    const { tierRange: _t, ...p } = clone(c);
    p.clubId = s.userClubId;
    s.players[p.id] = p;
    s.clubs[s.userClubId]?.playerIds.push(p.id);
  }
  /** Day 8 00:00: 미결정이면 유망주(pot >= ref + 4)만 최대 1명 자동 승격, 후보 삭제 */
  private youthDeadline(s: GameState): void {
    const it = s.youthIntake;
    if (!it) return;
    if (!it.decided) {
      const ref = TIER_REF_OVR[s.settings.tier];
      const best = [...it.candidates].sort((a, b) => b.potential - a.potential)[0];
      const ok = !!best && best.potential >= ref + 4 && this.squadOf(s, s.userClubId).length < 25;
      if (ok && best) this.promoteYouth(s, best);
      this.inbox(s, 'YOUTH_AUTO_DECIDED', '유스 결정 마감', ok && best ? `마감까지 정하지 않아 유망주 ${best.name} 선수를 자동으로 올렸어요.` : '마감까지 정하지 않았고 올릴 만한 유망주가 없어 후보가 모두 떠났어요.', ok && best ? { playerId: best.id } : {});
    }
    delete s.youthIntake;
  }
  getYouthIntake(): YouthIntake | null {
    const it = this.req().youthIntake;
    if (!it) return null;
    // 실제 서비스처럼 potential 은 ovr 로 가려서 내보낸다
    return { ...it, candidates: it.candidates.map((c) => ({ ...c, potential: c.ovr })) };
  }
  decideYouth(promoteIds: readonly PlayerId[]): GameSnapshot {
    const s = clone(this.req());
    this.requireOwner(s);
    const it = s.youthIntake;
    if (!it || it.decided) throw new GameError('INVALID_PHASE', '지금은 유스를 결정할 수 없어요');
    const ids = [...new Set(promoteIds)];
    if (ids.length > 2) throw new GameError('SQUAD_FULL', '유스는 최대 2명까지 올릴 수 있어요');
    const picks = ids.map((id) => it.candidates.find((c) => c.id === id));
    if (picks.some((c) => !c)) throw new GameError('NOT_FOUND', '후보를 찾지 못했어요');
    if (this.squadOf(s, s.userClubId).length + ids.length > 25) throw new GameError('SQUAD_FULL', '선수단이 25명을 넘어요. 먼저 선수를 정리해 주세요.');
    for (const c of picks) if (c) this.promoteYouth(s, c);
    // 한 번만. 결과 표시용으로 Day 8 까지 남긴다
    it.decided = true;
    it.promotedIds = ids;
    this.commit(s);
    return s;
  }

  private inboxCache: { state: GameState; unread: boolean; list: InboxMessage[] } | null = null;
  getInbox(filter: { unreadOnly?: boolean } = {}): InboxMessage[] {
    const s = this.req();
    const unread = !!filter.unreadOnly;
    const c = this.inboxCache;
    if (c && c.state === s && c.unread === unread) return c.list;
    const list = (s.inbox ?? []).filter((m) => !unread || !m.read).reverse();
    this.inboxCache = { state: s, unread, list };
    return list;
  }
  markRead(ids?: readonly string[]): void {
    const s = this.req();
    const want = ids ? new Set(ids) : null;
    let changed = false;
    const inbox = (s.inbox ?? []).map((m) => {
      if (m.read || (want && !want.has(m.id))) return m;
      changed = true;
      return { ...m, read: true };
    });
    if (changed) this.commit({ ...s, inbox });
  }

  runCalibration(opts: CalibrationOptions, onProgress?: (p: CalibrationProgress) => void): Promise<CalibrationReport> {
    const scenarios = opts.scenarios ?? ['BASELINE', 'COUNTER_SPREAD', 'OVR_DIFF_10', 'OVR_DIFF_10_COUNTER', 'OVR_DIFF_25', 'TEMPO_VARIANCE', 'RULE_ISOLATION'];
    const started = Date.now();
    const rng = mulberry32(opts.seed);
    return new Promise((resolve) => {
      let i = 0;
      const tick = () => {
        const sc = scenarios[i];
        if (!sc) {
          const all: CalibrationTarget[] = [
            { id: 'goals', scenario: 'BASELINE', label: '평균 총 득점', min: 2.5, max: 2.9, actual: round2(2.4 + rng() * 0.6), pass: false, unit: 'goals' },
            { id: 'draws', scenario: 'BASELINE', label: '무승부 비율', min: 22, max: 28, actual: round2(20 + rng() * 10), pass: false, unit: '%' },
            { id: 'spread', scenario: 'COUNTER_SPREAD', label: '카운터 승률 차', min: 10, max: 15, actual: round2(8 + rng() * 8), pass: false, unit: '%p' },
            { id: 'ovr10', scenario: 'OVR_DIFF_10', label: '강팀 승률 (10점 차)', min: 60, max: 68, actual: round2(58 + rng() * 12), pass: false, unit: '%' },
            { id: 'ovr25', scenario: 'OVR_DIFF_25', label: '강팀 승률 (25점 차)', min: 85, actual: round2(80 + rng() * 15), pass: false, unit: '%' },
            { id: 'p95', scenario: 'RULE_ISOLATION', label: '규칙 합 기여 P95', max: 0.6, actual: round2(0.4 + rng() * 0.3), pass: false, unit: 'xG' },
            { id: 'rgoals', scenario: 'LEAGUE_REALISM', label: '경기당 총 득점', min: 2.6, max: 3.0, actual: round2(2.5 + rng() * 0.6), pass: false, unit: 'goals' },
            { id: 'sot', scenario: 'LEAGUE_REALISM', label: '팀당 유효슈팅', min: 3.8, max: 4.8, actual: round2(3.6 + rng() * 1.4), pass: false, unit: 'shots' },
            { id: 'corners', scenario: 'LEAGUE_REALISM', label: '팀당 코너', min: 4.3, max: 5.8, actual: round2(4 + rng() * 2), pass: false, unit: 'count' },
            { id: 'yellows', scenario: 'LEAGUE_REALISM', label: '경기당 경고', min: 3.5, max: 5.0, actual: round2(3.2 + rng() * 2), pass: false, unit: 'count' },
            { id: 'signRate', scenario: 'STYLE_MATRIX', label: '설계 2.5 행렬 부호 일치율', min: 70, actual: round2(60 + rng() * 30), pass: false, unit: '%' },
          ];
          const targets = all
            .filter((t) => scenarios.includes(t.scenario))
            .map((t) => ({ ...t, pass: (t.min === undefined || t.actual >= t.min) && (t.max === undefined || t.actual <= t.max) }));
          // 계약 밖 details.counterMatrix (UI 는 있으면 9×9 행렬로 그린다)
          const counterMatrix = scenarios.includes('STYLE_MATRIX')
            ? STYLES.flatMap((a) =>
                STYLES.map((b) => {
                  const edge = (a.goodAgainst.includes(b.id) ? 12 : 0) - (a.badAgainst.includes(b.id) ? 12 : 0) + (rng() - 0.5) * 8;
                  return { us: a.id, them: b.id, winPct: round2(37 + edge / 2), lossPct: round2(37 - edge / 2) };
                }),
              )
            : undefined;
          resolve({ engineVersion: 'fake-0', tacCap: opts.tacCap, matchesPerScenario: opts.matchesPerScenario, seed: opts.seed, targets, allPass: targets.every((t) => t.pass), durationMs: Date.now() - started, ...(counterMatrix ? { details: { counterMatrix } } : {}) });
          return;
        }
        onProgress?.({ scenario: sc, done: i + 1, total: scenarios.length });
        i++;
        setTimeout(tick, 250);
      };
      setTimeout(tick, 100);
    });
  }
}

export function createFakeGameService(opts?: { persist?: boolean }): GameService {
  return new FakeGameService(opts);
}
