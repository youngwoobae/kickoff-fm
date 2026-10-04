/**
 * 4.7 플랜 결정 규칙 (단일 정의). 마감 처리와 홈 카드 미리보기가 같은 함수를 쓴다. 소유: A.
 * ① 확정본 → 기본 플랜 → 직전 사용 플랜(맞춤 지시 제거) → 시스템 기본(감독 AI)
 * ② 맞춤 지시 검증 → 출전 불가 대체 → 자동 로테이션(<70) → 유효성 보정 → 참조 끊긴 조건부 지시 비활성
 */
import type {
  Club,
  ClubPlanState,
  Fixture,
  MatchPlan,
  PlanAdjustment,
  PlanSource,
  PlanValidationIssue,
  Player,
  ResolvedPlan,
} from '../../types';
import { EngineConstants, FORMATIONS, hashString, mulberry32 } from '../../engine';
import { buildPlan, isAvailable, pickLineup, slotScore } from '../ai/managerAi';
import { josa } from '../josa';

export interface ResolvePlanContext {
  club: Club;
  fixture: Fixture;
  planState: ClubPlanState | undefined;
  players: Readonly<Record<string, Player>>;
  opponentPlayerIds: readonly string[];
}

export const MAX_CONDITIONALS = 3;
export const MAX_CONDITIONS = 2;
export const BENCH_SIZE = 7;

export function stripOpponentOrders(plan: MatchPlan): MatchPlan {
  const { opponentOrders: _drop, ...rest } = plan;
  return { ...rest, lineup: { starters: [...plan.lineup.starters], bench: [...plan.lineup.bench] }, conditionals: plan.conditionals.map((c) => ({ ...c })) };
}

function clonePlan(plan: MatchPlan): MatchPlan {
  return {
    ...plan,
    lineup: { starters: [...plan.lineup.starters], bench: [...plan.lineup.bench] },
    conditionals: plan.conditionals.map((c) => ({ ...c, conditions: [...c.conditions] })),
    ...(plan.opponentOrders ? { opponentOrders: { ...plan.opponentOrders } } : {}),
  };
}

/** ① 후보 선택 (초안은 절대 쓰지 않는다) */
export function pickCandidate(ctx: ResolvePlanContext): { plan: MatchPlan; source: PlanSource } {
  const confirmed = ctx.planState?.confirmed;
  if (confirmed && (confirmed.plan.matchId === null || confirmed.plan.matchId === ctx.fixture.id)) {
    return { plan: clonePlan(confirmed.plan), source: 'CONFIRMED' };
  }
  if (ctx.club.defaultPlan) return { plan: stripOpponentOrders(ctx.club.defaultPlan), source: 'DEFAULT' };
  if (ctx.club.lastUsedPlan) return { plan: stripOpponentOrders(ctx.club.lastUsedPlan), source: 'LAST_USED' };
  const rng = mulberry32(hashString(`${ctx.club.id}|${ctx.fixture.id}|system`));
  const opponentId = ctx.fixture.homeId === ctx.club.id ? ctx.fixture.awayId : ctx.fixture.homeId;
  return { plan: buildPlan({ club: ctx.club, players: ctx.players, opponentId, mode: 'SYSTEM_DEFAULT', rng }), source: 'SYSTEM' };
}

function ownIds(club: Club): Set<string> {
  return new Set(club.playerIds);
}

/** 선발 슬롯 i 를 대체할 최적 선수 (선발이 아닌 가용 선수 중, 컨디션 기준 minCond 이상 선호) */
function bestReplacement(
  plan: MatchPlan,
  club: Club,
  players: Readonly<Record<string, Player>>,
  slotIndex: number,
  minCond: number,
): Player | null {
  const tactic = club.tactics[plan.startSlot];
  const fs = FORMATIONS[tactic.formation].slots[slotIndex];
  if (!fs) return null;
  const role = tactic.roles[slotIndex] ?? fs.defaultRole;
  const starters = new Set(plan.lineup.starters);
  let best: Player | null = null;
  let bv = -Infinity;
  for (const id of club.playerIds) {
    if (starters.has(id)) continue;
    const p = players[id];
    if (!p || !isAvailable(p) || p.condition < minCond) continue;
    const v = slotScore(p, fs.position, role, false);
    if (v > bv) {
      bv = v;
      best = p;
    }
  }
  return best;
}

/** 선발 교체: in 선수가 벤치에 있으면 out 선수와 자리를 바꾼다 */
function swapIn(plan: MatchPlan, slotIndex: number, inId: string, outId: string, outToBench: boolean): void {
  plan.lineup.starters[slotIndex] = inId;
  const bi = plan.lineup.bench.indexOf(inId);
  if (bi >= 0) {
    if (outToBench) plan.lineup.bench[bi] = outId;
    else plan.lineup.bench.splice(bi, 1);
  } else if (outToBench && plan.lineup.bench.length < BENCH_SIZE) {
    plan.lineup.bench.push(outId);
  }
}

export function resolvePlan(ctx: ResolvePlanContext): ResolvedPlan {
  const { club, players } = ctx;
  const { plan, source } = pickCandidate(ctx);
  plan.matchId = ctx.fixture.id;
  const adjustments: PlanAdjustment[] = [];
  const opponentId = ctx.fixture.homeId === club.id ? ctx.fixture.awayId : ctx.fixture.homeId;
  const own = ownIds(club);
  const removed = new Set<string>();

  // ②-1 상대 맞춤 지시 검증
  const oo = plan.opponentOrders;
  if (oo) {
    const wrongOpp = oo.opponentId !== opponentId;
    const missingTarget = !!oo.markTarget && !ctx.opponentPlayerIds.includes(oo.markTarget);
    if (wrongOpp || missingTarget) {
      delete plan.opponentOrders;
      adjustments.push({
        kind: 'OPP_ORDERS_CLEARED',
        note: wrongOpp ? '다른 상대를 기준으로 작성된 맞춤 지시를 초기화했어요' : '집중 마크 대상이 오늘 상대 명단에 없어 맞춤 지시를 초기화했어요',
      });
    } else if (oo.marker && (!own.has(oo.marker) || !isAvailable(players[oo.marker]))) {
      const { marker: _m, ...rest } = oo;
      plan.opponentOrders = rest;
    }
  }

  // ②-2 출전 불가(부상·징계·이적) 대체
  plan.lineup.starters.forEach((id, i) => {
    const p = players[id];
    if (own.has(id) && isAvailable(p)) return;
    const rep = bestReplacement(plan, club, players, i, 0);
    if (!rep) return;
    swapIn(plan, i, rep.id, id, false);
    removed.add(id);
    adjustments.push({
      kind: 'UNAVAILABLE_REPLACED',
      playerOut: id,
      playerIn: rep.id,
      note: `${p?.name ?? id} ${p && p.availability.injuryDays > 0 ? '부상' : p && p.availability.suspendedMatches > 0 ? '징계' : '출전 불가'} → ${rep.name}`,
    });
  });
  plan.lineup.bench = plan.lineup.bench.filter((id) => {
    const ok = own.has(id) && isAvailable(players[id]);
    if (!ok) removed.add(id);
    return ok;
  });

  // ②-3 자동 로테이션: 경기 전 컨디션 < 70 선발 → 대체
  if (plan.autoRotation) {
    const below = EngineConstants.CONDITION.autoRotationBelow;
    plan.lineup.starters.forEach((id, i) => {
      const p = players[id];
      if (!p || p.condition >= below) return;
      const rep = bestReplacement(plan, club, players, i, below);
      if (!rep) return;
      swapIn(plan, i, rep.id, id, true);
      removed.add(id);
      adjustments.push({
        kind: 'AUTO_ROTATION',
        playerOut: id,
        playerIn: rep.id,
        note: `${p.name} 컨디션 ${Math.round(p.condition)} < ${below} → ${rep.name} 선발`,
      });
    });
  }

  // ②-4 유효성 보정: 11명·중복·GK·벤치 7명
  const fixes = validityFix(plan, club, players);
  for (const f of fixes) adjustments.push({ kind: 'VALIDITY_FIX', note: f });

  // ②-5 빠진 선수를 참조하는 조건부 지시 비활성 (Phase 0 조건부 지시는 선수를 참조하지 않지만 세트피스 키커·마커를 정리)
  if (plan.setPieceTaker && !plan.lineup.starters.includes(plan.setPieceTaker) && !plan.lineup.bench.includes(plan.setPieceTaker)) {
    delete plan.setPieceTaker;
  }
  for (const c of plan.conditionals) {
    const refs = conditionalPlayerRefs(c);
    if (c.enabled && refs.some((r) => removed.has(r))) {
      c.enabled = false;
      adjustments.push({ kind: 'CONDITIONAL_DISABLED', conditionalId: c.id, note: '대체로 빠진 선수를 참조하는 조건부 지시를 껐어요' });
    }
  }
  return { plan, source, adjustments };
}

/** 조건부 지시가 참조하는 선수 (Phase 0 행동에는 선수 교체가 없어 항상 빈 배열, 1차 확장 대비) */
function conditionalPlayerRefs(c: MatchPlan['conditionals'][number]): string[] {
  const a = c.action as { playerOut?: string; playerIn?: string };
  return [a.playerOut, a.playerIn].filter((x): x is string => !!x);
}

/** 치명 오류 최소 보정. 반환: 보정 메모 */
function validityFix(plan: MatchPlan, club: Club, players: Readonly<Record<string, Player>>): string[] {
  const notes: string[] = [];
  const tactic = club.tactics[plan.startSlot];
  const formation = FORMATIONS[tactic.formation];
  const own = ownIds(club);
  const seen = new Set<string>();
  const starters: (string | null)[] = formation.slots.map((_, i) => {
    const id = plan.lineup.starters[i];
    if (!id || !own.has(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  if (starters.some((x) => x === null) || plan.lineup.starters.length !== formation.slots.length) {
    const rng = mulberry32(hashString(`${club.id}|validity`));
    const ai = pickLineup({ club, players, opponentId: null, mode: 'SYSTEM_DEFAULT', rng }, tactic);
    for (let i = 0; i < starters.length; i++) {
      if (starters[i] !== null) continue;
      const fill = ai.starters.find((id) => !seen.has(id)) ?? ai.bench.find((id) => !seen.has(id)) ?? club.playerIds.find((id) => !seen.has(id));
      if (!fill) continue;
      starters[i] = fill;
      seen.add(fill);
      notes.push(`선발 ${i + 1}번 자리를 ${players[fill]?.name ?? fill}(으)로 채웠어요`);
    }
  }
  // GK 자리에 GK 가 아니면 가용 GK 로 교체
  const gkIdx = formation.slots.findIndex((s) => s.position === 'GK');
  const gkId = starters[gkIdx];
  if (gkIdx >= 0 && gkId && players[gkId]?.primary !== 'GK') {
    const gk = club.playerIds.map((id) => players[id]).find((p) => p && p.primary === 'GK' && isAvailable(p) && !starters.includes(p.id));
    if (gk) {
      notes.push(`GK 자리에 ${gk.name} 배치`);
      starters[gkIdx] = gk.id;
      seen.add(gk.id);
    }
  }
  plan.lineup.starters = starters.filter((x): x is string => x !== null);
  const startSet = new Set(plan.lineup.starters);
  const benchSeen = new Set<string>();
  plan.lineup.bench = plan.lineup.bench.filter((id) => {
    if (startSet.has(id) || benchSeen.has(id) || !own.has(id)) return false;
    benchSeen.add(id);
    return true;
  });
  if (plan.lineup.bench.length > BENCH_SIZE) plan.lineup.bench = plan.lineup.bench.slice(0, BENCH_SIZE);
  if (plan.lineup.bench.length < BENCH_SIZE) {
    const cands = club.playerIds
      .map((id) => players[id])
      .filter((p): p is Player => !!p && isAvailable(p) && !startSet.has(p.id) && !benchSeen.has(p.id))
      .sort((a, b) => b.ovr * b.condition - a.ovr * a.condition || a.id.localeCompare(b.id));
    const needGk = !plan.lineup.bench.some((id) => players[id]?.primary === 'GK');
    if (needGk) {
      const gk = cands.find((p) => p.primary === 'GK');
      if (gk) {
        plan.lineup.bench.push(gk.id);
        benchSeen.add(gk.id);
      }
    }
    for (const p of cands) {
      if (plan.lineup.bench.length >= BENCH_SIZE) break;
      if (benchSeen.has(p.id)) continue;
      plan.lineup.bench.push(p.id);
      benchSeen.add(p.id);
    }
  }
  if (plan.conditionals.length > MAX_CONDITIONALS) {
    plan.conditionals = plan.conditionals.slice(0, MAX_CONDITIONALS);
    notes.push('조건부 지시는 최대 3개까지만 적용돼요');
  }
  return notes;
}

export function validatePlan(plan: MatchPlan, club: Club, players: Readonly<Record<string, Player>>): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const err = (code: string, message: string, playerId?: string) => issues.push({ severity: 'ERROR', code, message, ...(playerId ? { playerId } : {}) });
  const warn = (code: string, message: string, playerId?: string) => issues.push({ severity: 'WARNING', code, message, ...(playerId ? { playerId } : {}) });
  if (plan.clubId !== club.id) err('WRONG_CLUB', '다른 구단의 플랜이에요');
  if (plan.startSlot !== 'A' && plan.startSlot !== 'B') err('INVALID_SLOT', '시작 전술 슬롯은 A 또는 B여야 해요');
  const tactic = club.tactics[plan.startSlot] ?? club.tactics.A;
  const formation = FORMATIONS[tactic.formation];
  const own = ownIds(club);
  if (plan.lineup.starters.length !== 11) err('STARTERS_COUNT', `선발은 11명이어야 해요 (현재 ${plan.lineup.starters.length}명)`);
  if (plan.lineup.bench.length > BENCH_SIZE) err('BENCH_COUNT', `벤치는 최대 ${BENCH_SIZE}명이에요`);
  const all = [...plan.lineup.starters, ...plan.lineup.bench];
  const dup = all.filter((id, i) => all.indexOf(id) !== i);
  for (const id of new Set(dup)) err('DUPLICATE', `${players[id]?.name ?? id} 선수가 중복 배치됐어요`, id);
  for (const id of all) {
    const p = players[id];
    if (!own.has(id) || !p) {
      err('NOT_IN_SQUAD', `${josa(id, '은/는')} 우리 선수단이 아니에요`, id);
      continue;
    }
    if (p.availability.injuryDays > 0) warn('INJURED', `${p.name} 부상 (${p.availability.injuryDays}일) — 마감 때 자동으로 바뀌어요`, id);
    if (p.availability.suspendedMatches > 0) warn('SUSPENDED', `${p.name} 출장 정지 — 마감 때 자동으로 바뀌어요`, id);
  }
  plan.lineup.starters.forEach((id, i) => {
    const p = players[id];
    const fs = formation.slots[i];
    if (!p || !fs) return;
    if (fs.position === 'GK' && p.primary !== 'GK') err('GK_SLOT', `GK 자리에 ${p.name}(${p.primary}) 배치`, id);
    const fit = p.positions[fs.position] ?? (p.primary === fs.position ? 'NATURAL' : 'UNSUITED');
    if (fit === 'UNSUITED' && fs.position !== 'GK') warn('UNSUITED', `${josa(p.name, '은/는')} ${fs.position} 부적합 (효율 × 0.75)`, id);
    if (plan.autoRotation && p.condition < EngineConstants.CONDITION.autoRotationBelow) {
      warn('LOW_CONDITION', `${p.name} 컨디션 ${Math.round(p.condition)} — 자동 로테이션 대상이에요`, id);
    }
  });
  if (!plan.lineup.bench.some((id) => players[id]?.primary === 'GK')) warn('NO_BENCH_GK', '벤치에 GK가 없어요');
  if (plan.conditionals.length > MAX_CONDITIONALS) err('CONDITIONALS_COUNT', '조건부 지시는 최대 3개예요');
  const ids = new Set<string>();
  for (const c of plan.conditionals) {
    if (ids.has(c.id)) err('CONDITIONAL_ID', `조건부 지시 id 중복: ${c.id}`);
    ids.add(c.id);
    if (c.conditions.length === 0 || c.conditions.length > MAX_CONDITIONS) err('CONDITIONS_COUNT', '조건은 1~2개여야 해요');
    if (c.action.kind === 'HT_ADJUST' && !c.conditions.some((x) => x.kind === 'TIME' && x.after === 'HT')) {
      err('HT_ADJUST_ONLY_HT', '하프타임 조정은 하프타임 조건과만 쓸 수 있어요');
    }
  }
  if (!(plan.autoSubThreshold >= 0 && plan.autoSubThreshold <= 100)) err('AUTO_SUB_RANGE', '자동 교체 기준은 0~100이에요');
  const oo = plan.opponentOrders;
  if (oo?.marker && !own.has(oo.marker)) err('MARKER_NOT_OURS', '마커는 우리 선수여야 해요', oo.marker);
  if (oo?.markTarget && own.has(oo.markTarget)) err('MARK_TARGET_OURS', '집중 마크 대상은 상대 선수여야 해요', oo.markTarget);
  if (plan.setPieceTaker && !all.includes(plan.setPieceTaker)) warn('SET_PIECE_TAKER', '세트피스 키커가 명단에 없어요', plan.setPieceTaker);
  return issues;
}

/** 시작 슬롯 변경 시 선발 11명을 새 포메이션 슬롯에 적합도 최대 탐욕 배정 (저장하지 않음) */
export function remapLineup(plan: MatchPlan, club: Club, players: Readonly<Record<string, Player>>, slot: 'A' | 'B'): MatchPlan {
  const tactic = club.tactics[slot];
  const formation = FORMATIONS[tactic.formation];
  const pool = plan.lineup.starters.map((id) => players[id]).filter((p): p is Player => !!p);
  const out: (string | null)[] = formation.slots.map(() => null);
  const freeSlots = formation.slots.map((s) => s.index);
  const free = [...pool];
  while (free.length > 0 && freeSlots.length > 0) {
    let best = -Infinity;
    let bi = 0;
    let bj = 0;
    free.forEach((p, i) => {
      freeSlots.forEach((si, j) => {
        const fs = formation.slots[si]!;
        const v = slotScore(p, fs.position, tactic.roles[si] ?? fs.defaultRole, false);
        if (v > best) {
          best = v;
          bi = i;
          bj = j;
        }
      });
    });
    out[freeSlots[bj]!] = free[bi]!.id;
    free.splice(bi, 1);
    freeSlots.splice(bj, 1);
  }
  return {
    ...plan,
    startSlot: slot,
    lineup: { starters: out.filter((x): x is string => x !== null), bench: [...plan.lineup.bench] },
    conditionals: plan.conditionals.map((c) => ({ ...c })),
  };
}
