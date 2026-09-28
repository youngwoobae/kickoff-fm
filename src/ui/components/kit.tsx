/** 공용 UI 프리미티브 (소유: B). 외부 UI 라이브러리 없이 CSS 변수 기반. */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { FitLevel, Step } from '../../types';
import { FIT_LABEL, FIT_SYMBOL, conditionTone, starsText, stepText } from '../format';

export function Card({ title, extra, children, className = '' }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented-${size}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          disabled={o.disabled}
          className={o.value === value ? 'seg is-active' : 'seg'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 5단계 스냅 슬라이더 (−2..+2). 버튼 5개 radiogroup 이라 스크린리더·한 손 조작 모두 쉽다 */
export function StepSlider({
  label,
  value,
  onChange,
  low,
  high,
  disabled,
  changed,
}: {
  label: string;
  value: Step;
  onChange: (v: Step) => void;
  low: string;
  high: string;
  disabled?: boolean;
  changed?: boolean;
}) {
  const id = useId();
  const steps: Step[] = [-2, -1, 0, 1, 2];
  return (
    <div className="step-slider">
      <div className="step-head">
        <span id={id} className="step-label">
          {label}
          {changed && <span className="dot-changed" aria-label="변경됨" />}
        </span>
        <span className="step-value">{stepText(value)}</span>
      </div>
      <div className="step-track" role="radiogroup" aria-labelledby={id}>
        {steps.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={s === value}
            aria-label={`${label} ${stepText(s)}`}
            disabled={disabled}
            className={s === value ? 'step is-active' : s === 0 ? 'step is-zero' : 'step'}
            onClick={() => onChange(s)}
          >
            {stepText(s)}
          </button>
        ))}
      </div>
      <div className="step-ends">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="toggle-text">
        {label}
        {hint && <small className="muted">{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}

export function ConditionBar({ value, compact }: { value: number; compact?: boolean }) {
  const v = Math.round(value);
  return (
    <span className={`cond ${compact ? 'cond-compact' : ''}`} aria-label={`컨디션 ${v}`}>
      <span className="cond-track">
        <span className={`cond-fill tone-${conditionTone(v)}`} style={{ width: `${Math.max(4, v)}%` }} />
      </span>
      {!compact && <span className="cond-num">{v}</span>}
    </span>
  );
}

export function FitMark({ fit }: { fit: FitLevel }) {
  return (
    <span className={`fit fit-${fit.toLowerCase()}`} title={FIT_LABEL[fit]} aria-label={`적합도 ${FIT_LABEL[fit]}`}>
      {FIT_SYMBOL[fit]}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** 아래에서 올라오는 시트. Esc·배경 탭으로 닫힘 */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

/** 하단 고정 CTA 영역 (엄지 영역) */
export function StickyActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky-actions">
      {note && <div className="sticky-note">{note}</div>}
      <div className="sticky-row">{children}</div>
    </div>
  );
}

/** 진행 막대 (0..1) */
export function Meter({ value, label, tone = 'accent' }: { value: number; label: string; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span className={`meter-fill tone-${tone}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** 역할 적합 ★ 5단계 (텍스트 병기: aria-label) */
export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" role="img" aria-label={`역할 적합 ${n}/5`}>
      {starsText(n)}
    </span>
  );
}
