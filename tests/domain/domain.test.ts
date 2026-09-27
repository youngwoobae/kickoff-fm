/** 도메인 테스트 (소유: A). 기준은 docs/아키텍처.md 12장 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine';
import {
  COACH_ID,
  OWNER_ID,
  TIER_ECONOMY,
  advanceDayState,
  applyDailyRecovery,
  applyMatchLine,
  applyPatch,
  carryOver,
  checkAction,
  computeStandings,
  createInitialState,
  createProposal,
  dailySalary,
  diffBundles,
  findConflicting,
  generateDoubleRoundRobin,
  generatePlayer,
  judgeSeason,
  matchBonus,
  pickBasePlan,
  prizeFor,
  remapLineup,
  resolvePlan,
  spendable,
  startNewSeasonState,
  validatePlan,
  type PlanBundle,
} from '../../src/domain';
import type { Club, ClubPlanState, GameState, MatchPlan, MatchSummary, Membership, Player, PlayerMatchLine, Proposal, StandingRow, TeamSummaryLite } from '../../src/types';
import { conditionEfficiency } from '../../src/engine';

const IDS = Array.from({ length: 14 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`);

describe('schedule', () => {
  const fx = generateDoubleRoundRobin(IDS, 1, mulberry32(9));
  it('14팀 → 26경기일 × 7경기, 모든 쌍이 홈/원정 1회씩', () => {
    expect(fx).toHaveLength(182);
    for (let d = 1; d <= 26; d++) expect(fx.filter((f) => f.day === d)).toHaveLength(7);
    const pairs = new Map<string, number>();
    for (const f of fx) pairs.set(`${f.homeId}>${f.awayId}`, (pairs.get(`${f.homeId}>${f.awayId}`) ?? 0) + 1);
    for (const a of IDS) for (const b of IDS) if (a !== b) expect(pairs.get(`${a}>${b}`), `${a}>${b}`).toBe(1);
  });
  it('어떤 팀도 한 경기일에 2경기를 하지 않는다, matchId 는 고유', () => {
    for (let d = 1; d <= 26; d++) {
      const teams = fx.filter((f) => f.day === d).flatMap((f) => [f.homeId, f.awayId]);
      expect(new Set(teams).size).toBe(14);
    }
    expect(new Set(fx.map((f) => f.id)).size).toBe(182);
  });
});

function lite(clubId: string, goals: number, xg = 1): TeamSummaryLite {
  return {
    clubId,
    goals,
    xg,
    shots: 10,
    possession: 0.5,
    formation: '4-4-2',
    instructions: { mentality: 0, press: 0, line: 0, width: 0, tempo: 0, directness: 0, counter: false, offsideTrap: false },
    zonePass: { z0: { attempts: 10, successes: 7 }, z1: { attempts: 10, successes: 4 }, z2: { attempts: 10, successes: 3 } },
    ruleFires: {},
    xPts: 1.3,
  };
}
function game(day: number, h: string, hg: number, a: string, ag: number, hxg = 1, axg = 1): MatchSummary {
  return { matchId: `s1-d${day}-${h}-${a}`, season: 1, day, home: lite(h, hg, hxg), away: lite(a, ag, axg), engineVersion: 't', seed: 0 };
}

describe('standings / promotion', () => {
  it('6.2 순위 결정 규칙 ①승점 ②득실차 ③다득점 ④승자승 ⑥누적 xG 차 ⑦추첨', () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
    const s: MatchSummary[] = [
      game(1, 'A', 3, 'X', 0), // A: 3점 +3
      game(2, 'B', 1, 'X', 0), // B: 3점 +1
      game(3, 'C', 2, 'X', 1), // C: 3점 +1, 다득점 2 > B
      game(4, 'D', 1, 'E', 0),
      game(5, 'E', 2, 'Y', 1),
      game(6, 'D', 0, 'Y', 1),
    ];
    const t = computeStandings(ids, s, 1, 1);
    expect(t.map((r) => r.clubId).slice(0, 3)).toEqual(['A', 'C', 'B']);
    const dIdx = t.findIndex((r) => r.clubId === 'D');
    const eIdx = t.findIndex((r) => r.clubId === 'E');
    // D·E 승점·득실 같음 → ③ 다득점(E 2 > D 1)이 ④ 승자승(D 승)보다 먼저
    expect(t[dIdx]!.points).toBe(t[eIdx]!.points);
    expect(t[dIdx]!.goalDiff).toBe(t[eIdx]!.goalDiff);
    expect(eIdx).toBeLessThan(dIdx);
  });

  it('④ 승자승이 ⑥ xG 보다 먼저, ⑥ 이 추첨보다 먼저', () => {
    // P, Q 동률(승점·득실·다득점), 맞대결 Q 승 → Q 가 위
    const s = [game(1, 'P', 0, 'Q', 1, 3, 0.1), game(2, 'P', 1, 'Z', 0, 3, 0.1), game(3, 'Z', 1, 'Q', 0, 0.1, 0.1), game(4, 'W', 3, 'Z', 0)];
    const t = computeStandings(['P', 'Q', 'Z'], s, 1, 1);
    const p = t.find((r) => r.clubId === 'P')!;
    const q = t.find((r) => r.clubId === 'Q')!;
    expect([p.points, p.goalDiff, p.goalsFor]).toEqual([q.points, q.goalDiff, q.goalsFor]);
    expect(q.position).toBeLessThan(p.position);
    // 맞대결이 없고 모든 것이 같으면 xG 차가 큰 쪽이 위
    const s2 = [game(1, 'M', 1, 'Z', 0, 2.5, 0.2), game(2, 'N', 1, 'Z', 0, 0.3, 0.2)];
    const t2 = computeStandings(['M', 'N', 'Z'], s2, 1, 1);
    expect(t2[0]!.clubId).toBe('M');
    // 완전 동률은 시드 추첨 (결정적)
    const t3a = computeStandings(['K', 'J'], [], 1, 5);
    const t3b = computeStandings(['K', 'J'], [], 1, 5);
    expect(t3a.map((r) => r.clubId)).toEqual(t3b.map((r) => r.clubId));
  });

  it('사람 팀 1위·2위 → PROMOTED, 11~14위 → RELEGATED, T5 는 강등 없음, T1 은 승격 없음', () => {
    const clubs: Record<string, Club> = {};
    for (const id of IDS) clubs[id] = { id, name: id, shortName: id, isHuman: id === 'c01', playerIds: [], tactics: {} as Club['tactics'] };
    const table = (pos: number): StandingRow[] => {
      const order = IDS.filter((x) => x !== 'c01');
      order.splice(pos - 1, 0, 'c01');
      return order.map((clubId, i) => ({ position: i + 1, clubId, played: 26, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, xgFor: 0, xgAgainst: 0, xPts: 0, form: [], zone: 'NONE' }));
    };
    expect(judgeSeason(1, 'T3', table(1), clubs).labels.c01).toBe('PROMOTED');
    expect(judgeSeason(1, 'T3', table(2), clubs).labels.c01).toBe('PROMOTED');
    expect(judgeSeason(1, 'T3', table(3), clubs).labels.c01).toBe('STAYED'); // 봇 비율 > 40% → 1·2위만
    expect(judgeSeason(1, 'T3', table(11), clubs).labels.c01).toBe('RELEGATED');
    expect(judgeSeason(1, 'T3', table(14), clubs).labels.c01).toBe('RELEGATED');
    expect(judgeSeason(1, 'T5', table(14), clubs).labels.c01).toBe('STAYED');
    expect(judgeSeason(1, 'T1', table(1), clubs).labels.c01).toBe('STAYED');
    const o = judgeSeason(1, 'T3', table(1), clubs);
    expect(o.championId).toBe('c01');
    expect(o.prizes.c01).toBe(12_200_000 + 6_100_000);
    expect(Object.keys(o.labels)).toEqual(['c01']);
  });
});

function playerWith(stamina: number, condition = 100): Player {
  const p = generatePlayer(mulberry32(3), 'CM', 60, 26);
  return { ...p, id: 'p1', clubId: 'c01', condition, attrs: { ...p.attrs, stamina } };
}
function line(conditionAfter: number, extra: Partial<PlayerMatchLine> = {}): PlayerMatchLine {
  return { playerId: 'p1', clubId: 'c01', started: true, minutes: 90, goals: 0, shots: 0, keyPasses: 0, tackles: 0, conditionAfter, injuredDays: 0, redCard: false, ...extra };
}

describe('condition (4.2 표 재현)', () => {
  it('체력 보정 +3 선수 연속 출전: 100 → 70 → 87 → 57 → 74 → 44 → 61', () => {
    let p = playerWith(11);
    const seq: number[] = [p.condition];
    for (let i = 0; i < 3; i++) {
      p = applyMatchLine(p, line(p.condition - 30), true);
      seq.push(p.condition);
      p = applyDailyRecovery(p);
      seq.push(p.condition);
    }
    expect(seq).toEqual([100, 70, 87, 57, 74, 44, 61]);
  });
  it('효율 배수: 87 → 0.985, 74 → 0.92, 61 → 0.855', () => {
    expect(conditionEfficiency(87)).toBeCloseTo(0.985, 10);
    expect(conditionEfficiency(74)).toBeCloseTo(0.92, 10);
    expect(conditionEfficiency(61)).toBeCloseTo(0.855, 10);
  });
  it('퇴장 → 다음 1경기 정지, 결장 경기에서 소화, 부상 일수는 매일 −1', () => {
    let p = applyMatchLine(playerWith(10), line(70, { redCard: true, injuredDays: 2 }), true);
    expect(p.availability).toEqual({ injuryDays: 2, suspendedMatches: 1 });
    p = applyDailyRecovery(p);
    expect(p.availability.injuryDays).toBe(1);
    p = applyMatchLine(p, undefined, true);
    expect(p.availability.suspendedMatches).toBe(0);
    expect(p.season.redCards).toBe(1);
  });
});

// ── resolvePlan ──────────────────────────────────────────────────
function freshState(): GameState {
  return createInitialState(123, { clubName: '테스트 FC', tier: 'T3', devMode: true }, 'now');
}
function userCtx(s: GameState, planState?: ClubPlanState) {
  const club = s.clubs[s.userClubId]!;
  const fixture = s.fixtures.find((f) => f.day === s.time.day && (f.homeId === club.id || f.awayId === club.id))!;
  const opp = fixture.homeId === club.id ? fixture.awayId : fixture.homeId;
  return { club, fixture, planState, players: s.players, opponentPlayerIds: s.clubs[opp]!.playerIds, opp };
}

describe('resolvePlan (4.7)', () => {
  const s = freshState();
  const base = resolvePlan(userCtx(s)).plan;
  const rec = (plan: MatchPlan, status: 'DRAFT' | 'CONFIRMED') => ({ plan, status, updatedBy: OWNER_ID, updatedAt: { season: 1, day: 1, seq: 1 } });

  it('확정본 > 기본 플랜 > 직전 사용 플랜(맞춤 지시 제거) > 시스템 기본', () => {
    expect(resolvePlan(userCtx(s)).source).toBe('SYSTEM');
    const club = s.clubs[s.userClubId]!;
    const withLast: GameState = { ...s, clubs: { ...s.clubs, [club.id]: { ...club, lastUsedPlan: { ...base, opponentOrders: { opponentId: 'c09', attackSide: 'L' } } } } };
    const r1 = resolvePlan(userCtx(withLast));
    expect(r1.source).toBe('LAST_USED');
    expect(r1.plan.opponentOrders).toBeUndefined();
    const withDefault: GameState = { ...withLast, clubs: { ...withLast.clubs, [club.id]: { ...withLast.clubs[club.id]!, defaultPlan: { ...base, startSlot: 'B' } } } };
    expect(resolvePlan(userCtx(withDefault)).source).toBe('DEFAULT');
    expect(resolvePlan(userCtx(withDefault, { confirmed: rec(base, 'CONFIRMED') })).source).toBe('CONFIRMED');
  });

  it('초안은 절대 적용되지 않는다', () => {
    const draft = { ...base, startSlot: 'B' as const };
    const r = resolvePlan(userCtx(s, { draft: rec(draft, 'DRAFT') }));
    expect(r.source).toBe('SYSTEM');
    expect(r.plan.startSlot).toBe('A');
  });

  it('상대가 다른 맞춤 지시는 초기화, 오늘 상대 기준이면 유지', () => {
    const ctx = userCtx(s);
    const wrong = { ...base, opponentOrders: { opponentId: 'zzz', attackSide: 'L' as const } };
    const r = resolvePlan(userCtx(s, { confirmed: rec(wrong, 'CONFIRMED') }));
    expect(r.plan.opponentOrders).toBeUndefined();
    expect(r.adjustments.map((a) => a.kind)).toContain('OPP_ORDERS_CLEARED');
    const right = { ...base, opponentOrders: { opponentId: ctx.opp, attackSide: 'R' as const } };
    expect(resolvePlan(userCtx(s, { confirmed: rec(right, 'CONFIRMED') })).plan.opponentOrders?.attackSide).toBe('R');
  });

  it('부상·징계 대체 → 자동 로테이션(<70) → 유효성 보정 순서', () => {
    const inj = base.lineup.starters[3]!;
    const tired = base.lineup.starters[7]!;
    const players = { ...s.players };
    players[inj] = { ...players[inj]!, availability: { injuryDays: 3, suspendedMatches: 0 } };
    players[tired] = { ...players[tired]!, condition: 60 };
    const bad: MatchPlan = { ...base, lineup: { starters: base.lineup.starters.slice(0, 10), bench: base.lineup.bench } };
    const st2: GameState = { ...s, players };
    const r = resolvePlan({ ...userCtx(st2, { confirmed: rec({ ...bad, lineup: { ...bad.lineup, starters: [...bad.lineup.starters] } }, 'CONFIRMED') }) });
    const kinds = r.adjustments.map((a) => a.kind);
    const iU = kinds.indexOf('UNAVAILABLE_REPLACED');
    const iR = kinds.indexOf('AUTO_ROTATION');
    const iV = kinds.indexOf('VALIDITY_FIX');
    expect(iU).toBeGreaterThanOrEqual(0);
    expect(iR).toBeGreaterThan(iU);
    expect(iV).toBeGreaterThan(iR);
    expect(r.plan.lineup.starters).toHaveLength(11);
    expect(r.plan.lineup.starters).not.toContain(inj);
    expect(r.plan.lineup.starters).not.toContain(tired);
    expect(new Set([...r.plan.lineup.starters, ...r.plan.lineup.bench]).size).toBe(r.plan.lineup.starters.length + r.plan.lineup.bench.length);
    expect(validatePlan(r.plan, st2.clubs[st2.userClubId]!, players).filter((i) => i.severity === 'ERROR')).toEqual([]);
  });

  it('autoRotation OFF 면 피로 선수를 유지한다', () => {
    const tired = base.lineup.starters[5]!;
    const players = { ...s.players, [tired]: { ...s.players[tired]!, condition: 50 } };
    const r = resolvePlan({ ...userCtx({ ...s, players }, { confirmed: rec({ ...base, autoRotation: false }, 'CONFIRMED') }) });
    expect(r.plan.lineup.starters).toContain(tired);
  });

  it('validatePlan 은 11명·중복·HT 조정 규칙을 검사하고 remapLineup 은 11명을 유지한다', () => {
    const club = s.clubs[s.userClubId]!;
    const dup: MatchPlan = { ...base, lineup: { starters: [...base.lineup.starters.slice(0, 10), base.lineup.starters[0]!], bench: [] } };
    const codes = validatePlan(dup, club, s.players).map((i) => i.code);
    expect(codes).toContain('DUPLICATE');
    const ht: MatchPlan = { ...base, conditionals: [{ id: 'x', conditions: [{ kind: 'TIME', after: 60 }], action: { kind: 'HT_ADJUST', target: 'tempo', delta: 1 }, enabled: true }] };
    expect(validatePlan(ht, club, s.players).map((i) => i.code)).toContain('HT_ADJUST_ONLY_HT');
    const re = remapLineup(base, club, s.players, 'B');
    expect(re.startSlot).toBe('B');
    expect(new Set(re.lineup.starters)).toEqual(new Set(base.lineup.starters));
  });
});

describe('economy (7.4, 7.5)', () => {
  const T3 = TIER_ECONOMY.T3;
  it('T3 5위 12-6-8 → 수입 84.60M', () => {
    let income = T3.seasonBudget;
    for (let i = 0; i < 12; i++) income += matchBonus(T3, 2, 1).amount;
    for (let i = 0; i < 6; i++) income += matchBonus(T3, 1, 1).amount;
    for (let i = 0; i < 8; i++) income += matchBonus(T3, 0, 1).amount;
    const pr = prizeFor(T3, 5);
    income += pr.prize + pr.champion;
    expect(income).toBe(84_600_000);
    expect(prizeFor(T3, 1)).toEqual({ prize: 12_200_000, champion: 6_100_000 });
    expect(prizeFor(T3, 14).prize).toBe(1_830_000);
  });
  it('28일 연봉 차감 합계 = 연봉 총액 (반올림 오차 0)', () => {
    for (const total of [60_160_000, 12_345_677, 1, 27]) {
      let sum = 0;
      for (let d = 1; d <= 28; d++) sum += dailySalary(total, d);
      expect(sum).toBe(total);
    }
  });
  it('이월: R=16.8M, C=12.2M → carried 12.2M, excess 4.6M', () => {
    const r = carryOver({ clubId: 'x', balance: 16_800_000, transferOnlyBudget: 0, ledger: [] }, T3);
    expect(r).toEqual({ total: 16_800_000, cap: 12_200_000, carried: 12_200_000, excess: 4_600_000 });
    expect(carryOver({ clubId: 'x', balance: 5_000_000, transferOnlyBudget: 0, ledger: [] }, T3).excess).toBe(0);
  });
  it('지출 가능액 B = 잔액 − 연봉 × 남은 일수 / 28', () => {
    expect(spendable(10_000_000, 28_000_000, 7)).toBe(3_000_000);
  });
});

// ── 권한·제안 ────────────────────────────────────────────────────
const owner: Membership = { clubId: 'c01', userId: OWNER_ID, seat: 'OWNER', joinedAt: { season: 0, day: 0, seq: 0 }, hasOwnClub: true };
const coach: Membership = { clubId: 'c01', userId: COACH_ID, seat: 'COACH', roleLabel: 'TAC', joinedAt: { season: 0, day: 0, seq: 0 }, hasOwnClub: false };
const spectator: Membership = { ...coach, userId: 'u-spec', seat: 'COACH_SPECTATOR' };
const ctx = { now: { season: 1, day: 5 }, pastDeadline: false, clubId: 'c01' };

describe('permissions / proposals (5.0)', () => {
  it('COACH: EDIT_PLAN·SUBMIT_PLAN·APPROVE 거부, PROPOSE 허용', () => {
    for (const a of ['EDIT_PLAN', 'SUBMIT_PLAN', 'EDIT_TACTIC', 'SET_DEFAULT_PLAN', 'APPROVE', 'REJECT'] as const) {
      expect(checkAction(coach, a, ctx)).toMatchObject({ ok: false, code: 'NOT_OWNER' });
    }
    expect(checkAction(coach, 'PROPOSE', ctx).ok).toBe(true);
    expect(checkAction(coach, 'REACT', ctx).ok).toBe(true);
    expect(checkAction(coach, 'VIEW_TODAY_PLAN', ctx).ok).toBe(true);
    expect(checkAction(coach, 'ADVANCE_DAY', ctx).ok).toBe(true);
  });
  it('OWNER: PROPOSE 거부(자기 제안 불필요), APPROVE 허용', () => {
    expect(checkAction(owner, 'PROPOSE', ctx)).toMatchObject({ ok: false, code: 'NOT_COACH' });
    expect(checkAction(owner, 'APPROVE', ctx).ok).toBe(true);
    expect(checkAction(owner, 'SUBMIT_PLAN', ctx).ok).toBe(true);
  });
  it('COACH_SPECTATOR: PROPOSE·당일 플랜 열람 거부, 다른 구단 WRONG_CLUB, 신규 코치 잠금', () => {
    expect(checkAction(spectator, 'PROPOSE', ctx)).toMatchObject({ ok: false, code: 'SPECTATOR' });
    expect(checkAction(spectator, 'VIEW_TODAY_PLAN', ctx)).toMatchObject({ ok: false, code: 'SPECTATOR' });
    expect(checkAction(owner, 'EDIT_PLAN', { ...ctx, clubId: 'c02' })).toMatchObject({ ok: false, code: 'WRONG_CLUB' });
    const fresh = { ...coach, joinedAt: { season: 1, day: 5, seq: 9 } };
    expect(checkAction(fresh, 'VIEW_TODAY_PLAN', ctx)).toMatchObject({ ok: false, code: 'NEW_COACH_LOCK' });
    expect(checkAction(fresh, 'VIEW_TODAY_PLAN', { ...ctx, pastDeadline: true }).ok).toBe(true);
  });

  const s = freshState();
  const club = s.clubs[s.userClubId]!;
  const plan = resolvePlan(userCtx(s)).plan;
  const bundle: PlanBundle = { plan, tactics: club.tactics };
  const matchId = plan.matchId!;
  const at = { season: 1, day: 1, seq: 1 };
  const mk = (patch: Parameters<typeof applyPatch>[1], existing: Proposal[] = [], id = 'p') =>
    createProposal({ payload: { kind: 'PLAN_CHANGE', matchId, patch }, reason: '압박 강화' }, coach, existing, bundle, at, id);

  it('코치 1인 동시 OPEN 5장 제한, 동일 대상 중복 불가, 사유 1~80자, 변경 없음 거부', () => {
    const p1 = mk({ instructions: { slot: 'A', patch: { press: 2 } } });
    expect(p1.status).toBe('OPEN');
    expect(p1.diff.map((d) => d.path)).toEqual(['instructions.A.press']);
    expect(p1.expiresAt).toEqual({ season: 1, day: 1 });
    expect(() => mk({ instructions: { slot: 'A', patch: { press: 1 } } }, [p1])).toThrow(/이미/);
    const five = [1, 2, 3, 4, 5].map((i) => ({ ...p1, id: `x${i}`, diff: [{ path: `x${i}`, label: '', before: '', after: '' }] }));
    expect(() => mk({ startSlot: 'B' }, five)).toThrow(/5장/);
    expect(() => createProposal({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { startSlot: 'B' } }, reason: ' ' }, coach, [], bundle, at, 'q')).toThrow(/사유/);
    expect(() => createProposal({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { startSlot: 'B' } }, reason: 'x'.repeat(81) }, coach, [], bundle, at, 'q')).toThrow(/사유/);
    expect(() => mk({ startSlot: 'A' })).toThrow(/달라지는/);
  });

  it('승인 시 같은 path 의 다른 OPEN 제안은 SUPERSEDED 대상', () => {
    const a = mk({ instructions: { slot: 'A', patch: { press: 2 } } }, [], 'a');
    const other: Membership = { ...coach, userId: 'u-coach2' };
    const b = createProposal({ payload: { kind: 'PLAN_CHANGE', matchId, patch: { instructions: { slot: 'A', patch: { press: -1, tempo: 1 } } } }, reason: '반대안' }, other, [a], bundle, at, 'b');
    const c = mk({ startSlot: 'B' }, [a], 'c');
    expect(findConflicting(a, [a, b, c]).map((p) => p.id)).toEqual(['b']);
  });

  it('applyPatch/diffBundles/pickBasePlan', () => {
    const after = applyPatch(bundle, { opponentOrders: { opponentId: 'c05', attackSide: 'L' }, instructions: { slot: 'B', patch: { width: 2 } } });
    const d = diffBundles(bundle, after).map((x) => x.path);
    expect(d).toEqual(['instructions.B.width', 'opponentOrders']);
    expect(bundle.tactics.B.instructions.width).not.toBe(2); // 원본 불변
    expect(pickBasePlan(undefined, plan)).toBe(plan);
    const draft = { ...plan, startSlot: 'B' as const };
    expect(pickBasePlan({ draft: { plan: draft, status: 'DRAFT', updatedBy: 'x', updatedAt: at } }, plan)).toBe(draft);
  });
});

describe('advanceDay 상태 머신', () => {
  it('MATCHDAY Day d → 7경기 → Day d+1 00:00 처리, 입력 상태는 불변', () => {
    const s = freshState();
    const before = JSON.stringify(s);
    const { state, result } = advanceDayState(s, 'now');
    expect(JSON.stringify(s)).toBe(before);
    expect(result.matches).toHaveLength(7);
    expect(result.userMatchId).toBeDefined();
    expect(state.time).toEqual({ season: 1, day: 2 });
    expect(state.phase).toBe('MATCHDAY');
    expect(state.records[result.userMatchId!]?.report.clubId).toBe(s.userClubId);
    expect(state.fixtures.filter((f) => f.played)).toHaveLength(7);
    // 경기 수당 + 2일차 연봉이 원장에 기록
    expect(result.ledger.some((e) => e.kind.startsWith('MATCH_'))).toBe(true);
    expect(result.ledger.some((e) => e.kind === 'SALARY' && e.day === 2)).toBe(true);
  });

  it('Day 26 → pendingOutcome 설정, Day 27 상금 입금, Day 28 이월 → SEASON_OVER, 새 시즌', () => {
    let s = freshState();
    const results = [];
    while (s.phase !== 'SEASON_OVER') {
      const o = advanceDayState(s, 'now');
      results.push(o.result);
      s = o.state;
      if (s.time.day === 27 && s.phase === 'OFFSEASON' && results.length === 26) {
        expect(s.pendingOutcome?.finalTable).toHaveLength(14);
        expect(o.result.seasonOutcome).toBeDefined();
      }
    }
    expect(results).toHaveLength(28);
    expect(Object.keys(s.summaries)).toHaveLength(182);
    const ledger = s.finances[s.userClubId]!.ledger;
    expect(ledger.filter((e) => e.kind === 'PRIZE')).toHaveLength(1);
    expect(ledger.find((e) => e.kind === 'PRIZE')!.day).toBe(27);
    // 연봉 28일 합계 = 연봉 총액
    const salary = ledger.filter((e) => e.kind === 'SALARY').reduce((a, e) => a - e.amount, 0);
    const total = s.clubs[s.userClubId]!.playerIds.reduce((a, id) => a + s.players[id]!.contract.salary, 0);
    expect(salary).toBe(total);
    // 이월 판정: 잔액 ≤ C
    expect(s.finances[s.userClubId]!.balance).toBeLessThanOrEqual(TIER_ECONOMY.T3.seasonBudget * 0.2);
    expect(() => advanceDayState(s, 'now')).toThrow(/시즌이 끝났습니다/);
    const next = startNewSeasonState(s, 'now');
    expect(next.time).toEqual({ season: 2, day: 1 });
    expect(next.phase).toBe('MATCHDAY');
    expect(next.seasonHistory).toHaveLength(1);
    expect(next.fixtures).toHaveLength(182);
    expect(Object.keys(next.summaries)).toHaveLength(0);
    const p0 = s.players[s.clubs[s.userClubId]!.playerIds[0]!]!;
    expect(next.players[p0.id]!.age).toBe(p0.age + 1);
    expect(Object.keys(next.players)).toHaveLength(14 * 22);
  });

  it('SEASON_OVER 가 아니면 startNewSeason 은 INVALID_PHASE', () => {
    expect(() => startNewSeasonState(freshState(), 'now')).toThrow(/시즌 종료 후/);
  });

  it('같은 상태·같은 시드로 두 번 진행하면 결과가 같다 (멱등·결정적)', () => {
    const s = freshState();
    const a = advanceDayState(s, 'now');
    const b = advanceDayState(s, 'now');
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const s2 = createInitialState(123, { clubName: '테스트 FC', tier: 'T3', devMode: true }, 'now');
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s));
  });

  it('시즌 1회 전체 진행 후 직렬화 크기 < 2MB', () => {
    let s = freshState();
    while (s.phase !== 'SEASON_OVER') s = advanceDayState(s, 'now').state;
    expect(JSON.stringify(s).length).toBeLessThan(2 * 1024 * 1024);
  });

  it('제안은 대상 경기 마감(advanceDay) 시 OPEN → EXPIRED', () => {
    const s = freshState();
    const plan = resolvePlan(userCtx(s)).plan;
    const p = createProposal(
      { payload: { kind: 'PLAN_CHANGE', matchId: plan.matchId!, patch: { startSlot: 'B' } }, reason: 'B 로' },
      coach,
      [],
      { plan, tactics: s.clubs[s.userClubId]!.tactics },
      { season: 1, day: 1, seq: 1 },
      'pr1',
    );
    const { state, result } = advanceDayState({ ...s, proposals: { pr1: p } }, 'now');
    expect(result.expiredProposals).toEqual(['pr1']);
    expect(state.proposals.pr1!.status).toBe('EXPIRED');
  });
});
