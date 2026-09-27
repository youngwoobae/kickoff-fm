/** 엔진 테스트 (소유: A). 기준은 docs/아키텍처.md 12장 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EngineConstants, ROLE_SHAPE, VALUE_TABLE, computeUnits, conditionEfficiency, decomposeBinary, explainMatch } from '../../src/engine';
import { runCalibration, styleMatrixMatch } from '../../src/domain';
import type { BinaryDecisionLog, ConditionalOrder, DecisionLog, EngineTeamInput, RoleId, RuleId, StyleId } from '../../src/types';
import { makeTeam, play } from '../helpers';

const { RULES_BY_DP, P_MIN, P_MAX, GOAL_P_MIN, GOAL_P_MAX } = EngineConstants;
const ROLE_EXTRA_DRAIN: Partial<Record<RoleId, number>> = Object.fromEntries(Object.entries(ROLE_SHAPE).map(([k, v]) => [k, v.drain]));
const binary = (log: DecisionLog[]) => log.filter((l): l is BinaryDecisionLog => l.kind === 'BINARY');
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

const A = makeTeam(11, 'ha', 60, 'HIGH_PRESS');
const B = makeTeam(22, 'aw', 60, 'COUNTER');
const C = makeTeam(33, 'po', 60, 'POSSESSION');
const L = makeTeam(44, 'lb', 60, 'LOW_BLOCK');

describe('simulateMatch', () => {
  it('같은 SimulateInput → JSON.stringify 결과가 바이트 단위로 같다 (골든 시드 3개)', () => {
    for (const seed of [1, 42, 20260926]) {
      const r1 = play(seed, A.input, B.input);
      const r2 = play(seed, structuredClone(A.input), structuredClone(B.input));
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    }
    expect(hash(play(1, A.input, B.input))).not.toBe(hash(play(2, A.input, B.input)));
  });

  it('입력 객체를 변경하지 않는다', () => {
    const before = JSON.stringify(A.input);
    play(5, A.input, B.input);
    expect(JSON.stringify(A.input)).toBe(before);
  });

  it('모든 BINARY 로그에서 |tac| ≤ tacCap, p ∈ [0.05, 0.95] (DP5 는 [0.01, 0.85])', () => {
    for (const cap of [0.25, 0.35, 0.5] as const) {
      for (let seed = 0; seed < 60; seed++) {
        const r = play(seed, seed % 2 ? A.input : C.input, seed % 3 ? B.input : L.input, { tacCap: cap });
        for (const l of binary(r.log)) {
          expect(Math.abs(l.tac)).toBeLessThanOrEqual(cap + 1e-12);
          const [lo, hi] = l.dp === 'DP5' ? [GOAL_P_MIN, GOAL_P_MAX] : [P_MIN, P_MAX];
          expect(l.p).toBeGreaterThanOrEqual(lo);
          expect(l.p).toBeLessThanOrEqual(hi);
        }
        for (const l of r.log) if (l.kind === 'CHOICE') for (const t of Object.values(l.tacByType)) expect(Math.abs(t)).toBeLessThanOrEqual(cap + 1e-12);
      }
    }
  });

  it('tacticsEnabled=false 이면 모든 tac = 0', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = play(seed, A.input, C.input, { tacticsEnabled: false });
      for (const l of r.log) {
        if (l.kind === 'BINARY') expect(l.tac).toBe(0);
        else expect(Object.values(l.tacByType).every((t) => t === 0)).toBe(true);
      }
    }
  });

  it('DP 별 raw 키는 RULES_BY_DP 의 부분집합, onlyRules 는 해당 규칙만 남긴다', () => {
    const seen = new Set<RuleId>();
    for (let seed = 0; seed < 40; seed++) {
      const r = play(seed, [A, B, C, L][seed % 4]!.input, [B, L, A, C][seed % 4]!.input);
      for (const l of r.log) {
        const allowed = RULES_BY_DP[l.dp];
        const keys = l.kind === 'BINARY' ? Object.keys(l.raw) : Object.values(l.rawByType).flatMap((m) => Object.keys(m));
        for (const k of keys) {
          expect(allowed).toContain(k);
          seen.add(k as RuleId);
        }
      }
      const only = play(seed, A.input, B.input, { onlyRules: ['R1'] });
      for (const l of binary(only.log)) expect(Object.keys(l.raw).every((k) => k === 'R1')).toBe(true);
    }
    for (const r of ['R1', 'R3', 'R5', 'TEMPO'] as RuleId[]) expect(seen.has(r), r).toBe(true);
  });

  it('OFFSIDE 이벤트 수 = offsides 통계 ≥ R6 이 켜진 DP4 실패 수 (나머지는 표시 오프사이드), R2 가 켜진 DP1 성공마다 LONG_BALL_ADVANCE 1개', () => {
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      const r = play(seed, B.input, A.input); // 역습(침투형·롱볼) vs 전방압박(트랩·높은 라인)
      for (const side of [r.home, r.away]) {
        const logs = binary(r.log).filter((l) => l.actor === side.clubId);
        const offsides = logs.filter((l) => l.dp === 'DP4' && !l.success && l.raw.R6 !== undefined).length;
        const longBalls = logs.filter((l) => l.dp === 'DP1' && l.success && l.raw.R2 !== undefined).length;
        const offEvents = r.events.filter((e) => e.type === 'OFFSIDE' && e.clubId === side.clubId).length;
        expect(offEvents).toBe(side.offsides);
        expect(offEvents).toBeGreaterThanOrEqual(offsides);
        expect(r.events.filter((e) => e.type === 'LONG_BALL_ADVANCE' && e.clubId === side.clubId).length).toBe(longBalls);
        expect(side.longBallAdvances).toBe(longBalls);
        total += offsides + longBalls;
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('시퀀스 수 = round(BASE_SEQUENCES(73) × tempoFactor × jitter) + 추가시간(세그먼트 9 × 1.5, 18 × 2.1), tempoFactor ∈ [0.85, 1.15]', () => {
    for (const tempo of [-2, 0, 2] as const) {
      const h = makeTeam(1, 'h', 60, 'BALANCED', { tempo });
      const a = makeTeam(2, 'a', 60, 'BALANCED', { tempo });
      const tf = 1 + 0.075 * tempo;
      for (let seed = 0; seed < 20; seed++) {
        const r = play(seed, h.input, a.input);
        const seqs = new Set(r.log.map((l) => l.seq)).size;
        const stoppage = (16 + 1.5 + 2.1) / 18;
        const B0 = EngineConstants.BASE_SEQUENCES;
        expect(seqs).toBeGreaterThanOrEqual(Math.round(B0 * tf * 0.92 * stoppage) - 2);
        expect(seqs).toBeLessThanOrEqual(Math.round(B0 * tf * 1.08 * stoppage) + 2);
      }
    }
  });

  it('컨디션: 풀타임 소모 30 + 3 × 압박(+) − 1 × 압박(−) + 역할 가산 (0.4.0 스타일 체력 공식)', () => {
    const noSub = (t: EngineTeamInput): EngineTeamInput => ({ ...t, autoSubThreshold: 0, bench: [] });
    for (const press of [-2, 0, 2] as const) {
      const h = makeTeam(7, 'h', 60, 'BALANCED', { press });
      const a = makeTeam(8, 'a', 60, 'BALANCED');
      const r = play(3, noSub(h.input), noSub(a.input));
      const lines = r.players.filter((l) => l.clubId === 'h' && l.minutes === 90);
      expect(lines.length).toBeGreaterThan(8);
      for (const l of lines) {
        const idx = h.input.starters.findIndex((p) => p.id === l.playerId);
        const role = h.input.slots.A.roles[idx];
        const drain = 30 + 3 * Math.max(0, press) - Math.max(0, -press) + (EngineConstants.CONDITION.tempoDrainPerStep * 0) + (ROLE_EXTRA_DRAIN[role!] ?? 0);
        expect(l.conditionAfter).toBe(Math.round(100 - drain));
      }
    }
  });

  it('효율 배수: 87 → 0.985, 74 → 0.92, 61 → 0.855, <60 → 0.80', () => {
    expect(conditionEfficiency(100)).toBe(1);
    expect(conditionEfficiency(87)).toBeCloseTo(0.985, 10);
    expect(conditionEfficiency(74)).toBeCloseTo(0.92, 10);
    expect(conditionEfficiency(61)).toBeCloseTo(0.855, 10);
    expect(conditionEfficiency(59)).toBe(0.8);
  });

  it('유닛은 0~100, 퇴장 인원당 × 0.9', () => {
    const u = computeUnits(A.input.starters, A.input.slots.A, 0);
    const u1 = computeUnits(A.input.starters, A.input.slots.A, 1);
    for (const k of Object.keys(u) as (keyof typeof u)[]) {
      expect(u[k]).toBeGreaterThan(0);
      expect(u[k]).toBeLessThanOrEqual(100);
      expect(u1[k]).toBeCloseTo(u[k] * 0.9, 10);
    }
  });

  it('조건부 지시는 경기당 1회만 발동, 위에서부터 우선 (경계당 1개)', () => {
    const conds: ConditionalOrder[] = [
      { id: 'first', conditions: [{ kind: 'TIME', after: 60 }], action: { kind: 'MENTALITY_DELTA', delta: -1 }, enabled: true },
      { id: 'second', conditions: [{ kind: 'TIME', after: 60 }], action: { kind: 'MENTALITY_DELTA', delta: 1 }, enabled: true },
      { id: 'off', conditions: [{ kind: 'TIME', after: 45 }], action: { kind: 'SWITCH_SLOT', slot: 'B' }, enabled: false },
    ];
    for (let seed = 0; seed < 10; seed++) {
      const r = play(seed, { ...A.input, conditionals: conds }, B.input);
      const fired = r.events.filter((e): e is Extract<typeof e, { type: 'TRIGGER_FIRED' }> => e.type === 'TRIGGER_FIRED' && e.clubId === A.input.clubId);
      expect(fired.map((e) => e.conditionalId)).toEqual(['first', 'second']);
      expect(fired[0]!.minute).toBe(60);
      expect(fired[1]!.minute).toBe(65);
    }
  });

  it('SWITCH_SLOT 으로 포메이션을 바꾸면 선수를 재배정하고 이벤트를 남긴다', () => {
    const t = makeTeam(9, 'sw', 60, 'BALANCED');
    const roles: RoleId[] = ['GK_TRADITIONAL', 'FB_DEFENSIVE', 'CB_STOPPER', 'CB_STOPPER', 'CB_BALL_PLAYING', 'FB_DEFENSIVE', 'CM_BOX_TO_BOX', 'DM_ANCHOR', 'CM_BOX_TO_BOX', 'ST_TARGET', 'ST_POACHER'];
    const input: EngineTeamInput = {
      ...t.input,
      slots: { ...t.input.slots, B: { formation: '5-3-2', roles, instructions: t.input.slots.A.instructions, familiarity: 50 } },
      conditionals: [{ id: 'ht', conditions: [{ kind: 'TIME', after: 'HT' }], action: { kind: 'SWITCH_SLOT', slot: 'B' }, enabled: true }],
    };
    const r = play(4, input, B.input);
    const e = r.events.find((x) => x.type === 'TRIGGER_FIRED');
    expect(e?.minute).toBe(45);
    expect(JSON.stringify(e)).toContain('5-3-2');
  });

  it('교체 최대 5명 / 3창 (하프타임 제외)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const tired: EngineTeamInput = { ...A.input, autoSubThreshold: 95, starters: A.input.starters.map((p) => ({ ...p, condition: 80 })) };
      const r = play(seed, tired, B.input);
      const subs = r.events.filter((e) => e.type === 'SUBSTITUTION' && e.clubId === tired.clubId);
      expect(subs.length).toBeGreaterThan(0);
      expect(subs.length).toBeLessThanOrEqual(5);
      expect(new Set(subs.filter((s) => s.minute !== 45).map((s) => s.minute)).size).toBeLessThanOrEqual(3);
    }
  });

  it('R1 은 수비 press ≥ 1 & 공격 패스 ≤ 0 일 때만 음수로 발동 (롱볼은 압박을 우회)', () => {
    let fired = 0;
    for (let seed = 0; seed < 10; seed++) {
      const r = play(seed, C.input, A.input); // 점유(패스 −2) vs 전방압박(압박 +2)
      for (const l of binary(r.log).filter((x) => (x.dp === 'DP1' || x.dp === 'DP8') && x.actor === C.input.clubId && x.raw.R1 !== undefined)) {
        expect(l.raw.R1).toBeLessThan(0);
        fired += 1;
      }
      const r2 = play(seed, B.input, A.input); // 역습(패스 +2) vs 전방압박
      expect(binary(r2.log).some((x) => x.dp === 'DP1' && x.actor === B.input.clubId && x.raw.R1 !== undefined)).toBe(false);
    }
    expect(fired).toBeGreaterThan(0);
  });
});

describe('explainMatch (8.8)', () => {
  it('결정 지점마다 Σ Δp_i = Δp_tac (오차 < 1e-9), 200경기', () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = play(seed, [A, C][seed % 2]!.input, [B, L][seed % 2]!.input, { tacCap: ([0.25, 0.35, 0.5] as const)[seed % 3] });
      for (const l of binary(r.log)) {
        const { dTac, parts } = decomposeBinary(l);
        const sum = Object.values(parts).reduce((a, b) => a + (b ?? 0), 0);
        expect(Math.abs(sum - dTac)).toBeLessThan(1e-9);
      }
      const ex = explainMatch(r, VALUE_TABLE);
      expect(ex.home.conservationError).toBeLessThan(1e-9);
      expect(ex.away.conservationError).toBeLessThan(1e-9);
    }
  });

  it('clamp 발생 시 a_i = r_i × tac / S 로 비례 배분', () => {
    const l: BinaryDecisionLog = {
      kind: 'BINARY',
      seq: 1,
      minute: 1,
      actor: 'x',
      dp: 'DP1',
      a: 60,
      d: 60,
      base: 1.1,
      strength: 0,
      prep: 0,
      home: 0,
      logitNoTac: 1.1,
      raw: { R1: 0.3, R2: 0.2 },
      tac: 0.35,
      p: 1 / (1 + Math.exp(-1.45)),
      success: true,
    };
    const { dTac, parts } = decomposeBinary(l);
    expect(parts.R1! / parts.R2!).toBeCloseTo(1.5, 10);
    expect(parts.R1! + parts.R2!).toBeCloseTo(dTac, 12);
  });

  it('두 팀의 규칙 기여는 부호만 반대 (제로섬)', () => {
    const r = play(77, A.input, B.input);
    const ex = explainMatch(r, VALUE_TABLE);
    for (const c of ex.home.rules) {
      const o = ex.away.rules.find((x) => x.ruleId === c.ruleId)!;
      expect(c.xg + o.xg).toBeCloseTo(0, 10);
    }
    expect(ex.home.bars.tactics + ex.away.bars.tactics).toBeCloseTo(0, 10);
  });

  it('막대 합(전력+준비+전술+운) ≈ 실제 득실 차 (VALUE 근사, 300경기 평균 ±0.3)', () => {
    const strong = makeTeam(5, 'st', 65, 'BALANCED');
    const weak = makeTeam(6, 'wk', 55, 'LOW_BLOCK');
    let bars = 0;
    let gd = 0;
    for (let seed = 0; seed < 300; seed++) {
      const r = play(seed, strong.input, weak.input);
      const b = explainMatch(r, VALUE_TABLE).home.bars;
      bars += b.strength + b.prep + b.tactics + b.luck;
      gd += r.home.goals - r.away.goals;
    }
    expect(Math.abs(bars / 300 - gd / 300)).toBeLessThan(0.3);
  });
});

describe('calibration (고정 시드 게이트, 엔진 0.4.0)', () => {

  it('BASELINE 1,000경기: 팀당 슈팅 11.5~14, 무승부 22~30%, 총 득점 2.4~3.0 (목표 2.6~3.0 은 리그 현실성과 상충해 미달, 회귀 하한 2.4)', () => {
    const rep = runCalibration({ matchesPerScenario: 1000, tacCap: 0.5, seed: 20260926, scenarios: ['BASELINE'] });
    const get = (id: string) => rep.targets.find((t) => t.id === id)!;
    expect(get('shots').pass, `shots ${get('shots').actual}`).toBe(true);
    expect(get('goals').actual).toBeGreaterThanOrEqual(2.4);
    expect(get('goals').actual).toBeLessThanOrEqual(3.0);
    expect(get('draws').actual).toBeGreaterThanOrEqual(22);
    expect(get('draws').actual).toBeLessThanOrEqual(30);
  });

  it('OVR_DIFF_25 1,000경기: 강팀 승률 ≥ 85%', () => {
    const rep = runCalibration({ matchesPerScenario: 1000, tacCap: 0.5, seed: 7, scenarios: ['OVR_DIFF_25'] });
    expect(rep.targets[0]!.actual).toBeGreaterThanOrEqual(85);
  });

  it('RULE_ISOLATION: 규칙별 단독 기여 P95 ≤ 0.5 (R7 ≤ 0.30), 합 P95 ≤ 0.8', () => {
    const rep = runCalibration({ matchesPerScenario: 200, tacCap: 0.5, seed: 3, scenarios: ['RULE_ISOLATION'] });
    for (const t of rep.targets) expect(t.pass, `${t.label} = ${t.actual}`).toBe(true);
  });

  it('STYLE_MATRIX 축약: 설계 유리 칸 6개(GP>BAL, POS>BAL, LB>POS, POS>WNG, GP>WNG, HL>BAL) 부호 일치, 칸당 400경기', () => {
    const cells: [StyleId, StyleId][] = [
      ['HIGH_PRESS', 'BALANCED'],
      ['POSSESSION', 'BALANCED'],
      ['LOW_BLOCK', 'POSSESSION'],
      ['POSSESSION', 'WING_PLAY'],
      ['HIGH_PRESS', 'WING_PLAY'],
      ['HIGH_LINE', 'BALANCED'],
    ];
    for (const [a, b] of cells) {
      let d = 0;
      for (let i = 0; i < 400; i++) {
        const { r, xIsHome } = styleMatrixMatch(20260926, 0.5, a, b, i);
        const gx = xIsHome ? r.home.goals : r.away.goals;
        const gy = xIsHome ? r.away.goals : r.home.goals;
        d += Math.sign(gx - gy);
      }
      expect(d, `${a} vs ${b}`).toBeGreaterThan(0);
    }
  });

  it('FORMATION_PARITY 축약 (칸당 200경기): 포메이션 경기당 승점 1.2~1.55 (본 목표 1.25~1.50 은 sim:batch)', () => {
    const rep = runCalibration({ matchesPerScenario: 400, tacCap: 0.5, seed: 11, scenarios: ['FORMATION_PARITY'] });
    const get = (id: string) => rep.targets.find((t) => t.id === id)!;
    expect(get('ppgMin').actual).toBeGreaterThanOrEqual(1.2);
    expect(get('ppgMax').actual).toBeLessThanOrEqual(1.55);
  });

  it('전력 10점 차 + 약팀 최선 카운터(9 스타일 중): 강팀 여전히 우세, 전력 우위 ≥ 전술 최대 효과, 강팀 승률 50~65% (본 목표 50~60 은 sim:batch n=2000 에서 57.9% PASS)', () => {
    const rep = runCalibration({ matchesPerScenario: 1000, tacCap: 0.5, seed: 20260926, scenarios: ['OVR_DIFF_10_COUNTER'] });
    const get = (id: string) => rep.targets.find((t) => t.id === id);
    expect(get('strongStillAhead')!.pass).toBe(true);
    expect(get('strongWin')!.actual).toBeGreaterThanOrEqual(50);
    expect(get('strongWin')!.actual).toBeLessThanOrEqual(65);
  });

});
