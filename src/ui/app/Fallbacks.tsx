/** 서비스 오류 안내 · 에러 경계 (소유: B) */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DEV_TOOLS } from '../service/serviceHost';

export function ServiceUnavailable({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="fallback">
      {DEV_TOOLS ? (
        <>
          <h1>서비스를 불러오지 못했어요</h1>
          <p>
            오류: <code>{msg}</code>
          </p>
        </>
      ) : (
        <>
          <h1>이 화면을 그리다 문제가 생겼어요</h1>
          <p>‘새로고침’을 누르면 대부분 해결돼요.</p>
        </>
      )}
      <button type="button" className="btn btn-ghost btn-block" onClick={() => globalThis.location.reload()}>
        새로고침
      </button>
    </div>
  );
}

interface BoundaryProps {
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
    if (this.state.error) return <ServiceUnavailable error={this.state.error} />;
    return this.props.children;
  }
}
