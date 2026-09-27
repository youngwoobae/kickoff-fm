/** ResolvedPlan + 구단·선수 상태 → EngineTeamInput 변환 (도메인 → 엔진 경계). 소유: A. */
import type { Club, EnginePlayer, EngineTeamInput, Player, ResolvedPlan, SlotKey, Step } from '../../types';
import { clamp } from '../../engine';

export function toEnginePlayer(p: Player): EnginePlayer {
  return {
    id: p.id,
    name: p.name,
    attrs: { ...p.attrs },
    condition: p.condition,
    positions: { ...p.positions },
    primary: p.primary,
  };
}

export function toEngineTeamInput(
  club: Club,
  resolved: ResolvedPlan,
  players: Readonly<Record<string, Player>>,
  isHome: boolean,
): EngineTeamInput {
  const plan = resolved.plan;
  // 결정성 규칙 2: 선발은 슬롯 인덱스 순, 벤치는 입력 순 그대로
  const starters = plan.lineup.starters.map((id) => players[id]).filter((p): p is Player => !!p);
  const bench = plan.lineup.bench
    .map((id) => players[id])
    .filter((p): p is Player => !!p)
    .slice(0, 7);
  const moraleAvg = starters.length > 0 ? starters.reduce((s, p) => s + p.morale, 0) / starters.length : 0;
  const slots = {} as EngineTeamInput['slots'];
  for (const k of ['A', 'B'] as SlotKey[]) {
    const t = club.tactics[k];
    slots[k] = { formation: t.formation, roles: [...t.roles], instructions: { ...t.instructions }, familiarity: t.familiarity };
  }
  const oo = plan.opponentOrders;
  const input: EngineTeamInput = {
    clubId: club.id,
    name: club.name,
    isHome,
    starters: starters.map(toEnginePlayer),
    bench: bench.map(toEnginePlayer),
    slots,
    startSlot: plan.startSlot,
    conditionals: plan.conditionals.filter((c) => c.enabled).map((c) => ({ ...c })),
    autoSubThreshold: plan.autoSubThreshold,
    morale: clamp(Math.round(moraleAvg), -2, 2) as Step,
  };
  if (oo && (oo.markTarget || oo.attackSide)) {
    input.opponentOrders = {
      ...(oo.markTarget ? { markTarget: oo.markTarget } : {}),
      ...(oo.marker ? { marker: oo.marker } : {}),
      ...(oo.attackSide ? { attackSide: oo.attackSide } : {}),
    };
  }
  if (plan.setPieceTaker) input.setPieceTaker = plan.setPieceTaker;
  return input;
}
