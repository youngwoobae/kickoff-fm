/**
 * 빈 앱 셸 (소유: B). 하단 탭 5개 + 콘텐츠 영역 + 하단 고정 "다음 날로 넘기기" 자리.
 * 서비스 연결은 B 가 services/index.ts 의 createGameService 로 한다(현재 스텁이라 호출하지 않음).
 */
import { useState } from 'react';

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'squad', label: '선수단' },
  { id: 'tactics', label: '전술' },
  { id: 'league', label: '리그' },
  { id: 'club', label: '구단' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('home');
  const current = TABS.find((t) => t.id === tab);

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">킥오프 FM</span>
        <span className="app-badge">Phase 0</span>
      </header>
      <main className="app-main" aria-live="polite">
        <p className="placeholder">{current?.label} 화면 (준비 중)</p>
      </main>
      <nav className="app-tabbar" aria-label="주 메뉴">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? 'tab is-active' : 'tab'}
            aria-current={t.id === tab ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
