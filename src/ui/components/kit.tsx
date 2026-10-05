/** 공용 UI 프리미티브 (소유: B). 외부 UI 라이브러리 없이 CSS 변수 기반. */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { GameError } from '../../services';
import type { FitLevel, Player, Step } from '../../types';
import { YELLOW_LIMIT, yellowAccumOf } from '../types23';
import { FIT_LABEL, FIT_SYMBOL, TRANSFER_ERROR_TEXT, conditionTone, kcToM, mToKc, starsText, stepText } from '../format';

/** tour: 튜토리얼 코치마크가 찾는 data-tour 표식 */
export function Card({ title, extra, children, className = '', tour }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; tour?: string }) {
  return (
    <section className={`card ${className}`} data-tour={tour}>
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
  panelId,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  /** 이 탭들이 바꾸는 role="tabpanel" 의 id (있으면 aria-controls, 탭 id 는 `${panelId}-tab-${value}`) */
  panelId?: string;
}) {
  // panelId 가 있으면 WAI-ARIA 탭(tablist/tab/aria-selected), 없으면 값 고르기라 radiogroup/radio/aria-checked.
  // 둘 다 선택된 항목만 Tab 순서에 두고 ←/→/Home/End 로 이동하며 바로 선택한다
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const on = options.filter((o) => !o.disabled);
    const i = on.findIndex((o) => o.value === value);
    const next = e.key === 'ArrowRight' ? on[(i + 1) % on.length] : e.key === 'ArrowLeft' ? on[(i - 1 + on.length) % on.length] : e.key === 'Home' ? on[0] : e.key === 'End' ? on[on.length - 1] : undefined;
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`);
    btn?.focus();
  };
  return (
    <div className={`segmented segmented-${size}`} role={panelId ? 'tablist' : 'radiogroup'} aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role={panelId ? 'tab' : 'radio'}
          id={panelId ? `${panelId}-tab-${o.value}` : undefined}
          aria-controls={panelId}
          aria-selected={panelId ? o.value === value : undefined}
          aria-checked={panelId ? undefined : o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-value={o.value}
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
          {changed && <span className="dot-changed" role="img" aria-label="변경됨" />}
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
    <span className={`cond ${compact ? 'cond-compact' : ''}`} role="img" aria-label={`컨디션 ${v}`}>
      <span className="cond-track">
        <span className={`cond-fill tone-${conditionTone(v)}`} style={{ width: `${Math.max(4, v)}%` }} />
      </span>
      {!compact && <span className="cond-num">{v}</span>}
    </span>
  );
}

export function FitMark({ fit }: { fit: FitLevel }) {
  return (
    <span className={`fit fit-${fit.toLowerCase()}`} title={FIT_LABEL[fit]} role="img" aria-label={`적합도 ${FIT_LABEL[fit]}`}>
      {FIT_SYMBOL[fit]}
    </span>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** 경고 누적·출장 정지 배지 (2.3.0). 색 + 텍스트. 누적 0·정지 0 이면 아무것도 그리지 않는다 */
export function DisciplineBadges({ p }: { p: Player }) {
  const accum = yellowAccumOf(p);
  const ban = p.availability.suspendedMatches;
  return (
    <>
      {ban > 0 && <Badge tone="bad">🟥 정지 {ban}경기</Badge>}
      {accum > 0 && (
        <Badge tone={accum >= YELLOW_LIMIT - 1 ? 'warn' : 'neutral'}>
          🟨 {accum}/{YELLOW_LIMIT}
          {accum >= YELLOW_LIMIT - 1 && ' 다음 경고 시 정지'}
        </Badge>
      )}
    </>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** 아래에서 올라오는 시트. 열리면 시트로 포커스, Tab 은 시트 안에서 순환, Esc·배경 탭으로 닫히고 닫히면 연 요소로 포커스 복귀 */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // onClose 는 보통 매 렌더 새 함수라 effect 의존성에 넣으면 렌더마다 포커스가 튄다 → ref 로 최신 값만 본다
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // 다음 프레임에 포커스: 커밋 직후 focus() 는 강제 레이아웃을 일으킨다(성능 프로파일 권장안 2)
    const raf = requestAnimationFrame(() => ref.current?.focus());
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = ref.current;
      // 겹친 시트(편지함 → 선수 시트 등)는 가장 위 시트만 반응
      if (!el || el !== [...document.querySelectorAll('.sheet')].pop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        const at = document.activeElement;
        if (e.shiftKey && (at === first || at === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      if (prev?.isConnected) prev.focus();
    };
  }, [open]);
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

/** 2.4.1: 같은 코드 안에서 details 로 구분되는 사유 → 전용 문구 */
const DETAIL_TEXT: Record<string, string> = {
  ALREADY_RENEWED: '이미 재계약했어요. 새 계약은 다음 시즌부터 적용돼요.',
  RELEASED: '이번 시즌에 방출한 선수는 FA로 다시 데려올 수 없어요',
};

/** 이적·계약 오류 안내: 코드별 해요체 문구 + 서비스가 준 구체 사유(범위 등). 코드는 개발자 모드에서만 */
export function ErrorNote({ error, dev }: { error: GameError | null; dev?: boolean }) {
  if (!error) return null;
  // 2.2.1: 서비스 문구가 이미 해요체 + 허용 범위라 그대로 보여 주고, 비어 있을 때만 코드별 대체 문구
  return (
    <div className="error-note" role="alert">
      <span>⚠ {DETAIL_TEXT[error.details?.find((d) => d in DETAIL_TEXT) ?? ''] || error.message || TRANSFER_ERROR_TEXT[error.code] || error.code}</span>
      {dev && <small className="muted">({error.code})</small>}
    </div>
  );
}

/** KC 금액 입력 (M 단위, 0.001M = 1K). value 는 KC 정수, 빈 칸이면 null */
export function MoneyField({ label, value, onChange, hint, invalid }: { label: string; value: number | null; onChange: (kc: number | null) => void; hint?: ReactNode; invalid?: boolean }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label} (M KC)</span>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type="number"
        inputMode="decimal"
        step="0.001"
        min="0"
        aria-invalid={invalid || undefined}
        value={value === null ? '' : kcToM(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : mToKc(Number(e.target.value)))}
      />
      {hint && (
        <small id={`${id}-hint`} className={invalid ? 'neg' : 'muted'}>
          {invalid && '⚠ '}
          {hint}
        </small>
      )}
    </label>
  );
}
