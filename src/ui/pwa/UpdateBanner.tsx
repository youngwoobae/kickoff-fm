/**
 * PWA (소유: B): 프로덕션 빌드에서만 서비스 워커를 등록하고, 새 버전이 대기 중이면 배너를 띄운다.
 * 강제 새로고침은 하지 않는다. 사용자가 누르면 밀린 저장을 끝낸 뒤 새 워커로 교체·새로고침한다.
 */
import { useEffect, useState } from 'react';
import { useAsyncAction } from '../service/ServiceContext';

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
const setWaiting = (w: ServiceWorker | null) => {
  waiting = w;
  listeners.forEach((l) => l());
};

if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 컨트롤러가 있을 때만 "새 버전" (첫 설치는 안내 없음)
      const check = () => reg.waiting && navigator.serviceWorker.controller && setWaiting(reg.waiting);
      check();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', check));
      // 설치형 앱은 내비게이션이 드물어 다시 보일 때 업데이트를 확인한다
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => undefined));
    }, (e: unknown) => console.warn('[pwa] 서비스 워커 등록 실패', e));
  });
}

export function UpdateBanner() {
  const [w, setW] = useState(waiting);
  const [busy, setBusy] = useState(false);
  const act = useAsyncAction();
  useEffect(() => {
    const l = () => setW(waiting);
    listeners.add(l);
    l();
    return () => void listeners.delete(l);
  }, []);
  if (!w) return null;
  const apply = async () => {
    setBusy(true);
    // 저장 실패면 act 가 오류 토스트를 띄우고 undefined → 교체하지 않는다
    const ok = await act(async (s) => (await s.flush?.(), true));
    if (!ok) return setBusy(false);
    navigator.serviceWorker.addEventListener('controllerchange', () => globalThis.location.reload(), { once: true });
    w.postMessage('SKIP_WAITING');
  };
  return (
    <div className="update-banner" role="status">
      <span>새 버전이 있어요</span>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply()}>
        {busy ? '저장 중…' : '새로고침'}
      </button>
    </div>
  );
}

/** iOS 사파리는 설치 프롬프트가 없고, 설치하지 않은 사이트의 저장소를 지울 수 있어 홈 화면 추가를 안내한다 */
export function IosInstallHint() {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  const ios = !!nav && (/iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));
  if (!ios || nav.standalone || globalThis.matchMedia?.('(display-mode: standalone)').matches) return null;
  return <p className="warn-line">아이폰·아이패드: 사파리 공유 버튼 → "홈 화면에 추가"로 설치하면 오프라인에서도 열리고 세이브가 안전하게 보관돼요.</p>;
}
