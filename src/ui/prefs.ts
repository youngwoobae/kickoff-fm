/**
 * UI 환경설정 (소유: B, M6.3). localStorage 키 1개 `kickoff-fm/ui/prefs`(JSON, v:1). 세이브와 무관한 기기 설정.
 * 모든 읽기·쓰기는 try/catch — 저장소를 못 쓰면 메모리 값으로만 동작한다(persistable=false).
 */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type FontScale = 1 | 1.125 | 1.25;
export type MotionPref = 'system' | 'reduce' | 'full';
export type ReplaySpeed = '1' | '2' | '4' | 'instant';
export type TutorialStatus = 'new' | 'active' | 'done' | 'skipped';

export interface UiPrefs {
  v: 1;
  theme: ThemePref;
  fontScale: FontScale;
  motion: MotionPref;
  replaySpeed: ReplaySpeed;
  /** 2D 경기 화면 (M6.5) */
  pitch2d: boolean;
  /** 여러 날 진행 전 확인 */
  confirmMultiDay: boolean;
  /** 플랜 미확정으로 넘길 때 확인 */
  confirmUnsubmitted: boolean;
  tutorial: { status: TutorialStatus; step: number };
}

export const PREFS_KEY = 'kickoff-fm/ui/prefs';
const OLD_THEME_KEY = 'kickoff-fm/ui/theme';

export const DEFAULT_PREFS: UiPrefs = {
  v: 1,
  theme: 'system',
  fontScale: 1,
  motion: 'system',
  replaySpeed: '2',
  pitch2d: true,
  confirmMultiDay: true,
  confirmUnsubmitted: false,
  tutorial: { status: 'new', step: 1 },
};

const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

/** 저장된 JSON(일부·손상 포함)을 안전한 UiPrefs 로 */
export function normalizePrefs(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (r.tutorial && typeof r.tutorial === 'object' ? r.tutorial : {}) as Record<string, unknown>;
  const step = typeof t.step === 'number' && t.step >= 1 && t.step <= 6 ? Math.floor(t.step) : 1;
  return {
    v: 1,
    theme: pick(r.theme, ['system', 'light', 'dark'] as const, DEFAULT_PREFS.theme),
    fontScale: pick(r.fontScale, [1, 1.125, 1.25] as const, DEFAULT_PREFS.fontScale),
    motion: pick(r.motion, ['system', 'reduce', 'full'] as const, DEFAULT_PREFS.motion),
    replaySpeed: pick(r.replaySpeed, ['1', '2', '4', 'instant'] as const, DEFAULT_PREFS.replaySpeed),
    pitch2d: typeof r.pitch2d === 'boolean' ? r.pitch2d : DEFAULT_PREFS.pitch2d,
    confirmMultiDay: typeof r.confirmMultiDay === 'boolean' ? r.confirmMultiDay : DEFAULT_PREFS.confirmMultiDay,
    confirmUnsubmitted: typeof r.confirmUnsubmitted === 'boolean' ? r.confirmUnsubmitted : DEFAULT_PREFS.confirmUnsubmitted,
    tutorial: { status: pick(t.status, ['new', 'active', 'done', 'skipped'] as const, 'new'), step },
  };
}

/** 저장소 쓰기가 되는가 (설정 화면 상단 안내용) */
export let prefsPersistable = true;

function load(): UiPrefs {
  try {
    const ls = globalThis.localStorage;
    const raw = ls.getItem(PREFS_KEY);
    const prefs = normalizePrefs(raw ? JSON.parse(raw) : {});
    // 옛 테마 키 1회 이전
    const old = ls.getItem(OLD_THEME_KEY);
    if (old !== null) {
      if (!raw) prefs.theme = pick(old, ['system', 'light', 'dark'] as const, 'system');
      ls.setItem(PREFS_KEY, JSON.stringify(prefs));
      ls.removeItem(OLD_THEME_KEY);
    }
    return prefs;
  } catch {
    prefsPersistable = false;
    return { ...DEFAULT_PREFS };
  }
}

let current = load();
const listeners = new Set<() => void>();

function apply(p: UiPrefs): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (p.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  root.style.fontSize = p.fontScale === 1 ? '' : `${p.fontScale * 100}%`;
  if (p.motion === 'system') delete root.dataset.motion;
  else root.dataset.motion = p.motion;
}
apply(current);

export function getPrefs(): UiPrefs {
  return current;
}

export function setPrefs(patch: Partial<UiPrefs>): void {
  current = { ...current, ...patch };
  apply(current);
  try {
    globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify(current));
    prefsPersistable = true;
  } catch {
    prefsPersistable = false;
  }
  listeners.forEach((l) => l());
}

export function resetPrefs(): void {
  // 튜토리얼 진행은 "설정"이 아니므로 유지
  setPrefs({ ...DEFAULT_PREFS, tutorial: current.tutorial });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}

const mq = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);

function subscribeMotion(l: () => void): () => void {
  const m = mq();
  m?.addEventListener?.('change', l);
  const off = subscribe(l);
  return () => {
    m?.removeEventListener?.('change', l);
    off();
  };
}
const getReduced = () => (current.motion === 'system' ? !!mq()?.matches : current.motion === 'reduce');

/** 모션 줄이기 판정: 설정 우선, '기기 설정 따르기'면 prefers-reduced-motion */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, getReduced, getReduced);
}
