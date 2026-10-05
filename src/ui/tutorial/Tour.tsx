/**
 * 첫 실행 튜토리얼 (소유: B, M6.3 · 명세 docs/설계/온보딩_UX.md 1장).
 * 실제 게임 화면 위에 얹는 코치마크 6단계. 진행을 막지 않는다: 오버레이는 pointer-events:none, 말풍선만 조작 가능.
 * 진행은 prefs.tutorial = { status, step } 에 단계마다 즉시 저장된다.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNav, type NavState } from '../app/nav';
import { useToast } from '../components/Toast';
import { getPrefs, setPrefs, usePrefs, useReducedMotion } from '../prefs';
import { useQuery } from '../service/ServiceContext';

/** TitleScreen 이 새 게임을 만들 때 켠다 → 첫 화면에서 바로 단계 1 시작(이어하기·가져오기면 "처음이세요?" 카드) */
export const tourHint = { newGame: false };

/** 설정 > 튜토리얼 다시 보기 */
export function restartTour(): void {
  setPrefs({ tutorial: { status: 'active', step: 1 } });
}

interface Bubble {
  target: string;
  title: string;
  text: ReactNode;
  /** 대상이 없을 때 덧붙이는 문구 */
  fallback?: string;
}
interface StepDef {
  nav: Partial<NavState>;
  bubbles: Bubble[];
}

const OFF_DAY = '지금은 경기일이 아니라 다음 경기일에 해 볼 수 있어요.';

export const TOUR_STEPS: StepDef[] = [
  {
    nav: { tab: 'home' },
    bubbles: [
      {
        target: 'home.nextMatch',
        title: '킥오프 FM에 오신 걸 환영해요',
        text: '매일 상대를 보고 경기 플랜을 정한 뒤, 하루씩 넘기며 시즌을 치러요. 이 카드에 다음 상대와 약점이 나와요.',
        fallback: OFF_DAY,
      },
    ],
  },
  {
    nav: { tab: 'squad', squad: 'lineup' },
    bubbles: [
      { target: 'lineup.pitch', title: '선발 바꾸기', text: '선수를 탭하고 바꿀 자리를 다시 탭하면 자리가 바뀌어요.' },
      {
        target: 'lineup.autoRotation',
        title: '자동 로테이션',
        text: '켜 두면 컨디션 70 미만 선발을 경기 전에 알아서 바꿔요. 바쁜 날도 걱정 없어요.',
        fallback: OFF_DAY,
      },
    ],
  },
  {
    nav: { tab: 'tactics', tactics: 'team' },
    bubbles: [
      {
        target: 'tactics.styles',
        title: '전술 스타일',
        text: '원하는 스타일을 골라 보세요. 포메이션·역할·지시가 한 번에 들어가요. 세부 슬라이더는 나중에 천천히 만져도 돼요.',
      },
    ],
  },
  {
    nav: { tab: 'tactics', tactics: 'plan' },
    bubbles: [
      { target: 'plan.default', title: '기본 플랜', text: '기본 플랜으로 저장해 두면, 제출을 잊은 날에도 이 플랜으로 경기해요.', fallback: OFF_DAY },
      { target: 'plan.submit', title: '확정 제출', text: '오늘 경기는 ‘확정 제출’을 눌러 마무리해요. 제출하지 않아도 기본 플랜으로 경기해요.', fallback: OFF_DAY },
    ],
  },
  {
    nav: { tab: 'home' },
    bubbles: [
      { target: 'home.advance', title: '다음 날로 넘기기', text: '준비가 끝났어요. ‘다음 날로 넘기기’를 누르면 경기가 진행돼요.' },
      { target: 'dayResult.replay', title: '중계 보기', text: '결과가 나왔어요. ‘중계 보기’로 경기를 다시 볼 수 있어요.' },
    ],
  },
  {
    nav: { tab: 'match', matchView: 'report' },
    bubbles: [
      {
        target: 'report.keyFactors',
        title: '승부 요인',
        text: '여기서 내 전술이 결과를 어떻게 바꿨는지 볼 수 있어요.',
        fallback: '첫 경기를 치르면 여기에 경기 리포트가 나와요.',
      },
      {
        target: 'report.suggestions',
        title: '다음 경기 제안',
        text: '제안을 누르면 팀 지시에 바로 반영돼요. 이제 직접 해 보세요!',
        fallback: '이번 경기는 제안이 없어요. 다음 리포트에서 확인해 보세요. 이제 직접 해 보세요!',
      },
    ],
  },
];
const TOTAL = TOUR_STEPS.length;

const navMatches = (nav: NavState, want: Partial<NavState>) => (Object.keys(want) as (keyof NavState)[]).every((k) => nav[k] === want[k]);

function findTarget(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
}

/** 대상 요소 위치 추적: DOM 변화·스크롤·리사이즈 때 rAF 1회로 재측정 */
function useTargetRect(name: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!name) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = findTarget(name);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (r && r.width > 0 ? (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r) : null));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    addEventListener('scroll', schedule, true);
    addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      removeEventListener('scroll', schedule, true);
      removeEventListener('resize', schedule);
    };
  }, [name]);
  return rect;
}

export function Tour() {
  const prefs = usePrefs();
  const { nav, go } = useNav();
  const toast = useToast();
  const reduce = useReducedMotion();
  const planState = useQuery((s) => s.getPlanState()).data;
  const { status, step } = prefs.tutorial;
  const [sub, setSub] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [intro, setIntro] = useState(false);
  const titleId = useId();
  const bubbleRef = useRef<HTMLDivElement>(null);

  // 시작 조건(1.2): 새 게임 → 바로 시작, 이어하기 + 'new' → "처음이세요?" 카드, 'active' → 저장된 단계 화면으로
  useEffect(() => {
    const t = getPrefs().tutorial;
    if (t.status === 'new') {
      if (tourHint.newGame) setPrefs({ tutorial: { status: 'active', step: 1 } });
      else setIntro(true);
      go({ tab: 'home' });
    } else if (t.status === 'active') go(TOUR_STEPS[t.step - 1]?.nav ?? {});
    tourHint.newGame = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toStep = useCallback(
    (n: number, navigate = true) => {
      setSub(0);
      setCollapsed(false);
      setPrefs({ tutorial: { status: 'active', step: n } });
      if (navigate) go(TOUR_STEPS[n - 1]?.nav ?? {});
    },
    [go],
  );
  const skip = useCallback(() => {
    setIntro(false);
    setPrefs({ tutorial: { status: 'skipped', step } });
    toast.show('튜토리얼은 설정에서 다시 볼 수 있어요');
  }, [step, toast]);
  const finish = useCallback(() => {
    setPrefs({ tutorial: { status: 'done', step: TOTAL } });
    toast.show('튜토리얼을 마쳤어요. 설정에서 언제든 다시 볼 수 있어요', 'success');
  }, [toast]);

  // 다시 보기 등으로 단계가 바뀌면 말풍선 순번 초기화
  useEffect(() => {
    setSub(0);
    setCollapsed(false);
  }, [step, status]);

  // 자동 진행(U2): 단계 4 — 확정 제출이 "생기면"
  const confirmed = !!planState?.confirmed;
  const prevConfirmed = useRef(confirmed);
  useEffect(() => {
    if (status === 'active' && step === 4 && confirmed && !prevConfirmed.current) toStep(5);
    prevConfirmed.current = confirmed;
  }, [confirmed, status, step, toStep]);
  // 단계 5 — 경기 탭에 들어가면 (중계 보기). 단계 6 말풍선은 리포트 화면에서 뜬다
  useEffect(() => {
    if (status === 'active' && step === 5 && nav.tab === 'match') toStep(6, false);
  }, [nav.tab, status, step, toStep]);

  const active = status === 'active' || intro;
  const def = TOUR_STEPS[(intro ? 1 : step) - 1];
  const onScreen = !!def && navMatches(nav, def.nav);
  // 단계 5: 하루 결과 시트가 열려 "중계 보기"가 보이면 두 번째 말풍선
  const [replayShown, setReplayShown] = useState(false);
  useEffect(() => {
    if (!(active && step === 5)) return;
    const check = () => setReplayShown(!!findTarget('dayResult.replay'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [active, step]);
  const bi = step === 5 && !intro ? (replayShown ? 1 : 0) : sub;
  const bubble = def?.bubbles[Math.min(bi, def.bubbles.length - 1)];
  const show = active && onScreen && !collapsed && !!bubble;
  const rect = useTargetRect(show && bubble ? bubble.target : null);

  // 대상 화면 중앙으로 스크롤 (말풍선이 바뀔 때 1회)
  const bubbleKey = `${step}:${bi}:${intro}`;
  useLayoutEffect(() => {
    if (!show || !bubble) return;
    const el = findTarget(bubble.target);
    // 화면 절반보다 큰 대상(피치·스타일 목록)은 머리가 보이게 위쪽 정렬
    el?.scrollIntoView({ block: el.offsetHeight > innerHeight / 2 ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' });
    bubbleRef.current?.querySelector<HTMLElement>('.tour-title')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, bubbleKey]);

  // 대상 요소에 aria-describedby 로 말풍선 연결
  const bodyId = `${titleId}-body`;
  useEffect(() => {
    if (!show || !bubble || !rect) return;
    const el = findTarget(bubble.target);
    if (!el) return;
    const prev = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', bodyId);
    return () => {
      if (prev) el.setAttribute('aria-describedby', prev);
      else el.removeAttribute('aria-describedby');
    };
  }, [show, bubble, rect, bodyId]);

  // Esc = 말풍선 접기 (칩으로 재개)
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sheet')) setCollapsed(true);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [show]);

  if (!active || !def || !bubble) return null;

  // 다른 화면에 있거나 접었을 때: 이어 보기 칩 (진행을 막지 않음)
  if (!show) {
    return (
      <button
        type="button"
        className="tour-chip"
        onClick={() => {
          setCollapsed(false);
          go(def.nav);
        }}
      >
        튜토리얼 이어 보기 ({step}/{TOTAL})
      </button>
    );
  }

  const last = step === TOTAL && bi === def.bubbles.length - 1;
  const next = () => {
    if (intro) {
      setIntro(false);
      return toStep(1);
    }
    if (last) return finish();
    if (step !== 5 && sub < def.bubbles.length - 1) return setSub(sub + 1);
    toStep(step + 1);
  };

  const vh = innerHeight;
  const bottomReserve = 76; // 하단 탭바 + 여백
  const pad = 6;
  let pos: CSSProperties;
  if (!rect) pos = { top: '50%', transform: 'translateY(-50%)' };
  else if (vh - rect.bottom - bottomReserve >= 190) pos = { top: rect.bottom + pad + 10 };
  else if (rect.top >= 230) pos = { bottom: vh - rect.top + pad + 10 };
  else pos = { bottom: bottomReserve };

  return (
    <div className={`tour ${reduce ? 'is-still' : ''}`}>
      {rect ? (
        <div className="tour-hole" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div ref={bubbleRef} className="tour-bubble" style={pos} role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={bodyId}>
        <div className="tour-head">
          <h2 id={titleId} className="tour-title" tabIndex={-1}>
            {intro ? '처음이세요?' : bubble.title}
          </h2>
          <span className="tour-progress" role="img" aria-label={`${TOTAL}단계 중 ${intro ? 1 : step}단계`}>
            {intro ? 1 : step} / {TOTAL}
          </span>
        </div>
        <p id={bodyId} className="tour-text">
          {intro ? '킥오프 FM을 1분 만에 둘러볼 수 있어요. 화면을 하나씩 짚어 드릴게요.' : bubble.text}
          {!intro && !rect && bubble.fallback && <> {bubble.fallback}</>}
        </p>
        <div className="tour-actions">
          <button type="button" className="btn btn-ghost" onClick={skip}>
            건너뛰기
          </button>
          <button type="button" className="btn btn-primary" onClick={next}>
            {intro ? '둘러보기' : last ? '완료' : '다음'}
          </button>
        </div>
      </div>
    </div>
  );
}
