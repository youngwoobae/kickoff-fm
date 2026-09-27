/**
 * 8.8 승부 요인 기여도 (합 보존 분해). 소유: A.
 * 추가 시뮬레이션 없이 MatchResult.log 만으로 계산한다.
 */
import type {
  BinaryDecisionLog,
  ClubId,
  FactorBars,
  MatchExplanation,
  MatchResult,
  OpenPlayChance,
  RuleContribution,
  RuleId,
  TeamExplanation,
  ValueTable,
} from '../types';
import { GOAL_P_MAX, GOAL_P_MIN, P_MAX, P_MIN } from './data/constants';
import { clamp, sigmoid } from './math';

interface Acc {
  rules: Map<RuleId, RuleContribution>;
  bars: FactorBars;
  conservationError: number;
}

export function valueOf(L: BinaryDecisionLog, values: ValueTable): number {
  switch (L.dp) {
    case 'DP1':
      return values.DP1;
    case 'DP2':
      return values.DP2;
    case 'DP4': {
      const c = L.chance;
      if (c === 'CROSS' || c === 'THROUGH' || c === 'CUTBACK' || c === 'LONG' || c === 'SOLO' || c === 'COUNTER') return values.DP4[c];
      return values.DP4.CUTBACK;
    }
    case 'DP5':
      return 1;
    case 'DP6':
      return values.DP6;
    case 'DP7':
      return values.DP7;
    case 'DP8':
      return L.zone === 1 ? values.DP8.z1 : values.DP8.z0;
  }
}

/** 결정 지점 하나의 규칙별 Δp 분해 (Σ Δp_i = Δp_tac) */
export function decomposeBinary(L: BinaryDecisionLog): { p0: number; dTac: number; parts: Partial<Record<RuleId, number>> } {
  const lo = L.dp === 'DP5' ? GOAL_P_MIN : P_MIN;
  const hi = L.dp === 'DP5' ? GOAL_P_MAX : P_MAX;
  const p0 = clamp(sigmoid(L.logitNoTac), lo, hi);
  const dTac = L.p - p0;
  const keys = Object.keys(L.raw) as RuleId[];
  let S = 0;
  for (const k of keys) S += L.raw[k]!;
  const g = L.tac === 0 ? p0 * (1 - p0) : dTac / L.tac;
  const parts: Partial<Record<RuleId, number>> = {};
  for (const k of keys) {
    const a = S === 0 ? 0 : (L.raw[k]! * L.tac) / S;
    parts[k] = a * g;
  }
  return { p0, dTac, parts };
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

export function explainMatch(result: MatchResult, values: ValueTable): MatchExplanation {
  const homeId = result.home.clubId;
  const awayId = result.away.clubId;
  const acc: Record<ClubId, Acc> = {
    [homeId]: { rules: new Map(), bars: { strength: 0, prep: 0, state: 0, tactics: 0, luck: 0 }, conservationError: 0 },
    [awayId]: { rules: new Map(), bars: { strength: 0, prep: 0, state: 0, tactics: 0, luck: 0 }, conservationError: 0 },
  };
  const other = (id: ClubId) => (id === homeId ? awayId : homeId);
  const rule = (team: ClubId, id: RuleId): RuleContribution => {
    const m = acc[team]!.rules;
    let r = m.get(id);
    if (!r) {
      r = { ruleId: id, xg: 0, firesFor: 0, firesAgainst: 0 };
      m.set(id, r);
    }
    return r;
  };

  for (const L of result.log) {
    const X = L.actor;
    const Y = other(X);
    if (L.kind === 'BINARY') {
      const V = valueOf(L, values);
      const { dTac, parts } = decomposeBinary(L);
      let sumDp = 0;
      for (const k of Object.keys(parts) as RuleId[]) {
        const dp = parts[k]!;
        sumDp += dp;
        const xg = dp * V;
        rule(X, k).xg += xg;
        rule(Y, k).xg -= xg;
        const raw = L.raw[k]!;
        if (raw > 0) {
          rule(X, k).firesFor += 1;
          rule(Y, k).firesAgainst += 1;
        } else if (raw < 0) {
          rule(Y, k).firesFor += 1;
          rule(X, k).firesAgainst += 1;
        }
        acc[X]!.bars.tactics += xg;
        acc[Y]!.bars.tactics -= xg;
      }
      acc[X]!.conservationError += Math.abs(sumDp - dTac);
      const pb = sigmoid(L.base);
      const ps = sigmoid(L.base + L.strength);
      const pp = sigmoid(L.base + L.strength + L.prep + L.home);
      acc[X]!.bars.strength += (ps - pb) * V;
      acc[Y]!.bars.strength -= (ps - pb) * V;
      acc[X]!.bars.prep += (pp - ps) * V;
      acc[Y]!.bars.prep -= (pp - ps) * V;
      const pst = sigmoid(L.logitNoTac);
      acc[X]!.bars.state! += (pst - pp) * V;
      acc[Y]!.bars.state! -= (pst - pp) * V;
    } else {
      const types = Object.keys(L.baseLogits) as OpenPlayChance[];
      const pWith = softmax(types.map((t) => L.baseLogits[t] + L.tacByType[t]));
      const pWithout = softmax(types.map((t) => L.baseLogits[t]));
      types.forEach((t, i) => {
        const dP = pWith[i]! - pWithout[i]!;
        const raw = L.rawByType[t];
        const ks = Object.keys(raw) as RuleId[];
        let S = 0;
        for (const k of ks) S += raw[k]!;
        if (S === 0) return;
        for (const k of ks) {
          const xg = dP * (raw[k]! / S) * values.chanceEv[t];
          rule(X, k).xg += xg;
          rule(Y, k).xg -= xg;
          acc[X]!.bars.tactics += xg;
          acc[Y]!.bars.tactics -= xg;
          if (raw[k]! > 0) {
            rule(X, k).firesFor += 1;
            rule(Y, k).firesAgainst += 1;
          } else if (raw[k]! < 0) {
            rule(Y, k).firesFor += 1;
            rule(X, k).firesAgainst += 1;
          }
        }
      });
    }
  }

  const build = (id: ClubId, gf: number, ga: number, xgf: number, xga: number): TeamExplanation => {
    const a = acc[id]!;
    a.bars.luck = gf - ga - (xgf - xga);
    const rules = [...a.rules.values()].sort((p, q) => Math.abs(q.xg) - Math.abs(p.xg) || p.ruleId.localeCompare(q.ruleId));
    return { clubId: id, rules, bars: a.bars, conservationError: a.conservationError };
  };
  const h = result.home;
  const w = result.away;
  return {
    matchId: result.matchId,
    home: build(homeId, h.goals, w.goals, h.xg, w.xg),
    away: build(awayId, w.goals, h.goals, w.xg, h.xg),
  };
}
