/**
 * GameService ↔ React 연결 (소유: B).
 * - 상태 구독: useSyncExternalStore(service.subscribe, service.getSnapshot)
 * - 조회: useQuery (스냅샷이 바뀔 때만 재계산, GameError 는 값으로 돌려준다)
 * - 변경: useAction (GameError → 토스트, 그 외 예외 → 치명 오류 화면)
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { isGameError, type GameService } from '../../services';
import type { GameSnapshot, Membership } from '../../types';
import { useToast } from '../components/Toast';
import type { ServiceMode } from './serviceHost';

interface ServiceCtxValue {
  service: GameService;
  mode: ServiceMode;
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
  if (!s) throw new Error('게임이 없습니다');
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
