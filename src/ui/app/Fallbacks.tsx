/** 미구현 실제 서비스 안내 · 에러 경계 (소유: B) */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DEV_TOOLS, reloadInFakeMode, reloadInRealMode, type ServiceMode } from '../service/serviceHost';

export function ServiceUnavailable({ error, mode }: { error: unknown; mode: ServiceMode }) {
  const msg = error instanceof Error ? error.message : String(error);
  const isTodo = /TODO/i.test(msg);
  return (
    <div className="fallback">
      <h1>{isTodo ? '실제 게임 서비스가 아직 준비되지 않았어요' : '서비스를 불러오지 못했어요'}</h1>
      <p>
        현재 모드: <strong>{mode === 'fake' ? '가짜(fake) 서비스' : '실제 서비스'}</strong>
        <br />
        오류: <code>{msg}</code>
      </p>
      {!DEV_TOOLS ? null : mode === 'real' ? (
        <>
          <h2>fake 모드로 실행하려면…</h2>
          <ol>
            <li>
              PowerShell: <code>$env:VITE_FAKE_SERVICE='1'; npm run dev</code>
            </li>
            <li>
              bash: <code>VITE_FAKE_SERVICE=1 npm run dev</code>
            </li>
            <li>
              또는 주소 뒤에 <code>?fake=1</code> 을 붙여 여세요 (아래 버튼)
            </li>
          </ol>
          <button type="button" className="btn btn-primary btn-block" onClick={reloadInFakeMode}>
            지금 fake 모드로 열기
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-secondary btn-block" onClick={reloadInRealMode}>
          실제 서비스로 다시 시도
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-block" onClick={() => globalThis.location.reload()}>
        새로고침
      </button>
    </div>
  );
}

interface BoundaryProps {
  mode: ServiceMode;
  children: ReactNode;
  resetKey?: unknown;
}
interface BoundaryState {
  error: unknown;
  key: unknown;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, key: undefined };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ui] 화면 오류', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) return <ServiceUnavailable error={this.state.error} mode={this.props.mode} />;
    return this.props.children;
  }
}
