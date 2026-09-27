/**
 * 다음 경기 플랜 작업본 (소유: B). 선발 화면과 경기 플랜 화면이 같은 작업본을 편집한다.
 * 기준 = 확정본 > 초안 > 4.7 미리보기(서비스 계산). 편집하지 않은 상태면 서버 상태 변경을 따라간다.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MatchPlan, PlanChangePatch, PlanState } from '../../types';
import { useQuery } from '../service/ServiceContext';

interface PlanEditorValue {
  planState: PlanState | undefined;
  /** 서버 기준 플랜 (확정 > 초안 > 미리보기) */
  base: MatchPlan | null;
  plan: MatchPlan | null;
  dirty: boolean;
  update(fn: (p: MatchPlan) => MatchPlan): void;
  replace(p: MatchPlan): void;
  reset(): void;
  /** 저장·제출 성공 후 호출: 작업본을 유지한 채 서버 상태를 다시 따라간다 */
  markSaved(): void;
}

const Ctx = createContext<PlanEditorValue | null>(null);

function baseOf(ps: PlanState | undefined): MatchPlan | null {
  if (!ps || !ps.matchId) return null;
  return ps.confirmed?.plan ?? ps.draft?.plan ?? ps.preview?.plan ?? null;
}

export function PlanEditorProvider({ children }: { children: ReactNode }) {
  const planState = useQuery((s) => s.getPlanState()).data;
  const base = useMemo(() => baseOf(planState), [planState]);
  const [plan, setPlan] = useState<MatchPlan | null>(base);
  const [dirty, setDirty] = useState(false);
  const baseKey = `${planState?.matchId ?? '-'}|${planState?.confirmed?.updatedAt.seq ?? '-'}|${planState?.draft?.updatedAt.seq ?? '-'}`;
  const lastKey = useRef(baseKey);
  const lastMatch = useRef(planState?.matchId);

  useEffect(() => {
    const matchChanged = lastMatch.current !== planState?.matchId;
    if (matchChanged || (!dirty && lastKey.current !== baseKey) || (!dirty && plan === null && base)) {
      setPlan(base ? structuredClone(base) : null);
      setDirty(false);
    }
    lastKey.current = baseKey;
    lastMatch.current = planState?.matchId;
  }, [baseKey, base, dirty, plan, planState?.matchId]);

  const update = useCallback((fn: (p: MatchPlan) => MatchPlan) => {
    setPlan((p) => (p ? fn(structuredClone(p)) : p));
    setDirty(true);
  }, []);
  const replace = useCallback((p: MatchPlan) => {
    setPlan(structuredClone(p));
    setDirty(true);
  }, []);
  const reset = useCallback(() => {
    setPlan(base ? structuredClone(base) : null);
    setDirty(false);
  }, [base]);
  const markSaved = useCallback(() => setDirty(false), []);
  const value = useMemo<PlanEditorValue>(() => ({ planState, base, plan, dirty, update, replace, reset, markSaved }), [planState, base, plan, dirty, update, replace, reset, markSaved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanEditor(): PlanEditorValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('PlanEditorProvider 밖');
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 코치 제안용: 작업본과 기준의 차이만 담은 패치 */
export function diffPatch(base: MatchPlan, next: MatchPlan): PlanChangePatch {
  const patch: PlanChangePatch = {};
  if (!same(base.lineup, next.lineup)) patch.lineup = structuredClone(next.lineup);
  if (base.startSlot !== next.startSlot) patch.startSlot = next.startSlot;
  if (!same(base.conditionals, next.conditionals)) patch.conditionals = structuredClone(next.conditionals);
  if (!same(base.opponentOrders ?? null, next.opponentOrders ?? null)) patch.opponentOrders = next.opponentOrders ? structuredClone(next.opponentOrders) : null;
  return patch;
}

export function isEmptyPatch(p: PlanChangePatch): boolean {
  return Object.keys(p).length === 0;
}
