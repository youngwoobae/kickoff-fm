/** 제안 카드 수명 주기 (5.0.2). 순수 함수 — 영속화·권한은 services. 소유: A. */
import type {
  ClubPlanState,
  GameTimestamp,
  MatchPlan,
  Membership,
  PlanChangePatch,
  Proposal,
  ProposalDiffItem,
  ProposalInput,
  SlotKey,
  TacticSlot,
  TeamInstructions,
} from '../../types';
import { DomainError } from '../errors';
import { parseMatchId } from '../league/schedule';

export const MAX_OPEN_PER_COACH = 5;
export const MAX_REASON_LENGTH = 80;

/**
 * 제안이 바꿀 수 있는 대상 묶음. 팀 지시는 MatchPlan 이 아니라 Club.tactics 슬롯에 있으므로 함께 다룬다.
 * 팀 지시만 바꾸는 승인은 숙련도를 떨어뜨리지 않는다(4.4-4).
 */
export interface PlanBundle {
  plan: MatchPlan;
  tactics: Record<SlotKey, TacticSlot>;
}

const INSTRUCTION_LABELS: Record<keyof TeamInstructions, string> = {
  mentality: '공격 성향',
  press: '압박 강도',
  line: '수비 라인',
  width: '폭',
  tempo: '템포',
  directness: '패스 방식',
  counter: '역습 중시',
  offsideTrap: '오프사이드 트랩',
};

export function createProposal(
  input: ProposalInput,
  author: Membership,
  existing: readonly Proposal[],
  base: PlanBundle,
  at: GameTimestamp,
  id: string,
): Proposal {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > MAX_REASON_LENGTH) {
    throw new DomainError('PROPOSAL_INVALID', `제안 사유는 1~${MAX_REASON_LENGTH}자여야 합니다`);
  }
  if (input.payload.kind !== 'PLAN_CHANGE') throw new DomainError('PROPOSAL_INVALID', 'Phase 0 은 플랜 변경 제안만 지원합니다');
  const parsed = parseMatchId(input.payload.matchId);
  if (!parsed) throw new DomainError('PROPOSAL_INVALID', `알 수 없는 경기: ${input.payload.matchId}`);
  const open = existing.filter((p) => p.status === 'OPEN' && p.authorId === author.userId);
  if (open.length >= MAX_OPEN_PER_COACH) {
    throw new DomainError('PROPOSAL_LIMIT', `미결 제안은 코치 1인당 ${MAX_OPEN_PER_COACH}장까지입니다`);
  }
  const after = applyPatch(base, input.payload.patch);
  const diff = diffBundles(base, after);
  if (diff.length === 0) throw new DomainError('PROPOSAL_INVALID', '현재 플랜과 달라지는 내용이 없습니다');
  const paths = diff.map((d) => d.path).sort().join('|');
  const dup = open.find(
    (p) =>
      p.payload.matchId === input.payload.matchId &&
      p.diff
        .map((d) => d.path)
        .sort()
        .join('|') === paths,
  );
  if (dup) throw new DomainError('PROPOSAL_DUPLICATE', '같은 항목을 바꾸는 미결 제안이 이미 있습니다', [dup.id]);
  return {
    id,
    clubId: author.clubId,
    authorId: author.userId,
    ...(author.roleLabel ? { authorRole: author.roleLabel } : {}),
    kind: 'PLAN_CHANGE',
    payload: { kind: 'PLAN_CHANGE', matchId: input.payload.matchId, patch: structuredCloneSafe(input.payload.patch) },
    reason,
    diff,
    reactions: [],
    createdAt: at,
    expiresAt: { season: parsed.season, day: parsed.day },
    status: 'OPEN',
  };
}

function structuredCloneSafe<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function applyPatch(base: PlanBundle, patch: PlanChangePatch): PlanBundle {
  const plan: MatchPlan = structuredCloneSafe(base.plan);
  const tactics: Record<SlotKey, TacticSlot> = structuredCloneSafe(base.tactics);
  if (patch.lineup) plan.lineup = { starters: [...patch.lineup.starters], bench: [...patch.lineup.bench] };
  if (patch.startSlot) plan.startSlot = patch.startSlot;
  if (patch.instructions) {
    const s = tactics[patch.instructions.slot];
    s.instructions = { ...s.instructions, ...patch.instructions.patch };
  }
  if (patch.conditionals) plan.conditionals = structuredCloneSafe(patch.conditionals);
  if (patch.opponentOrders === null) delete plan.opponentOrders;
  else if (patch.opponentOrders) plan.opponentOrders = { ...patch.opponentOrders };
  return { plan, tactics };
}

const fmtStep = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v > 0 ? `+${v}` : String(v));

export function diffBundles(before: PlanBundle, after: PlanBundle): ProposalDiffItem[] {
  const out: ProposalDiffItem[] = [];
  const b = before.plan;
  const a = after.plan;
  const n = Math.max(b.lineup.starters.length, a.lineup.starters.length);
  for (let i = 0; i < n; i++) {
    const x = b.lineup.starters[i] ?? '';
    const y = a.lineup.starters[i] ?? '';
    if (x !== y) out.push({ path: `lineup.starters[${i}]`, label: `선발 ${i + 1}번 자리`, before: x || '-', after: y || '-' });
  }
  if (b.lineup.bench.join(',') !== a.lineup.bench.join(',')) {
    out.push({ path: 'lineup.bench', label: '벤치', before: b.lineup.bench.join(', ') || '-', after: a.lineup.bench.join(', ') || '-' });
  }
  if (b.startSlot !== a.startSlot) out.push({ path: 'startSlot', label: '시작 전술', before: b.startSlot, after: a.startSlot });
  for (const slot of ['A', 'B'] as SlotKey[]) {
    const bi = before.tactics[slot].instructions;
    const ai = after.tactics[slot].instructions;
    for (const k of Object.keys(INSTRUCTION_LABELS) as (keyof TeamInstructions)[]) {
      if (bi[k] !== ai[k]) {
        out.push({ path: `instructions.${slot}.${k}`, label: `전술 ${slot} ${INSTRUCTION_LABELS[k]}`, before: fmtStep(bi[k]), after: fmtStep(ai[k]) });
      }
    }
  }
  if (JSON.stringify(b.conditionals) !== JSON.stringify(a.conditionals)) {
    out.push({ path: 'conditionals', label: '조건부 지시', before: `${b.conditionals.length}개`, after: `${a.conditionals.length}개` });
  }
  const oo = (p: MatchPlan) => (p.opponentOrders ? JSON.stringify(p.opponentOrders) : '');
  if (oo(b) !== oo(a)) {
    const show = (p: MatchPlan) =>
      p.opponentOrders
        ? [p.opponentOrders.markTarget ? `마크 ${p.opponentOrders.markTarget}` : '', p.opponentOrders.attackSide ? `공략 ${p.opponentOrders.attackSide}` : '']
            .filter(Boolean)
            .join(' · ') || '지정'
        : '없음';
    out.push({ path: 'opponentOrders', label: '상대 맞춤 지시', before: show(b), after: show(a) });
  }
  return out;
}

/** 같은 필드(path)를 바꾸는 다른 OPEN 제안 → 승인 시 SUPERSEDED */
export function findConflicting(target: Proposal, open: readonly Proposal[]): Proposal[] {
  const paths = new Set(target.diff.map((d) => d.path));
  return open.filter((p) => p.id !== target.id && p.status === 'OPEN' && p.clubId === target.clubId && p.diff.some((d) => paths.has(d.path)));
}

/** 적용 기준 플랜: 확정본 > 초안 > 4.7 미리보기 플랜(fallback) */
export function pickBasePlan(state: ClubPlanState | undefined, fallback: MatchPlan): MatchPlan {
  return state?.confirmed?.plan ?? state?.draft?.plan ?? fallback;
}
