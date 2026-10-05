/**
 * 감독 AI 단일 모듈 (3.5, 6.6). 봇 운영, "추천대로", 자동 로테이션, 유효성 보정이 같은 코드를 쓰고
 * 강도 파라미터(mode)만 다르다. 소유: A.
 */
import type {
  Club,
  ConditionalOrder,
  FormationId,
  MatchPlan,
  OpponentScout,
  Player,
  Position,
  RoleId,
  SlotKey,
  StyleId,
  TacticSlot,
  TeamInstructions,
} from '../../types';
import {
  EngineConstants,
  FORMATIONS,
  PRESETS,
  ROLES,
  STYLES,
  conditionEfficiency,
  defaultRoles,
  fitOf,
  type Rng,
} from '../../engine';
import { ovrAt } from '../squad/ovr';
import { tacticEdgeTotal, type TacticShape } from './matchup';

export type ManagerAiMode = 'BOT' | 'RECOMMEND' | 'SYSTEM_DEFAULT';

export interface ManagerAiContext {
  club: Club;
  players: Readonly<Record<string, Player>>;
  opponentId: string | null;
  scout?: OpponentScout;
  /** 상대의 최근 사용 전술 (BOT 슬롯 선택용, 도메인 내부 확장) */
  opponentTactic?: TacticShape;
  mode: ManagerAiMode;
  rng: Rng;
}

function slot(key: SlotKey, formation: FormationId, instructions: TeamInstructions, familiarity: number, roleOverrides: Partial<Record<number, RoleId>> = {}): TacticSlot {
  const roles = defaultRoles(formation).map((r, i) => roleOverrides[i] ?? r);
  return { key, formation, roles, instructions: { ...instructions }, familiarity };
}

const PROTECT: TeamInstructions = { mentality: -1, press: 0, line: -1, width: 0, tempo: -1, directness: 0, counter: true, offsideTrap: false };
const CHASE: TeamInstructions = { mentality: 2, press: 1, line: 1, width: 1, tempo: 1, directness: 1, counter: false, offsideTrap: false };

/**
 * 스타일별 기본 전술 슬롯 A/B (A = 스타일 그대로: 권장 포메이션·역할·지시, B = 같은 포메이션의 리드 지키기 또는 추격).
 * 봇 성향 8종과 사람 구단 스타일 적용이 같은 데이터(STYLES)를 쓴다.
 */
export function styleTactics(style: StyleId): { A: TacticSlot; B: TacticSlot } {
  const d = STYLES[style];
  const A: TacticSlot = { key: 'A', formation: d.formation, roles: [...d.roles], instructions: { ...d.instructions }, familiarity: 80 };
  const B: TacticSlot = { key: 'B', formation: d.formation, roles: [...d.roles], instructions: { ...(d.instructions.mentality <= -1 ? CHASE : PROTECT) }, familiarity: 55 };
  return { A, B };
}

/** 사람 구단 창단 기본 전술: A 4-2-3-1 균형, B 4-4-2 지키기 */
export function humanDefaultTactics(): { A: TacticSlot; B: TacticSlot } {
  return { A: slot('A', '4-2-3-1', PRESETS.BALANCED.instructions, 70), B: slot('B', '4-4-2', PROTECT, 50) };
}

export function isAvailable(p: Player | undefined): boolean {
  return !!p && p.availability.injuryDays <= 0 && p.availability.suspendedMatches <= 0;
}

/** 자리 적합 점수: 포지션 기준 OVR × 적합도 × 컨디션 효율 (+ 역할 핵심 능력치) */
export function slotScore(p: Player, position: Position, role: RoleId, rotationPenalty: boolean): number {
  const fit = fitOf(p, position);
  const keys = ROLES[role].keyAttrs;
  const key = keys.reduce((s, k) => s + p.attrs[k], 0) / keys.length;
  let v = (ovrAt(p, position) + key * 1.5) * EngineConstants.FIT_MULT[fit] * conditionEfficiency(p.condition);
  if (position === 'GK' && p.primary !== 'GK') v *= 0.2;
  if (position !== 'GK' && p.primary === 'GK') v *= 0.2;
  if (rotationPenalty && p.condition < EngineConstants.CONDITION.autoRotationBelow) v *= 0.8;
  return v;
}

/** 최적 선발 11 + 벤치 7 (적합도 × 컨디션 효율 × 역할 핵심 능력치) */
export function pickLineup(ctx: ManagerAiContext, tactic: TacticSlot): MatchPlan['lineup'] {
  const formation = FORMATIONS[tactic.formation];
  const squad = ctx.club.playerIds.map((id) => ctx.players[id]).filter((p): p is Player => !!p);
  let pool = squad.filter(isAvailable);
  if (pool.length < 11) {
    // 가용 인원 부족: 부상 기간이 짧은 선수부터 채운다 (Phase 0 임시 계약 선수 대체)
    const rest = squad
      .filter((p) => !isAvailable(p))
      .sort((a, b) => a.availability.injuryDays + a.availability.suspendedMatches * 3 - (b.availability.injuryDays + b.availability.suspendedMatches * 3));
    pool = [...pool, ...rest.slice(0, 11 - pool.length)];
  }
  const starters: (string | null)[] = new Array<string | null>(formation.slots.length).fill(null);
  const freeSlots = formation.slots.map((s) => s.index);
  const used = new Set<string>();
  // 점수는 탐욕 루프 동안 변하지 않으므로 (자리 × 선수) 한 번만 계산한다 (M7.2: 하루 처리의 ~10%)
  const scores = new Map<number, number[]>(
    freeSlots.map((idx) => {
      const fs = formation.slots[idx]!;
      const role = tactic.roles[fs.index] ?? fs.defaultRole;
      return [idx, pool.map((p) => slotScore(p, fs.position, role, true))];
    }),
  );
  while (freeSlots.length > 0) {
    let best = -Infinity;
    let bp: Player | null = null;
    let bsIdx = 0;
    for (let j = 0; j < freeSlots.length; j++) {
      const row = scores.get(freeSlots[j]!)!;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]!;
        if (used.has(p.id)) continue;
        const v = row[i]!;
        if (v > best) {
          best = v;
          bp = p;
          bsIdx = j;
        }
      }
    }
    if (!bp) break;
    starters[freeSlots[bsIdx]!] = bp.id;
    used.add(bp.id);
    freeSlots.splice(bsIdx, 1);
  }
  const bench: string[] = [];
  const rest = pool.filter((p) => !used.has(p.id));
  const overall = new Map<string, number>();
  const bestOverall = (p: Player) => {
    let v = overall.get(p.id);
    if (v === undefined) {
      v =
        Math.max(...(['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'] as Position[]).map((pos) => ovrAt(p, pos) * EngineConstants.FIT_MULT[fitOf(p, pos)])) *
        conditionEfficiency(p.condition);
      overall.set(p.id, v);
    }
    return v;
  };
  const take = (pred: (p: Player) => boolean) => {
    const c = rest.filter((p) => pred(p) && !bench.includes(p.id)).sort((a, b) => bestOverall(b) - bestOverall(a) || a.id.localeCompare(b.id))[0];
    if (c && bench.length < 7) bench.push(c.id);
  };
  take((p) => p.primary === 'GK');
  take((p) => p.primary === 'CB' || p.primary === 'FB');
  take((p) => p.primary === 'DM' || p.primary === 'CM' || p.primary === 'AM');
  take((p) => p.primary === 'W' || p.primary === 'ST');
  while (bench.length < 7) {
    const before = bench.length;
    take((p) => p.primary !== 'GK');
    if (bench.length === before) break;
  }
  return { starters: starters.filter((x): x is string => x !== null), bench };
}

function chooseSlot(ctx: ManagerAiContext): SlotKey {
  if (ctx.mode !== 'BOT' || !ctx.opponentTactic) return 'A';
  const shape = (s: TacticSlot): TacticShape => ({ formation: s.formation, instructions: s.instructions, roles: s.roles });
  const a = tacticEdgeTotal(shape(ctx.club.tactics.A), ctx.opponentTactic) + 0.05 * (ctx.club.tactics.A.familiarity / 100);
  const b = tacticEdgeTotal(shape(ctx.club.tactics.B), ctx.opponentTactic) + 0.05 * (ctx.club.tactics.B.familiarity / 100);
  // 숙련도가 낮은 슬롯으로 바꾸려면 상성 이득이 충분해야 한다 (famMod 비용)
  return b > a + 0.1 ? 'B' : 'A';
}

/** 봇 조건부 지시 템플릿 "지키기·추격" (3.5 #5) */
export function botConditionals(club: Club, start: SlotKey): ConditionalOrder[] {
  const other: SlotKey = start === 'A' ? 'B' : 'A';
  const otherIsDefensive = club.tactics[other].instructions.mentality < club.tactics[start].instructions.mentality;
  return [
    {
      id: 'bot-hold',
      conditions: [
        { kind: 'TIME', after: 60 },
        { kind: 'SCORE', state: 'LEAD', minDiff: 1 },
      ],
      action: otherIsDefensive ? { kind: 'SWITCH_SLOT', slot: other } : { kind: 'MENTALITY_DELTA', delta: -1 },
      enabled: true,
    },
    {
      id: 'bot-chase',
      conditions: [
        { kind: 'TIME', after: 60 },
        { kind: 'SCORE', state: 'TRAIL', minDiff: 1 },
      ],
      action: { kind: 'MENTALITY_DELTA', delta: 1 },
      enabled: true,
    },
  ];
}

export function buildPlan(ctx: ManagerAiContext): MatchPlan {
  const start = chooseSlot(ctx);
  const tactic = ctx.club.tactics[start];
  return {
    clubId: ctx.club.id,
    matchId: null,
    lineup: pickLineup(ctx, tactic),
    startSlot: start,
    conditionals: ctx.mode === 'BOT' ? botConditionals(ctx.club, start) : [],
    autoSubThreshold: EngineConstants.CONDITION.autoSubDefault,
    autoRotation: true,
  };
}
