/**
 * GameService ↔ React 연결 (소유: B).
 * - 상태 구독: useSyncExternalStore(service.subscribe, service.getSnapshot)
 * - 조회: useQuery (스냅샷이 바뀔 때만 재계산, GameError 는 값으로 돌려준다)
 * - 변경: useAction (GameError → 토스트, 그 외 예외 → 치명 오류 화면)
 */
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isGameError, type GameError, type GameService } from '../../services';
import type { GameSnapshot, Membership, SaveStatus } from '../../types';
import { useToast } from '../components/Toast';

interface ServiceCtxValue {
  service: GameService;
  reportFatal(e: unknown): void;
}

const ServiceCtx = createContext<ServiceCtxValue | null>(null);

export function ServiceProvider({ value, children }: { value: ServiceCtxValue; children: ReactNode }) {
  return <ServiceCtx.Provider value={value}>{children}</ServiceCtx.Provider>;
}

export function useServiceCtx(): ServiceCtxValue {
  const v = useContext(ServiceCtx);
  if (!v) throw new Error('ServiceProvider 밖에서 사용했습니다');
  return v;
}

export function useService(): GameService {
  return useServiceCtx().service;
}

export function useSnapshot(): GameSnapshot | null {
  const service = useService();
  const sub = useCallback((l: () => void) => service.subscribe(l), [service]);
  const get = useCallback(() => service.getSnapshot(), [service]);
  return useSyncExternalStore(sub, get, get);
}

/** 게임 안 화면 전용: 스냅샷이 반드시 있다 */
export function useGame(): GameSnapshot {
  const s = useSnapshot();
  if (!s) throw new Error('열린 게임이 없어요');
  return s;
}

export type QueryResult<T> = { data: T; error: null } | { data: undefined; error: Error };

/** 서비스 조회. 스냅샷 참조와 deps 가 같으면 다시 계산하지 않는다. GameError 는 error 로 돌려준다 */
export function useQuery<T>(fn: (s: GameService) => T, deps: readonly unknown[] = []): QueryResult<T> {
  const service = useService();
  const snap = useSnapshot();
  return useMemo<QueryResult<T>>(() => {
    try {
      return { data: fn(service), error: null };
    } catch (e) {
      if (isGameError(e)) return { data: undefined, error: e };
      throw e; // 미구현(TODO) 등은 ErrorBoundary 로
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, snap, ...deps]);
}

export function useActor(): Membership | undefined {
  return useQuery((s) => s.getActor()).data;
}

export function useIsOwner(): boolean {
  return useActor()?.seat === 'OWNER';
}

/** 대기 중 제안 수: 플랜 제안 + 2.5.0 이적·재계약 제안 */
export function useOpenProposalCount(): number {
  return useQuery((s) => s.listProposals({ status: 'OPEN' }).length + (s.listDealProposals({ status: 'OPEN' }).length)).data ?? 0;
}

/** 변경 메서드 실행기 */
export function useAction() {
  const { service, reportFatal } = useServiceCtx();
  const toast = useToast();
  return useCallback(
    <T,>(fn: (s: GameService) => T, success?: string | ((r: T) => string | undefined)): T | undefined => {
      try {
        const r = fn(service);
        const msg = typeof success === 'function' ? success(r) : success;
        if (msg) toast.show(msg, 'success');
        return r;
      } catch (e) {
        if (isGameError(e)) {
          toast.show(e.message || e.code, 'error');
          return undefined;
        }
        reportFatal(e);
        return undefined;
      }
    },
    [service, reportFatal, toast],
  );
}

/** 시트 안 변경 실행기: GameError 를 토스트 대신 error 로 남겨 그 자리에서 안내한다 (이적·계약) */
export function useInlineAction() {
  const { service, reportFatal } = useServiceCtx();
  const toast = useToast();
  const [error, setError] = useState<GameError | null>(null);
  const run = useCallback(
    <T,>(fn: (s: GameService) => T, success?: string): T | undefined => {
      try {
        const r = fn(service);
        setError(null);
        if (success) toast.show(success, 'success');
        return r;
      } catch (e) {
        if (isGameError(e)) setError(e);
        else reportFatal(e);
        return undefined;
      }
    },
    [service, reportFatal, toast],
  );
  const clear = useCallback(() => setError(null), []);
  return { run, error, clear };
}

/** 비동기 변경(슬롯·flush) 실행기. useAction 과 같은 오류 처리 */
export function useAsyncAction() {
  const { service, reportFatal } = useServiceCtx();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: (s: GameService) => Promise<T> | T, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn(service);
        if (success) toast.show(success, 'success');
        return r;
      } catch (e) {
        if (isGameError(e)) {
          toast.show(e.message || e.code, 'error');
          return undefined;
        }
        reportFatal(e);
        return undefined;
      }
    },
    [service, reportFatal, toast],
  );
}

/** 자동 저장 상태 (getSaveStatus 는 같은 상태면 같은 참조) */
export function useSaveStatus(): SaveStatus {
  const service = useService();
  const sub = useCallback((l: () => void) => service.subscribe(l), [service]);
  const get = useCallback(() => service.getSaveStatus(), [service]);
  return useSyncExternalStore(sub, get, get);
}
