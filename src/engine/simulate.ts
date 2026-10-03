/**
 * 메인 경기 루프 (8.2, 8.7). 소유: A.
 * 순수 함수: 같은 SimulateInput → 같은 MatchResult (바이트 단위 동일).
 * 모든 무작위는 mulberry32(input.seed) 하나에서 고정된 호출 순서로만 소비한다.
 */
import type {
  BinaryDP,
  BinaryDecisionLog,
  ChanceType,
  ClubId,
  ConditionalOrder,
  DecisionLog,
  EnginePlayer,
  EngineTeamInput,
  FormationDef,
  Lane,
  MatchEvent,
  MatchResult,
  OpenPlayChance,
  PlayerMatchLine,
  RoleId,
  RuleId,
  SimulateInput,
  SlotKey,
  Step,
  TeamInstructions,
  TeamMatchStats,
  TriggerCondition,
  Zone,
  ZonePass,
} from '../types';
import {
  BASE,
  BASE_RST,
  BASE_SEQUENCES,
  CARD,
  CHANCE_BASE_WEIGHT,
  CHANCE_XG,
  CONDITION,
  DISPLAY,
  FAM_COEF_MIN,
  FAM_MOD_MAX_PENALTY,
  FIN_GK_K,
  FIT_MULT,
  GOAL_P_MAX,
  GOAL_P_MIN,
  HOME_MOD,
  K,
  LATE_DRIFT,
  LONG_SHOT_DP4_BONUS,
  MAX_RESETS_PER_SEQUENCE,
  MAX_SUBS,
  MORALE_STEP_MOD,
  PK_SHARE_IN_BOX,
  POSSESSION_WEIGHT,
  P_MAX,
  P_MIN,
  SEGMENTS,
  SEGMENT_MINUTES,
  SEQUENCE_JITTER,
  SIDE_SPLIT_DEFAULT,
  SIDE_SPLIT_TARGETED,
  SOT_Q,
  STATE_MOD,
  STOPPAGE,
  SUB_WINDOWS,
  TEMPO_FACTOR_PER_STEP,
  Z2_FAIL_BRANCH,
} from './data/constants';
import { FORMATIONS } from './data/formations';
import {
  CENTRAL_SIDE_ADJ,
  CHANCE_ROLE_ADJ,
  CHANCE_ROLE_ADJ_MAX,
  ROLES,
  ROLE_EXTRA_DRAIN,
  ROLE_SHAPE,
  ROLE_UNIT_WEIGHTS,
  SHOOTER_MIX,
  SHOOTER_ROLE_WEIGHT,
  SOLO_DRIBBLE_THRESHOLD,
  SOLO_PER_POINT,
} from './data/roleWeights';
import { clamp, logit, sigmoid } from './math';
import { mulberry32, pickWeighted, type Rng } from './rng';
import { OPEN_CHANCES, evalBinaryRules, evalChoiceRules, type RawMap, type TeamView } from './rules';
import { computeShape, computeUnitsFromOccupants, conditionEfficiency, eff, fitOf, mixEff, type Occupant } from './units';

// ─────────────────────────────────────────────────────────────── 상태

interface PState {
  p: EnginePlayer;
  cond: number;
  started: boolean;
  onMin: number;
  offMin: number | null;
  goals: number;
  shots: number;
  keyPasses: number;
  tackles: number;
  injuredDays: number;
  red: boolean;
  yellows: number;
  dropped: boolean;
}

interface TeamStats {
  seqs: number;
  shots: number;
  xg: number;
  zone: [ZonePass, ZonePass, ZonePass];
  counters: number;
  offsides: number;
  longBalls: number;
  ruleFires: Partial<Record<RuleId, number>>;
  segEntries: number[];
  segXg: number[];
  sot: number;
  corners: number;
  yellows: number;
  /** 시간 가중 점유 누계 (표시용) */
  possW: number;
}

interface Team {
  input: EngineTeamInput;
  id: ClubId;
  isHome: boolean;
  slotKey: SlotKey;
  formation: FormationDef;
  roles: RoleId[];
  instr: TeamInstructions;
  pitch: (PState | null)[];
  bench: PState[];
  appeared: PState[];
  missing: number;
  subsUsed: number;
  windowsUsed: number;
  fired: Set<string>;
  goals: number;
  stats: TeamStats;
  view: TeamView;
}

interface Ctx {
  zone?: Zone;
  chance?: ChanceType;
  side?: Lane;
  shooter?: Occupant;
}

interface Decision {
  success: boolean;
  raw: RawMap;
  p: number;
}

type SeqEnd = { next: Team; zone: Zone };

// ─────────────────────────────────────────────────────────────── 도우미

function newPState(p: EnginePlayer, started: boolean, onMin: number): PState {
  return {
    p,
    cond: p.condition,
    started,
    onMin,
    offMin: null,
    goals: 0,
    shots: 0,
    keyPasses: 0,
    tackles: 0,
    injuredDays: 0,
    red: false,
    yellows: 0,
    dropped: p.condition < CONDITION.effLinearLowAt,
  };
}

function emptyStats(): TeamStats {
  return {
    seqs: 0,
    shots: 0,
    xg: 0,
    zone: [
      { attempts: 0, successes: 0 },
      { attempts: 0, successes: 0 },
      { attempts: 0, successes: 0 },
    ],
    counters: 0,
    offsides: 0,
    longBalls: 0,
    ruleFires: {},
    segEntries: new Array<number>(SEGMENTS).fill(0),
    segXg: new Array<number>(SEGMENTS).fill(0),
    sot: 0,
    corners: 0,
    yellows: 0,
    possW: 0,
  };
}

function occupants(t: Team): (Occupant | null)[] {
  return t.pitch.map((ps, i) => {
    if (!ps) return null;
    const fs = t.formation.slots[i]!;
    return { player: ps.p, position: fs.position, role: t.roles[i] ?? fs.defaultRole, lane: fs.lane, condition: ps.cond };
  });
}

function onPitchIds(t: Team): Set<string> {
  const s = new Set<string>();
  for (const ps of t.pitch) if (ps) s.add(ps.p.id);
  return s;
}

/** 마커: 지정 마커가 경기장에 있으면 그 선수, 없으면 DM/CB 중 태클+위치선정 최고 (4.5) */
function resolveMarker(t: Team, opp: Team): string | undefined {
  const orders = t.input.opponentOrders;
  if (!orders?.markTarget) return undefined;
  if (!onPitchIds(opp).has(orders.markTarget)) return undefined;
  const occ = occupants(t);
  if (orders.marker && occ.some((o) => o?.player.id === orders.marker)) return orders.marker;
  let best: Occupant | null = null;
  let bestV = -1;
  for (const o of occ) {
    if (!o || (o.position !== 'DM' && o.position !== 'CB')) continue;
    const v = o.player.attrs.tackling + o.player.attrs.positioning + (o.role === 'DM_ANCHOR' ? 5 : 0);
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best?.player.id;
}

function refreshView(t: Team, opp: Team): void {
  const occ = occupants(t);
  const markerId = resolveMarker(t, opp);
  const orders = t.input.opponentOrders;
  t.view = {
    id: t.id,
    instr: t.instr,
    formation: t.formation,
    occ,
    units: computeUnitsFromOccupants(occ, { missing: t.missing, markerId, setPieceTakerId: t.input.setPieceTaker }),
    shape: computeShape(occ, t.instr, t.formation),
    familiarity: t.input.slots[t.slotKey].familiarity,
    ...(orders?.markTarget ? { markTarget: orders.markTarget } : {}),
    ...(markerId ? { markerId } : {}),
    ...(orders?.attackSide ? { attackSide: orders.attackSide } : {}),
  };
}

function famCoef(fam: number): number {
  return FAM_COEF_MIN + (1 - FAM_COEF_MIN) * (fam / 100);
}

/** 적합도 최대 탐욕 배정 (슬롯 전환 시) */
function reassign(players: PState[], formation: FormationDef): (PState | null)[] {
  const out: (PState | null)[] = new Array<PState | null>(formation.slots.length).fill(null);
  const freePlayers = players.slice();
  const freeSlots = formation.slots.map((s) => s.index);
  while (freePlayers.length > 0 && freeSlots.length > 0) {
    let best = -Infinity;
    let bi = 0;
    let bs = 0;
    for (let i = 0; i < freePlayers.length; i++) {
      const pl = freePlayers[i]!.p;
      for (let j = 0; j < freeSlots.length; j++) {
        const slot = formation.slots[freeSlots[j]!]!;
        let score = FIT_MULT[fitOf(pl, slot.position)];
        if (slot.position === 'GK') score += pl.primary === 'GK' ? 2 : -2;
        else if (pl.primary === 'GK') score -= 2;
        if (score > best) {
          best = score;
          bi = i;
          bs = j;
        }
      }
    }
    out[freeSlots[bs]!] = freePlayers[bi]!;
    freePlayers.splice(bi, 1);
    freeSlots.splice(bs, 1);
  }
  return out;
}

function keyAttrAvg(p: EnginePlayer, role: RoleId): number {
  const keys = ROLES[role].keyAttrs;
  return keys.reduce((s, k) => s + p.attrs[k], 0) / keys.length;
}

// ─────────────────────────────────────────────────────────────── 엔진

class Match {
  readonly rng: Rng;
  /** 표시 판정 전용 스트림 (유효슈팅·코너 추가분·표시 오프사이드). 결과를 바꾸지 않는다 */
  readonly disp: Rng;
  /** 경고 판정 스트림 (2경고 퇴장 경로로 결과를 바꾼다) */
  readonly cardRng: Rng;
  /** 추가시간 분 (0 이면 정규 시간) */
  added = 0;
  private seqResets = 0;
  private seqAdv = 0;
  readonly log: DecisionLog[] = [];
  readonly events: MatchEvent[] = [];
  readonly home: Team;
  readonly away: Team;
  seq = 0;
  minute = 0;
  seg = 0;

  constructor(readonly input: SimulateInput) {
    this.rng = mulberry32(input.seed);
    this.disp = mulberry32((input.seed ^ 0x5bd1e995) >>> 0);
    this.cardRng = mulberry32((input.seed ^ 0x27d4eb2f) >>> 0);
    this.home = this.makeTeam(input.home, true);
    this.away = this.makeTeam(input.away, false);
    refreshView(this.home, this.away);
    refreshView(this.away, this.home);
  }

  private makeTeam(inp: EngineTeamInput, isHome: boolean): Team {
    const slot = inp.slots[inp.startSlot];
    const formation = FORMATIONS[slot.formation];
    const pitch: (PState | null)[] = formation.slots.map((_, i) => {
      const p = inp.starters[i];
      return p ? newPState(p, true, 0) : null;
    });
    const missing = pitch.filter((x) => x === null).length;
    const t: Team = {
      input: inp,
      id: inp.clubId,
      isHome,
      slotKey: inp.startSlot,
      formation,
      roles: formation.slots.map((s, i) => slot.roles[i] ?? s.defaultRole),
      instr: { ...slot.instructions },
      pitch,
      bench: inp.bench.map((p) => newPState(p, false, 0)),
      appeared: pitch.filter((x): x is PState => x !== null),
      missing,
      subsUsed: 0,
      windowsUsed: 0,
      fired: new Set(),
      goals: 0,
      stats: emptyStats(),
      view: undefined as unknown as TeamView,
    };
    return t;
  }

  other(t: Team): Team {
    return t === this.home ? this.away : this.home;
  }

  // ── decide(): 모든 이진 결정 지점의 확률은 여기서만 계산한다 ──────────
  decide(dp: BinaryDP, actor: Team, opp: Team, ctx: Ctx): Decision {
    const cfg = this.input.config;
    const A = actor.view.units;
    const D = opp.view.units;
    let a = 0;
    let d = 0;
    let base = 0;
    let strength = 0;
    switch (dp) {
      case 'DP1':
        a = A.BU;
        d = D.PRS;
        base = BASE.DP1;
        strength = K * (a - d);
        break;
      case 'DP2':
        a = A.PRG;
        d = D.MID;
        base = BASE.DP2;
        strength = K * (a - d);
        break;
      case 'DP4': {
        a = A.CRE;
        d = D.BOX;
        base = BASE.DP4 + (ctx.chance === 'LONG' ? LONG_SHOT_DP4_BONUS : 0) + this.lateDrift();
        strength = K * (a - d) + this.matchupTerm(ctx.chance, actor, opp);
        break;
      }
      case 'DP5': {
        const chance = ctx.chance ?? 'CUTBACK';
        a = ctx.shooter ? mixEff(ctx.shooter, SHOOTER_MIX) : A.FIN;
        d = D.GK;
        base = logit(CHANCE_XG[chance]);
        strength = FIN_GK_K * (a - d) + (chance === 'CORNER' ? K * (A.SPA - D.SPD) : 0);
        break;
      }
      case 'DP6':
        a = A.PACE_A;
        d = D.PACE_D;
        base = BASE.DP6;
        strength = K * (a - d);
        break;
      case 'DP7':
        a = A.PACE_A;
        d = D.PACE_D;
        base = BASE.DP7 + this.lateDrift();
        strength = K * (a - d);
        break;
      case 'DP8':
        a = A.CTRL;
        d = D.PRS;
        base = ctx.zone === 1 ? BASE_RST.z1 : BASE_RST.z0;
        strength = K * (a - d);
        break;
    }
    const fam = actor.view.familiarity;
    const prep = MORALE_STEP_MOD * actor.input.morale - FAM_MOD_MAX_PENALTY * (1 - fam / 100);
    const home = cfg.neutralVenue ? 0 : actor.isHome ? HOME_MOD : 0;
    const state = this.stateMod(dp, actor, opp);
    const logitNoTac = base + strength + prep + home + state;

    let raw: RawMap = {};
    let tac = 0;
    if (cfg.tacticsEnabled) {
      raw = evalBinaryRules(dp, actor.view, opp.view, ctx, cfg);
      const fc = famCoef(fam);
      let sum = 0;
      for (const k of Object.keys(raw) as RuleId[]) {
        const v = raw[k]!;
        const adj = v > 0 ? v * fc : v;
        raw[k] = adj;
        sum += adj;
      }
      tac = clamp(sum, -cfg.tacCap, cfg.tacCap);
      this.countFires(raw, actor, opp);
    }
    const lo = dp === 'DP5' ? GOAL_P_MIN : P_MIN;
    const hi = dp === 'DP5' ? GOAL_P_MAX : P_MAX;
    const p = clamp(sigmoid(logitNoTac + tac), lo, hi);
    const success = this.rng() < p;
    const entry: BinaryDecisionLog = {
      kind: 'BINARY',
      seq: this.seq,
      minute: this.minute,
      actor: actor.id,
      dp,
      a,
      d,
      base,
      strength,
      prep,
      home,
      ...(state !== 0 ? { state } : {}),
      logitNoTac,
      raw,
      tac,
      p,
      success,
    };
    if (ctx.zone !== undefined) entry.zone = ctx.zone;
    if (ctx.chance !== undefined) entry.chance = ctx.chance;
    if (ctx.side !== undefined) entry.side = ctx.side;
    if (ctx.shooter) entry.shooterId = ctx.shooter.player.id;
    this.log.push(entry);
    return { success, raw, p };
  }

  /** 0.4.0 후반 개방도: 세그먼트(1-based) ≥ 10 에서 DP4·DP7 BASE 가산 */
  private lateDrift(): number {
    const s = this.seg + 1;
    return s >= LATE_DRIFT.fromSeg ? LATE_DRIFT.perSeg * (s - LATE_DRIFT.fromSeg + 1) : 0;
  }

  /** 0.4.0 경기 흐름 (60분 이후 스코어 기반, 전술 cap 밖) */
  private stateMod(dp: BinaryDP, actor: Team, opp: Team): number {
    if (this.minute < STATE_MOD.fromMinute) return 0;
    const diff = actor.goals - opp.goals;
    if (diff === 0) return 0;
    const m = Math.abs(diff) >= 2 ? STATE_MOD.multiGoal : 1;
    if (dp === 'DP1' || dp === 'DP2' || dp === 'DP4') return (diff < 0 ? STATE_MOD.trail : STATE_MOD.lead) * m;
    if (dp === 'DP6' || dp === 'DP7') return diff > 0 ? STATE_MOD.counterVsTrail * m : 0;
    return 0;
  }

  emit(e: MatchEvent): void {
    this.events.push(this.added > 0 ? { ...e, addedMinute: this.added } : e);
  }

  /** 0.4.0 경고: 수비가 막아낸 결정마다 파울 기회. 2경고 = 퇴장 */
  foul(def: Team, dp: 'DP1' | 'DP2' | 'DP4' | 'DP7'): void {
    const unit = dp === 'DP1' ? 'PRS' : dp === 'DP2' ? 'MID' : dp === 'DP4' ? 'BOX' : 'PACE_D';
    const cands: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < def.pitch.length; i++) {
      const ps = def.pitch[i];
      if (!ps || this.formationPos(def, i) === 'GK') continue;
      cands.push(i);
      w.push((ROLE_UNIT_WEIGHTS[def.roles[i]!][unit] ?? 0) + CARD.spread);
    }
    if (cands.length === 0) return;
    const idx = cands[pickWeighted(this.cardRng, w)]!;
    const cfg = this.input.config;
    const p =
      CARD.base *
      ROLE_SHAPE[def.roles[idx]!].card *
      (1 + CARD.perPress * Math.max(0, def.instr.press)) *
      (this.minute >= STATE_MOD.fromMinute && def.goals < this.other(def).goals ? CARD.trailing : 1) *
      (!cfg.neutralVenue && !def.isHome ? CARD.away : 1) *
      (def.pitch[idx]!.yellows > 0 ? CARD.booked : 1);
    if (this.cardRng() >= p) return;
    const ps = def.pitch[idx]!;
    ps.yellows += 1;
    def.stats.yellows += 1;
    this.emit({ type: 'YELLOW_CARD', minute: this.minute, clubId: def.id, playerId: ps.p.id });
    if (ps.yellows >= 2) {
      ps.red = true;
      ps.offMin = this.minute;
      def.pitch[idx] = null;
      def.missing += 1;
      this.emit({ type: 'RED_CARD', minute: this.minute, clubId: def.id, playerId: ps.p.id });
      refreshView(def, this.other(def));
      refreshView(this.other(def), def);
    }
  }

  private countFires(raw: RawMap, actor: Team, opp: Team): void {
    for (const k of Object.keys(raw) as RuleId[]) {
      const v = raw[k]!;
      if (v === 0) continue;
      const t = v > 0 ? actor : opp;
      t.stats.ruleFires[k] = (t.stats.ruleFires[k] ?? 0) + 1;
    }
  }

  /** DP4 유형별 매치업 항 (8.5 표) */
  private matchupTerm(chance: ChanceType | undefined, att: Team, def: Team): number {
    const A = att.view.units;
    const D = def.view.units;
    switch (chance) {
      case 'CROSS':
        return K * (A.AER_A - D.AER_D);
      case 'THROUGH':
        return K * (A.PACE_A - D.PACE_D);
      case 'SOLO': {
        let drib = 0;
        for (const o of att.view.occ) if (o && o.position !== 'GK') drib = Math.max(drib, eff(o, 'dribbling'));
        let s = 0;
        let n = 0;
        for (const o of def.view.occ) {
          if (!o || o.position === 'GK') continue;
          if ((ROLE_UNIT_WEIGHTS[o.role].BOX ?? 0) <= 0) continue;
          s += eff(o, 'tackling');
          n += 1;
        }
        return n > 0 ? K * (drib - s / n) : 0;
      }
      default:
        return 0;
    }
  }

  // ── DP3 찬스 유형 선택 (다항 로짓) ───────────────────────────────────
  chooseChance(att: Team, def: Team, side: Lane): OpenPlayChance {
    const cfg = this.input.config;
    const baseLogits = {} as Record<OpenPlayChance, number>;
    const occ = att.view.occ;
    for (const t of OPEN_CHANCES) {
      let adj = 0;
      const table = CHANCE_ROLE_ADJ[t];
      for (const o of occ) if (o) adj += table[o.role] ?? 0;
      if (t === 'SOLO') {
        let best = 0;
        for (const o of occ) if (o && o.position !== 'GK') best = Math.max(best, o.player.attrs.dribbling);
        adj += Math.max(0, best - SOLO_DRIBBLE_THRESHOLD) * SOLO_PER_POINT;
      }
      adj = clamp(adj, -CHANCE_ROLE_ADJ_MAX, CHANCE_ROLE_ADJ_MAX);
      if (side === 'C') adj += CENTRAL_SIDE_ADJ[t] ?? 0;
      baseLogits[t] = Math.log(CHANCE_BASE_WEIGHT[t]) + adj;
    }
    const rawByType: Record<OpenPlayChance, RawMap> = cfg.tacticsEnabled
      ? evalChoiceRules(att.view, def.view, cfg, side)
      : { CROSS: {}, THROUGH: {}, CUTBACK: {}, LONG: {}, SOLO: {} };
    const tacByType = {} as Record<OpenPlayChance, number>;
    const fc = famCoef(att.view.familiarity);
    for (const t of OPEN_CHANCES) {
      const raw = rawByType[t];
      let sum = 0;
      for (const k of Object.keys(raw) as RuleId[]) {
        const v = raw[k]!;
        const a = v > 0 ? v * fc : v;
        raw[k] = a;
        sum += a;
      }
      tacByType[t] = cfg.tacticsEnabled ? clamp(sum, -cfg.tacCap, cfg.tacCap) : 0;
      if (cfg.tacticsEnabled) this.countFires(raw, att, def);
    }
    const weights = OPEN_CHANCES.map((t) => Math.exp(baseLogits[t] + tacByType[t]));
    const chosen = OPEN_CHANCES[pickWeighted(this.rng, weights)]!;
    this.log.push({
      kind: 'CHOICE',
      seq: this.seq,
      minute: this.minute,
      actor: att.id,
      dp: 'DP3',
      side,
      baseLogits,
      tacByType,
      rawByType,
      chosen,
    });
    return chosen;
  }

  pickSide(att: Team): Lane {
    const target = att.view.attackSide;
    if (!target) {
      const s = SIDE_SPLIT_DEFAULT;
      return (['L', 'C', 'R'] as const)[pickWeighted(this.rng, [s.L, s.C, s.R])]!;
    }
    const s = SIDE_SPLIT_TARGETED;
    const opp: Lane = target === 'L' ? 'R' : 'L';
    return ([target, 'C', opp] as const)[pickWeighted(this.rng, [s.target, s.center, s.opposite])]!;
  }

  // ── 슈팅 ──────────────────────────────────────────────────────────
  private pickShooter(att: Team, chance: ChanceType): Occupant | null {
    const occ = att.view.occ;
    if (chance === 'FK' || chance === 'PK') {
      const pref = att.input.setPieceTaker;
      const byPref = occ.find((o) => o?.player.id === pref);
      if (byPref) return byPref;
      let best: Occupant | null = null;
      let bv = -1;
      for (const o of occ) {
        if (!o || o.position === 'GK') continue;
        const v = mixEff(o, SHOOTER_MIX);
        if (v > bv) {
          bv = v;
          best = o;
        }
      }
      return best;
    }
    const table = SHOOTER_ROLE_WEIGHT[chance];
    const header = chance === 'CROSS' || chance === 'CORNER';
    const cands: Occupant[] = [];
    const weights: number[] = [];
    for (const o of occ) {
      if (!o || o.position === 'GK') continue;
      const w = table[o.role] ?? 0.2;
      const q = header ? eff(o, 'physical') : mixEff(o, SHOOTER_MIX);
      cands.push(o);
      weights.push(w * Math.max(5, q));
    }
    if (cands.length === 0) return null;
    return cands[pickWeighted(this.rng, weights)]!;
  }

  private pState(t: Team, id: string): PState | undefined {
    return t.appeared.find((x) => x.p.id === id);
  }

  private creditRandom(t: Team, unit: 'CRE' | 'PRG' | 'MID' | 'BOX' | 'PRS', exclude: string | undefined, field: 'keyPasses' | 'tackles'): void {
    const cands: Occupant[] = [];
    const w: number[] = [];
    for (const o of t.view.occ) {
      if (!o || o.player.id === exclude) continue;
      const wt = ROLE_UNIT_WEIGHTS[o.role][unit] ?? 0;
      if (wt <= 0) continue;
      cands.push(o);
      w.push(wt);
    }
    if (cands.length === 0) return;
    const o = cands[pickWeighted(this.rng, w)]!;
    const ps = this.pState(t, o.player.id);
    if (ps) ps[field] += 1;
  }

  /** DP5. 반환: 골 여부 */
  shoot(att: Team, def: Team, chance: ChanceType, assisted: 'CRE' | 'PRG' | null, side?: Lane): boolean {
    const shooter = this.pickShooter(att, chance);
    const r = this.decide('DP5', att, def, { chance, ...(shooter ? { shooter } : {}), ...(side ? { side } : {}) });
    const sid = shooter?.player.id ?? att.id;
    att.stats.shots += 1;
    att.stats.xg += r.p;
    att.stats.segXg[this.seg]! += r.p;
    const ps = shooter ? this.pState(att, shooter.player.id) : undefined;
    if (ps) ps.shots += 1;
    if (assisted) this.creditRandom(att, assisted, shooter?.player.id, 'keyPasses');
    // 표시 판정 (별도 스트림): 유효슈팅, 빗나간 슈팅의 코너
    const onTarget = r.success || this.disp() < SOT_Q[chance];
    if (onTarget) att.stats.sot += 1;
    else if (chance !== 'PK' && this.disp() < DISPLAY.blockedCorner) att.stats.corners += 1;
    this.emit({ type: 'SHOT', minute: this.minute, clubId: att.id, playerId: sid, chance, xg: r.p, goal: r.success, onTarget });
    if (r.success) {
      att.goals += 1;
      if (ps) ps.goals += 1;
      this.emit({ type: 'GOAL', minute: this.minute, clubId: att.id, playerId: sid, chance, xg: r.p });
    }
    return r.success;
  }

  // ── 턴오버 → DP6 → DP7 ───────────────────────────────────────────
  turnover(loser: Team, winner: Team, z: Zone): SeqEnd {
    this.creditRandom(winner, z === 0 ? 'PRS' : z === 1 ? 'MID' : 'BOX', undefined, 'tackles');
    const start = (2 - z) as Zone;
    if (z >= 1) {
      const d6 = this.decide('DP6', winner, loser, { zone: z });
      if (d6.success) {
        winner.stats.counters += 1;
        this.emit({ type: 'COUNTER_ATTACK', minute: this.minute, clubId: winner.id });
        const d7 = this.decide('DP7', winner, loser, { zone: z, chance: 'COUNTER' });
        if (d7.success) {
          winner.stats.segEntries[this.seg]! += 1;
          this.shoot(winner, loser, 'COUNTER', 'PRG');
          return { next: loser, zone: 0 };
        }
        this.foul(loser, 'DP7');
        if (this.disp() < DISPLAY.counterOffside) this.displayOffside(winner);
      }
    }
    return { next: winner, zone: start };
  }

  private displayOffside(att: Team): void {
    att.stats.offsides += 1;
    const target = att.view.occ.find((o) => o && ROLE_SHAPE[o.role].run === 1) ?? att.view.occ.find((o) => o?.position === 'ST');
    this.emit({ type: 'OFFSIDE', minute: this.minute, clubId: att.id, ...(target ? { playerId: target.player.id } : {}) });
  }

  // ── 점유 시퀀스 ─────────────────────────────────────────────────
  runSequence(att: Team, def: Team, startZone: Zone): SeqEnd {
    this.seqResets = 0;
    this.seqAdv = 0;
    const end = this.runSequenceInner(att, def, startZone);
    const P = POSSESSION_WEIGHT;
    const d = att.instr.directness;
    const f = d >= 1 ? 1 - P.direct * d : 1 + P.short * -d;
    const cen = d <= 0 ? Math.max(0.5, 1 + P.central * (att.view.shape.cA - P.centralRef)) : 1;
    att.stats.possW += (1 + P.reset * this.seqResets + P.advance * this.seqAdv) * f * (1 + P.mentality * att.instr.mentality) * cen;
    return end;
  }

  private runSequenceInner(att: Team, def: Team, startZone: Zone): SeqEnd {
    this.seq += 1;
    att.stats.seqs += 1;
    let zone: Zone = startZone;
    let resets = 0;
    while (zone < 2) {
      const dp: BinaryDP = zone === 0 ? 'DP1' : 'DP2';
      const zp = att.stats.zone[zone];
      zp.attempts += 1;
      const r = this.decide(dp, att, def, { zone });
      if (r.success) {
        zp.successes += 1;
        this.seqAdv += 1;
        if (dp === 'DP1' && r.raw.R2 !== undefined && r.raw.R2 !== 0) {
          att.stats.longBalls += 1;
          this.emit({ type: 'LONG_BALL_ADVANCE', minute: this.minute, clubId: att.id });
        }
        zone = (zone + 1) as Zone;
        continue;
      }
      this.foul(def, dp);
      if (resets < MAX_RESETS_PER_SEQUENCE && this.decide('DP8', att, def, { zone }).success) {
        resets += 1;
        this.seqResets += 1;
        zone = Math.max(0, zone - 1) as Zone;
        continue;
      }
      return this.turnover(att, def, zone);
    }
    att.stats.segEntries[this.seg]! += 1;
    const side = this.pickSide(att);
    const chance = this.chooseChance(att, def, side);
    const z2 = att.stats.zone[2];
    z2.attempts += 1;
    const r4 = this.decide('DP4', att, def, { zone: 2, chance, side });
    if (r4.success) {
      z2.successes += 1;
      this.seqAdv += 1;
      const inBox = chance === 'CROSS' || chance === 'THROUGH' || chance === 'CUTBACK' || chance === 'SOLO';
      const shotType: ChanceType = inBox && this.rng() < PK_SHARE_IN_BOX ? 'PK' : chance;
      this.shoot(att, def, shotType, shotType === 'SOLO' || shotType === 'PK' ? null : 'CRE', side);
      return { next: def, zone: 0 };
    }
    if (chance === 'THROUGH' && r4.raw.R6 !== undefined && r4.raw.R6 !== 0) {
      att.stats.offsides += 1;
      const target = att.view.occ.find((o) => o && ROLE_SHAPE[o.role].run === 1);
      this.emit({
        type: 'OFFSIDE',
        minute: this.minute,
        clubId: att.id,
        ...(target ? { playerId: target.player.id } : {}),
      });
      return { next: def, zone: 0 };
    }
    this.foul(def, 'DP4');
    const br = Z2_FAIL_BRANCH[chance === 'CROSS' ? 'CROSS' : 'DEFAULT'];
    const k = pickWeighted(this.rng, [br.corner, br.freeKick, br.turnover]);
    if (k === 0) {
      att.stats.corners += 1;
      this.shoot(att, def, 'CORNER', 'CRE');
      return { next: def, zone: 0 };
    }
    if (k === 1) {
      this.shoot(att, def, 'FK', null);
      return { next: def, zone: 0 };
    }
    if (chance === 'THROUGH' && this.disp() < DISPLAY.throughOffside) this.displayOffside(att);
    return this.turnover(att, def, 2);
  }

  // ── 세그먼트 경계 처리 ───────────────────────────────────────────
  applyFatigue(t: Team): void {
    const markerId = t.view.markerId;
    for (const ps of t.pitch) {
      if (!ps) continue;
      const idx = t.pitch.indexOf(ps);
      const role = t.roles[idx]!;
      const drain =
        (CONDITION.fullMatchDrain +
          CONDITION.pressDrainPerStep * Math.max(0, t.instr.press) -
          CONDITION.lowPressRelief * Math.max(0, -t.instr.press) +
          CONDITION.tempoDrainPerStep * Math.max(0, t.instr.tempo) -
          CONDITION.lowLineRelief * Math.max(0, -t.instr.line) +
          (ROLE_EXTRA_DRAIN[role] ?? 0) +
          (ps.p.id === markerId ? CONDITION.markerExtraDrain : 0)) /
        SEGMENTS;
      ps.cond = Math.max(0, ps.cond - drain);
      if (!ps.dropped && ps.cond < CONDITION.effLinearLowAt) {
        ps.dropped = true;
        this.emit({ type: 'CONDITION_DROP', minute: this.minute, clubId: t.id, playerId: ps.p.id, condition: Math.round(ps.cond) });
      }
    }
  }

  /** 부상·퇴장 판정. 반환: 이번 경계에서 교체가 필요한 부상 선수 슬롯 */
  rollIncidents(t: Team): PState[] {
    const injured: PState[] = [];
    for (let i = 0; i < t.pitch.length; i++) {
      const ps = t.pitch[i];
      if (!ps) continue;
      const rate = (CONDITION.injuryBaseRate * (ps.cond < CONDITION.injuryLowConditionBelow ? CONDITION.injuryLowConditionMult : 1)) / SEGMENTS;
      if (this.rng() < rate) {
        const days = CONDITION.injuryDaysMin + Math.floor(this.rng() * (CONDITION.injuryDaysMax - CONDITION.injuryDaysMin + 1));
        ps.injuredDays = days;
        this.emit({ type: 'INJURY', minute: this.minute, clubId: t.id, playerId: ps.p.id, days });
        injured.push(ps);
      }
    }
    if (this.rng() < CONDITION.redCardPerTeamMatch / SEGMENTS) {
      const cands: number[] = [];
      for (let i = 0; i < t.pitch.length; i++) {
        const ps = t.pitch[i];
        if (ps && this.formationPos(t, i) !== 'GK' && !injured.includes(ps)) cands.push(i);
      }
      if (cands.length > 0) {
        const idx = cands[Math.floor(this.rng() * cands.length)]!;
        const ps = t.pitch[idx]!;
        ps.red = true;
        ps.offMin = this.minute;
        t.pitch[idx] = null;
        t.missing += 1;
        this.emit({ type: 'RED_CARD', minute: this.minute, clubId: t.id, playerId: ps.p.id });
      }
    }
    return injured;
  }

  private formationPos(t: Team, i: number) {
    return t.formation.slots[i]!.position;
  }

  private conditionHolds(c: TriggerCondition, t: Team, boundary: number): boolean {
    if (c.kind === 'TIME') return c.after === 'HT' ? boundary === 45 : boundary >= c.after;
    const diff = t.goals - this.other(t).goals;
    const need = Math.max(1, c.minDiff ?? 1);
    if (c.state === 'DRAW') return diff === 0;
    if (c.state === 'LEAD') return diff >= need;
    return -diff >= need;
  }

  evaluateTriggers(t: Team, boundary: number): void {
    for (const order of t.input.conditionals) {
      if (!order.enabled || t.fired.has(order.id)) continue;
      if (order.conditions.length === 0) continue;
      if (!order.conditions.every((c) => this.conditionHolds(c, t, boundary))) continue;
      t.fired.add(order.id);
      this.emit({
        type: 'TRIGGER_FIRED',
        minute: boundary,
        clubId: t.id,
        conditionalId: order.id,
        description: this.applyAction(t, order),
      });
      return; // 경계당 1개 (위에서부터 우선)
    }
  }

  private applyAction(t: Team, order: ConditionalOrder): string {
    const a = order.action;
    const step = (v: number) => clamp(v, -2, 2) as Step;
    if (a.kind === 'SWITCH_SLOT') {
      if (a.slot !== t.slotKey) {
        const slot = t.input.slots[a.slot];
        const formation = FORMATIONS[slot.formation];
        const players = t.pitch.filter((x): x is PState => x !== null);
        t.slotKey = a.slot;
        t.formation = formation;
        t.roles = formation.slots.map((s, i) => slot.roles[i] ?? s.defaultRole);
        t.instr = { ...slot.instructions };
        t.pitch = reassign(players, formation);
      }
      return `전술 ${a.slot} 전환 (${t.formation.label})`;
    }
    if (a.kind === 'MENTALITY_DELTA') {
      t.instr = { ...t.instr, mentality: step(t.instr.mentality + a.delta) };
      return `공격 성향 ${a.delta > 0 ? '+' : ''}${a.delta} → ${t.instr.mentality}`;
    }
    const htOnly = order.conditions.some((c) => c.kind === 'TIME' && c.after === 'HT');
    if (!htOnly) return '하프타임 조정 무시 (하프타임 조건 전용)';
    t.instr = { ...t.instr, [a.target]: step(t.instr[a.target] + a.delta) };
    return `${a.target === 'tempo' ? '템포' : '압박'} ${a.delta > 0 ? '+1' : '−1'}`;
  }

  substitutions(t: Team, boundary: number, injured: PState[], isHalfTime: boolean): void {
    const threshold = t.input.autoSubThreshold;
    const want: { idx: number; reason: 'INJURY' | 'CONDITION' }[] = [];
    for (const ps of injured) {
      const idx = t.pitch.indexOf(ps);
      if (idx >= 0) want.push({ idx, reason: 'INJURY' });
    }
    const tired = t.pitch
      .map((ps, idx) => ({ ps, idx }))
      .filter((x) => x.ps && !injured.includes(x.ps) && x.ps.cond <= threshold)
      .sort((x, y) => x.ps!.cond - y.ps!.cond || x.idx - y.idx);
    for (const x of tired) want.push({ idx: x.idx, reason: 'CONDITION' });
    let anySub = false;
    const windowOk = isHalfTime || t.windowsUsed < SUB_WINDOWS;
    for (const w of want) {
      const out = t.pitch[w.idx];
      if (!out) continue;
      let done = false;
      if (windowOk && t.subsUsed < MAX_SUBS) {
        const slotPos = this.formationPos(t, w.idx);
        const role = t.roles[w.idx]!;
        let best = -1;
        let bestScore = -Infinity;
        for (let b = 0; b < t.bench.length; b++) {
          const cand = t.bench[b]!.p;
          const fit = fitOf(cand, slotPos);
          if (w.reason === 'CONDITION') {
            if (fit === 'UNSUITED') continue;
            if (slotPos === 'GK' && cand.primary !== 'GK') continue;
          }
          if (slotPos !== 'GK' && cand.primary === 'GK') continue;
          const score = FIT_MULT[fit] * conditionEfficiency(t.bench[b]!.cond) * (10 + keyAttrAvg(cand, role));
          if (score > bestScore) {
            bestScore = score;
            best = b;
          }
        }
        if (best >= 0) {
          const inc = t.bench.splice(best, 1)[0]!;
          inc.onMin = boundary;
          out.offMin = boundary;
          t.pitch[w.idx] = inc;
          t.appeared.push(inc);
          t.subsUsed += 1;
          anySub = true;
          done = true;
          this.emit({ type: 'SUBSTITUTION', minute: boundary, clubId: t.id, out: out.p.id, in: inc.p.id, reason: w.reason });
        }
      }
      if (!done && w.reason === 'INJURY') {
        out.offMin = boundary;
        t.pitch[w.idx] = null;
        t.missing += 1;
      }
    }
    if (anySub && !isHalfTime) t.windowsUsed += 1;
  }

  run(): MatchResult {
    const { home, away } = this;
    const rng = this.rng;
    const tempoMean = (home.instr.tempo + away.instr.tempo) / 2;
    const tempoFactor = 1 + TEMPO_FACTOR_PER_STEP * tempoMean;
    const jitter = 1 + (rng() * 2 - 1) * SEQUENCE_JITTER;
    const total = Math.round(BASE_SEQUENCES * tempoFactor * jitter);
    const perSeg = new Array<number>(SEGMENTS).fill(Math.floor(total / SEGMENTS));
    const order = Array.from({ length: SEGMENTS }, (_, i) => i);
    for (let i = SEGMENTS - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (let r = 0; r < total - SEGMENTS * Math.floor(total / SEGMENTS); r++) perSeg[order[r]!]! += 1;
    for (const [k, m] of Object.entries(STOPPAGE)) perSeg[Number(k)] = Math.round(perSeg[Number(k)]! * m);

    const kickOff = rng() < 0.5 ? home : away;
    let attacker = kickOff;
    let zone: Zone = 0;
    const startFormations = { home: home.formation.id, away: away.formation.id };
    const startInstr = { home: { ...home.instr }, away: { ...away.instr } };
    const momentum: number[] = [];

    this.emit({ type: 'KICK_OFF', minute: 0 });
    for (let seg = 0; seg < SEGMENTS; seg++) {
      this.seg = seg;
      if (seg === SEGMENTS / 2) {
        this.emit({ type: 'HALF_TIME', minute: 45 });
        attacker = this.other(kickOff);
        zone = 0;
      }
      refreshView(home, away);
      refreshView(away, home);
      const n = perSeg[seg]!;
      for (let s = 0; s < n; s++) {
        const mult = STOPPAGE[seg] ?? 1;
        const m = Math.floor(seg * SEGMENT_MINUTES + (s * SEGMENT_MINUTES * mult) / n) + 1;
        const segEnd = (seg + 1) * SEGMENT_MINUTES;
        this.added = m > segEnd ? m - segEnd : 0;
        this.minute = Math.min(segEnd, m);
        const r = this.runSequence(attacker, this.other(attacker), zone);
        attacker = r.next;
        zone = r.zone;
      }
      const boundary = (seg + 1) * SEGMENT_MINUTES;
      this.minute = boundary;
      this.added = 0;
      this.applyFatigue(home);
      this.applyFatigue(away);
      const injH = this.rollIncidents(home);
      const injA = this.rollIncidents(away);
      if (seg < SEGMENTS - 1) {
        this.evaluateTriggers(home, boundary);
        this.evaluateTriggers(away, boundary);
        const ht = boundary === 45;
        this.substitutions(home, boundary, injH, ht);
        this.substitutions(away, boundary, injA, ht);
      } else {
        for (const [t, inj] of [
          [home, injH],
          [away, injA],
        ] as const) {
          for (const ps of inj) if (t.pitch.includes(ps)) ps.offMin = 90;
        }
      }
      const hE = home.stats.segEntries[seg]!;
      const aE = away.stats.segEntries[seg]!;
      const hx = home.stats.segXg[seg]!;
      const ax = away.stats.segXg[seg]!;
      momentum.push(round3(clamp((hE - aE + 3 * (hx - ax)) / Math.max(4, hE + aE), -1, 1)));
    }
    this.emit({ type: 'FULL_TIME', minute: 90 });

    const totalSeqs = home.stats.seqs + away.stats.seqs;
    const possTotal = home.stats.possW + away.stats.possW;
    const teamStats = (t: Team, side: 'home' | 'away'): TeamMatchStats => ({
      clubId: t.id,
      goals: t.goals,
      xg: t.stats.xg,
      shots: t.stats.shots,
      possession: totalSeqs > 0 ? t.stats.seqs / totalSeqs : 0.5,
      zonePass: { z0: t.stats.zone[0], z1: t.stats.zone[1], z2: t.stats.zone[2] },
      counters: t.stats.counters,
      offsides: t.stats.offsides,
      longBallAdvances: t.stats.longBalls,
      ruleFires: t.stats.ruleFires,
      formationStart: startFormations[side],
      instructionsStart: startInstr[side],
      shotsOnTarget: t.stats.sot,
      corners: t.stats.corners,
      yellowCards: t.stats.yellows,
      possessionTime: possTotal > 0 ? t.stats.possW / possTotal : 0.5,
    });
    const lines = (t: Team): PlayerMatchLine[] =>
      t.appeared.map((ps) => ({
        playerId: ps.p.id,
        clubId: t.id,
        started: ps.started,
        minutes: Math.max(0, (ps.offMin ?? 90) - ps.onMin),
        goals: ps.goals,
        shots: ps.shots,
        keyPasses: ps.keyPasses,
        tackles: ps.tackles,
        conditionAfter: Math.round(ps.cond),
        injuredDays: ps.injuredDays,
        redCard: ps.red,
        yellowCards: ps.yellows,
      }));

    return {
      matchId: this.input.matchId,
      seed: this.input.seed,
      engineVersion: this.input.config.engineVersion,
      tacCap: this.input.config.tacCap,
      home: teamStats(home, 'home'),
      away: teamStats(away, 'away'),
      events: this.events,
      players: [...lines(home), ...lines(away)],
      momentum,
      log: this.log,
    };
  }
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function simulateMatch(input: SimulateInput): MatchResult {
  return new Match(input).run();
}

/** 조건부 지시 중 SWITCH_SLOT 으로 사용된 슬롯 (도메인 숙련도 반영용) */
export function usedSlotsOf(result: MatchResult, team: EngineTeamInput): SlotKey[] {
  const used: SlotKey[] = [team.startSlot];
  for (const e of result.events) {
    if (e.type !== 'TRIGGER_FIRED' || e.clubId !== team.clubId) continue;
    const c = team.conditionals.find((x) => x.id === e.conditionalId);
    if (c?.action.kind === 'SWITCH_SLOT' && !used.includes(c.action.slot)) used.push(c.action.slot);
  }
  return used;
}
