/**
 * 앱 셸 (소유: B). 서비스 부팅 → 게임 유무 분기 → 하단 탭 5개.
 * 탭: 홈 / 스쿼드(목록·선발) / 전술(팀 전술·경기 플랜) / 경기(중계·리포트) / 클럽(리그·재정·코치실·개발자)
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isGameError, type GameService } from '../../services';
import { ToastProvider } from '../components/Toast';
import { Segmented } from '../components/kit';
import { formatKc } from '../format';
import { PlanEditorProvider } from '../plan/PlanEditor';
import { ServiceProvider, useAction, useActor, useQuery, useService, useServiceCtx, useSnapshot } from '../service/ServiceContext';
import { DEV_TOOLS, createServiceFor, resolveServiceMode, type ServiceMode } from '../service/serviceHost';
import { CoachScreen } from '../screens/CoachScreen';
import { FinanceScreen } from '../screens/FinanceScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { LeagueScreen } from '../screens/LeagueScreen';
import { LineupScreen } from '../screens/LineupScreen';
import { MatchCenterScreen } from '../screens/MatchCenterScreen';
import { NewGameScreen } from '../screens/NewGameScreen';
import { PlanScreen } from '../screens/PlanScreen';
import { SquadScreen } from '../screens/SquadScreen';
import { TacticsScreen } from '../screens/TacticsScreen';
import { ErrorBoundary, ServiceUnavailable } from './Fallbacks';
import { INITIAL_NAV, NavCtx, useNav, type NavState, type TabId } from './nav';

/** 개발자 패널: 개발 도구 허용 빌드에서만 별도 청크로 불러온다 (프로덕션 번들 제외) */
const DevPanel = DEV_TOOLS ? lazy(() => import('../screens/DevPanel').then((m) => ({ default: m.DevPanel }))) : null;

type Boot ={ status: 'loading' } | { status: 'ready'; service: GameService } | { status: 'failed'; error: unknown };

export function App() {
  const [mode] = useState<ServiceMode>(resolveServiceMode);
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [fatal, setFatal] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    createServiceFor(mode).then(
      (service) => {
        if (!alive) return;
        try {
          service.loadGame();
        } catch (e) {
          // GameError(SAVE_INCOMPATIBLE 등)는 "게임 없음"으로 처리, 그 외(미구현 TODO 등)는 안내 화면
          if (!isGameError(e)) {
            setBoot({ status: 'failed', error: e });
            return;
          }
        }
        setBoot({ status: 'ready', service });
      },
      (error: unknown) => alive && setBoot({ status: 'failed', error }),
    );
    return () => {
      alive = false;
    };
  }, [mode]);

  const reportFatal = useCallback((e: unknown) => {
    console.error('[ui] 서비스 오류', e);
    setFatal(e);
  }, []);

  if (boot.status === 'loading') return <div className="boot">불러오는 중…</div>;
  if (boot.status === 'failed') return <ServiceUnavailable error={boot.error} mode={mode} />;
  if (fatal) return <ServiceUnavailable error={fatal} mode={mode} />;

  return (
    <ToastProvider>
      <ServiceProvider value={{ service: boot.service, mode, reportFatal }}>
        <ErrorBoundary mode={mode}>
          <GameRoot />
        </ErrorBoundary>
      </ServiceProvider>
    </ToastProvider>
  );
}

function GameRoot() {
  const snap = useSnapshot();
  useSessionLog();
  if (!snap) return <NewGameScreen />;
  return (
    <PlanEditorProvider>
      <Shell />
    </PlanEditorProvider>
  );
}

function useSessionLog() {
  const service = useService();
  useEffect(() => {
    const log = (k: 'SESSION_START' | 'SESSION_END') => {
      try {
        if (service.getSnapshot()) service.logEvent(k);
      } catch {
        /* 로그 실패는 무시 */
      }
    };
    log('SESSION_START');
    const onVis = () => log(document.visibilityState === 'visible' ? 'SESSION_START' : 'SESSION_END');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [service]);
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '⌂' },
  { id: 'squad', label: '스쿼드', icon: '👥' },
  { id: 'tactics', label: '전술', icon: '▦' },
  { id: 'match', label: '경기', icon: '⚽' },
  { id: 'club', label: '클럽', icon: '🏟' },
];

function Shell() {
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const go = useCallback((patch: Partial<NavState>) => {
    setNav((n) => ({ ...n, ...patch }));
    globalThis.scrollTo?.({ top: 0 });
  }, []);
  const api = useMemo(() => ({ nav, go }), [nav, go]);
  const { mode } = useServiceCtx();
  const badges = useTabBadges();

  return (
    <NavCtx.Provider value={api}>
      <div className="app-shell">
        <TopBar />
        <main className="app-main">
          <ErrorBoundary mode={mode} resetKey={nav.tab}>
            <TabContent tab={nav.tab} />
          </ErrorBoundary>
        </main>
        <nav className="app-tabbar" aria-label="주 메뉴">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === nav.tab ? 'tab is-active' : 'tab'}
              aria-current={t.id === nav.tab ? 'page' : undefined}
              onClick={() => go({ tab: t.id })}
            >
              <span className="tab-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span>{t.label}</span>
              {badges[t.id] && <span className="tab-dot" aria-label={badges[t.id]} />}
            </button>
          ))}
        </nav>
      </div>
    </NavCtx.Provider>
  );
}

function useTabBadges(): Partial<Record<TabId, string>> {
  const actor = useActor();
  const ps = useQuery((s) => s.getPlanState()).data;
  const open = useQuery((s) => s.listProposals({ status: 'OPEN' })).data ?? [];
  const out: Partial<Record<TabId, string>> = {};
  if (ps?.matchId && !ps.confirmed) {
    out.home = '플랜 미제출';
    out.tactics = '플랜 미확정';
  }
  if (actor?.seat === 'OWNER' && open.length > 0) out.club = `제안 ${open.length}건 대기`;
  return out;
}

function TabContent({ tab }: { tab: TabId }) {
  const { nav, go } = useNav();
  const snap = useSnapshot();
  const sub = (node: ReactNode, seg: ReactNode) => (
    <>
      <div className="subnav">{seg}</div>
      {node}
    </>
  );
  switch (tab) {
    case 'home':
      return <HomeScreen />;
    case 'squad':
      return sub(
        nav.squad === 'list' ? <SquadScreen /> : <LineupScreen />,
        <Segmented label="스쿼드 하위 화면" value={nav.squad} onChange={(v) => go({ squad: v })} options={[{ value: 'list', label: '선수 목록' }, { value: 'lineup', label: '선발·벤치' }]} />,
      );
    case 'tactics':
      return sub(
        nav.tactics === 'team' ? <TacticsScreen /> : <PlanScreen />,
        <Segmented label="전술 하위 화면" value={nav.tactics} onChange={(v) => go({ tactics: v })} options={[{ value: 'team', label: '팀 전술' }, { value: 'plan', label: '경기 플랜' }]} />,
      );
    case 'match':
      return <MatchCenterScreen />;
    case 'club': {
      const dev = !!DevPanel && (snap?.settings.devMode ?? true);
      const cur = !dev && nav.club === 'dev' ? 'league' : nav.club;
      const body =
        cur === 'league' ? <LeagueScreen /> : cur === 'finance' ? <FinanceScreen /> : cur === 'coach' ? <CoachScreen /> : DevPanel && (
          <Suspense fallback={<div className="boot">불러오는 중…</div>}>
            <DevPanel />
          </Suspense>
        );
      return sub(
        body,
        <Segmented
          label="클럽 하위 화면"
          size="sm"
          value={cur}
          onChange={(v) => go({ club: v })}
          options={[
            { value: 'league', label: '리그' },
            { value: 'finance', label: '재정' },
            { value: 'coach', label: '코치실' },
            ...(dev ? [{ value: 'dev' as const, label: '개발자' }] : []),
          ]}
        />,
      );
    }
  }
}

function TopBar() {
  const snap = useSnapshot();
  const actor = useActor();
  const run = useAction();
  const { mode } = useServiceCtx();
  const fin = useQuery((s) => s.getFinance()).data;
  if (!snap) return null;
  const club = snap.clubs[snap.userClubId];
  const phaseLabel = snap.phase === 'MATCHDAY' ? `Day ${snap.time.day}/28` : snap.phase === 'OFFSEASON' ? `오프시즌 Day ${snap.time.day}` : '시즌 종료';
  return (
    <header className="app-header">
      <div className="hdr-main">
        <span className="app-title">{club?.name ?? '킥오프 FM'}</span>
        <span className="hdr-sub">
          S{snap.time.season} · {phaseLabel}
          {fin && <> · 잔액 {formatKc(fin.balance)}</>}
          {mode === 'fake' && <span className="badge badge-warn hdr-fake">FAKE</span>}
        </span>
      </div>
      <button
        type="button"
        className={`role-chip ${actor?.seat === 'COACH' ? 'is-coach' : ''}`}
        aria-label={`현재 역할 ${actor?.seat === 'OWNER' ? '구단주' : '코치'}, 눌러서 전환`}
        onClick={() => run((s) => s.switchRole(actor?.seat === 'OWNER' ? 'COACH' : 'OWNER'), (m) => `${m.seat === 'OWNER' ? '구단주' : '전술 코치'}로 전환했어요`)}
      >
        {actor?.seat === 'OWNER' ? '👑 구단주' : '🧢 코치'}
      </button>
      <ThemeToggle />
    </header>
  );
}

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'kickoff-fm/ui/theme';

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (globalThis.localStorage?.getItem(THEME_KEY) as Theme | null) ?? 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      globalThis.localStorage?.setItem(THEME_KEY, theme);
    } catch {
      /* noop */
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const icon: Record<Theme, string> = { system: '◐', light: '☀', dark: '☾' };
  const label: Record<Theme, string> = { system: '시스템', light: '라이트', dark: '다크' };
  return (
    <button type="button" className="btn btn-ghost btn-icon" aria-label={`테마: ${label[theme]} (눌러서 변경)`} onClick={() => setTheme(next[theme])}>
      {icon[theme]}
    </button>
  );
}
