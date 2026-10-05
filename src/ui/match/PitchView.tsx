/**
 * 2D 탑뷰 중계 (소유: B, M6.5 · 명세 docs/설계/온보딩_UX.md 4장). MatchCenterScreen 이 lazy() 로 불러오는 별도 청크.
 * 시계는 ReplayView 하나가 소유한다: 여기서는 줄 index 와 비트 길이만 받아, React 는 줄마다 한 번 렌더하고
 * 프레임 이동은 rAF 에서 ref 로 <g transform> 만 바꾼다. 좌표는 전부 결정적(FNV-1a 해시, 무작위 없음).
 */
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { CommentaryLine, FormationDef, MatchReplay, PitchCue, PlayerId } from '../../types';
import { minuteText, pitchRows } from '../format';

type Side = 'HOME' | 'AWAY';
/** 정규화 좌표 [u 길이, v 폭]. 화면 좌표는 u 0 = 왼쪽, v 0 = 위 */
type P = [number, number];

export interface PitchViewProps {
  replay: MatchReplay;
  /** 지금 보이는 줄 index */
  index: number;
  /** 이 줄 비트 길이(ms). 0 = 정지 화면(일시정지·즉시·결과로) */
  beatMs: number;
  /** 4× — 보간을 비트의 40%로 */
  fast: boolean;
  reduced: boolean;
  userSide: Side;
  names: { home: string; away: string };
  formations: { home?: FormationDef; away?: FormationDef };
  playerName: (id: PlayerId) => string | undefined;
}

interface Frame {
  /** 볼 트랙 점(화면 좌표). 애니메이션 때 비트 길이에 맞게 솎는다 */
  track: P[];
  /** 공 경로(화면 좌표). 마지막 점이 이 줄의 공 위치 */
  path: P[];
  /** 22점 화면 좌표: 0~10 홈 슬롯, 11~21 원정 슬롯 */
  dots: P[];
  gone: boolean[];
  ring: number;
  card?: { i: number; red: boolean };
  /** 골 하이라이트할 골문 (화면 기준) */
  goal?: 'L' | 'R';
  desc: string;
}

const ZONE_U = [0.17, 0.5, 0.8];
const LANE_V = { L: 0.2, C: 0.5, R: 0.8 } as const;
const TRACK_V = [0.2, 0.5, 0.8];
const ROW_U = [0.04, 0.17, 0.27, 0.36, 0.45, 0.55];
const ZONE_NAME = ['수비 진영', '중원', '공격 진영'];
const LANE_NAME = { L: '왼쪽', C: '가운데', R: '오른쪽' } as const;
const RESET = new Set(['KICK_OFF', 'HALF_TIME', 'FULL_TIME']);

/** FNV-1a → 0~1 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** 팀 기준 기본 대형 11점 (슬롯 index 순). 폴백 4-4-2 */
function baseOf(f: FormationDef | undefined): P[] {
  if (!f) {
    const rows = [[0.5], [0.15, 0.38, 0.62, 0.85], [0.15, 0.38, 0.62, 0.85], [0.38, 0.62]];
    const us = [0.04, 0.17, 0.36, 0.55];
    return rows.flatMap((r, i) => r.map((v): P => [us[i] ?? 0.5, v]));
  }
  const cat = { GK: 0, CB: 1, FB: 1, DM: 2, CM: 3, AM: 4, W: 4, ST: 5 } as const;
  const out: P[] = f.slots.map(() => [0.5, 0.5]);
  for (const row of [...pitchRows(f)].reverse()) {
    const slots = row.map((i) => f.slots[i]);
    const key = slots.find((s) => s && s.position !== 'FB' && s.position !== 'W') ?? slots[0];
    const u = ROW_U[key ? cat[key.position] : 3] ?? 0.36;
    row.forEach((si, k) => (out[si] = [u, (k + 1) / (row.length + 1)]));
  }
  return out;
}

/** 공격 팀 기준 이벤트 템플릿 (명세 4.4) */
function cuePath(c: PitchCue, ev: string | undefined, h: (k: string) => number): P[] {
  const lv = LANE_V[c.lane];
  const j = (k: string, a: number) => (h(k) - 0.5) * 2 * a;
  if (ev === 'OFFSIDE') return [[0.7, lv], [0.85, lv]];
  if (ev === 'LONG_BALL_ADVANCE') return [[0.25, 0.5], [0.62, lv]];
  if (ev === 'COUNTER_ATTACK') return [[0.35, lv], [0.62, lv]];
  if (ev !== 'SHOT' && ev !== 'GOAL') return [[(ZONE_U[c.zone] ?? 0.5) + j('u', 0.04), lv + j('v', 0.05)]];
  const side = c.lane === 'L' ? 0.2 : 0.8;
  const tpl: Record<string, P[]> = {
    CROSS: [[0.88, c.lane === 'L' ? 0.1 : c.lane === 'R' ? 0.9 : 0.15], [0.93, 0.5 + j('a', 0.06)]],
    THROUGH: [[0.72, lv], [0.9, 0.5 + j('a', 0.08)]],
    CUTBACK: [[0.97, side], [0.88, 0.5]],
    LONG: [[0.4, 0.5], [0.85, lv]],
    SOLO: [[0.78, lv], [0.9, 0.5]],
    COUNTER: [[0.35, lv], [0.88, 0.5]],
    CORNER: [[1, h('c') < 0.5 ? 0 : 1], [0.94, 0.5]],
    FK: [[0.76, lv]],
    PK: [[0.895, 0.5]],
  };
  const start = tpl[c.chance ?? ''] ?? [[ZONE_U[c.zone] ?? 0.8, lv]];
  const end: P = ev === 'GOAL' ? [1, 0.5 + j('g', 0.03)] : c.onTarget ? [0.985, 0.5] : [1.02, 0.5 + j('m', 0.12)];
  return [...start, end];
}

/** 리플레이 전체를 한 번에 줄별 프레임으로 (O(줄 × 22)) */
function buildFrames(p: Omit<PitchViewProps, 'index' | 'beatMs' | 'fast' | 'reduced'>): Frame[] {
  const { replay: r, userSide, names } = p;
  const bases = [baseOf(p.formations.home), baseOf(p.formations.away)];
  const starters = [r.starters?.home ?? [], r.starters?.away ?? []];
  const hasCues = r.lines.some((l) => l.pitch);
  const flip = (t: Side, [u, v]: P): P => (t === userSide ? [u, v] : [1 - u, 1 - v]);
  const sideOf = (l: CommentaryLine): Side => (l.clubId === r.awayId ? 'AWAY' : 'HOME');
  const gone = Array<boolean>(22).fill(false);
  /** 줄 텍스트에서 선발 선수 이름을 찾아 점 index */
  const findDot = (l: CommentaryLine): number => {
    const t = sideOf(l) === 'HOME' ? 0 : 1;
    const k = (starters[t] ?? []).findIndex((id) => {
      const n = p.playerName(id);
      return !!n && l.text.includes(n);
    });
    return k < 0 ? -1 : t * 11 + k;
  };

  const frames: Frame[] = [];
  let ball: P = [0.5, 0.5];
  let attack: Side = 'HOME';
  let lastCue: PitchCue = { team: 'HOME', zone: 1, lane: 'C' };
  let dots: P[] = [];

  r.lines.forEach((l, li) => {
    const h = (k: string) => hash(`${r.matchId}|${li}|${k}`);
    const ev = l.event ?? (l.kind === 'GOAL' ? 'GOAL' : l.kind === 'CHANCE' ? 'SHOT' : undefined);
    const reset = l.event ? RESET.has(l.event) : l.kind === 'PERIOD';
    let cue = l.pitch;
    // 구 세이브 폴백: 구간 zoneBars 최댓값 구역 + 가운데 레인, 팀은 clubId
    if (!cue && !hasCues && l.clubId && (l.kind === 'NEUTRAL' || l.kind === 'CHANCE' || l.kind === 'GOAL')) {
      const zb = r.zoneBars[Math.min(17, Math.floor(l.minute / 5))] ?? [0, 1, 0];
      cue = { team: sideOf(l), zone: zb.indexOf(Math.max(...zb)) as 0 | 1 | 2, lane: 'C' };
    }
    const frame: Frame = { track: [], path: [], dots, gone: [...gone], ring: -1, desc: '' };
    const min = minuteText(l.minute, l.addedMinute);

    if (reset || (!cue && li === 0)) {
      ball = [0.5, 0.5];
      frame.path = [ball];
      frame.desc = `${min}, 양 팀이 기본 대형으로 서 있어요`;
      dots = bases.flatMap((b, t) => b.map((pt) => flip(t ? 'AWAY' : 'HOME', pt)));
    } else if (cue) {
      attack = cue.team;
      lastCue = cue;
      const prevMin = r.lines[li - 1]?.minute ?? 0;
      frame.track = (r.ballTrack ?? [])
        .filter(([m]) => m > prevMin && m <= l.minute)
        .map(([m, t, z, ln], k): P => flip(t ? 'AWAY' : 'HOME', [(ZONE_U[z] ?? 0.5) + (hash(`${r.matchId}|t${m}|${k}`) - 0.5) * 0.08, TRACK_V[ln] ?? 0.5]));
      const own = cuePath(cue, ev, h);
      frame.path = own.map((pt) => flip(attack, pt));
      const end = own.at(-1) ?? [0.5, 0.5];
      ball = flip(attack, end);
      // 블록 이동 (명세 4.5): 각 팀 기준 공 좌표로
      const bu = clamp(end[0], 0, 1);
      const bv = end[1];
      dots = bases.flatMap((b, t) => {
        const side: Side = t ? 'AWAY' : 'HOME';
        const att = side === attack;
        const tu = att ? bu : 1 - bu;
        const tv = att ? bv : 1 - bv;
        return b.map(([u, v], k): P => {
          const ju = (h(`u${t}${k}`) - 0.5) * 0.03;
          const jv = (h(`v${t}${k}`) - 0.5) * 0.03;
          if (u < 0.1) return flip(side, [clamp(u + ju, 0.01, 0.06), clamp(v + (tv - 0.5) * 0.15, 0.04, 0.96)]);
          const [ku, kv] = att ? [0.45, 0.25] : [0.3, 0.3];
          return flip(side, [clamp(u + (tu - 0.35) * ku + ju, 0.01, 0.97), clamp(v + (tv - 0.5) * kv + jv, 0.04, 0.96)]);
        });
      });
      frame.dots = dots;
      if (cue.playerId) {
        const t = cue.team === 'HOME' ? 0 : 1;
        const k = (starters[t] ?? []).indexOf(cue.playerId);
        if (k >= 0) frame.ring = t * 11 + k;
      }
      if (ev === 'GOAL') frame.goal = attack === userSide ? 'R' : 'L';
      frame.desc = `${min}, ${attack === 'HOME' ? names.home : names.away} 공격, ${ZONE_NAME[cue.zone]} ${LANE_NAME[cue.lane]}${ev === 'GOAL' ? ', 골이에요' : ''}`;
    } else {
      // 공이 의미 없는 줄(교체·카드·부상·조건부 지시): 공·점 그대로
      frame.path = [ball];
      frame.desc = `${min}, ${attack === 'HOME' ? names.home : names.away} 공격, ${ZONE_NAME[lastCue.zone]} ${LANE_NAME[lastCue.lane]}`;
      const red = ev === 'RED_CARD';
      if (red || ev === 'YELLOW_CARD' || (!l.event && l.kind === 'CARD')) {
        let i = findDot(l);
        if (red && (i < 0 || gone[i])) {
          // 이름으로 못 찾으면 그 팀 가장 앞 필드 선수
          const t = sideOf(l) === 'HOME' ? 0 : 1;
          let bu = 0.1;
          i = -1;
          (bases[t] ?? []).forEach(([u], k) => {
            if (u > bu && !gone[t * 11 + k]) [bu, i] = [u, t * 11 + k];
          });
        }
        if (i >= 0) frame.card = { i, red };
        if (red && i >= 0) gone[i] = true;
      }
    }
    frame.dots = dots;
    frames.push(frame);
  });
  return frames;
}

function thin<T>(a: T[], n: number): T[] {
  if (a.length <= n) return a;
  if (n <= 0) return [];
  return Array.from({ length: n }, (_, i) => a[Math.floor(((i + 0.5) * a.length) / n)] as T);
}

const W = 105;
const H = 68;
const tf = ([u, v]: P) => `translate(${(u * W).toFixed(2)} ${(v * H).toFixed(2)})`;

export default function PitchView(props: PitchViewProps) {
  const { replay, index, beatMs, fast, reduced, userSide, names, formations, playerName } = props;
  const frames = useMemo(() => buildFrames({ replay, userSide, names, formations, playerName }), [replay, userSide, names, formations, playerName]);
  const frame = frames[Math.min(index, frames.length - 1)];
  const descId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const dotEls = useRef<(SVGGElement | null)[]>([]);
  const ballEl = useRef<SVGGElement>(null);
  /** 화면에 그려진 위치: 0~21 점, 22 공 */
  const drawn = useRef<P[] | null>(null);
  const last = useRef(-1);
  const raf = useRef(0);
  const perf = useRef({ t0: 0, sum: 0, n: 0, js: 0, step: false, done: false });

  useLayoutEffect(() => {
    if (!frame) return;
    const target: P[] = [...frame.dots, frame.path.at(-1) ?? [0.5, 0.5]];
    const draw = (pts: P[]) => {
      pts.forEach((pt, i) => (i < 22 ? dotEls.current[i] : ballEl.current)?.setAttribute('transform', tf(pt)));
      drawn.current = pts;
    };
    const from = drawn.current;
    const animate = from && beatMs > 0 && !reduced && !perf.current.step && index === last.current + 1;
    last.current = index;
    if (!animate) {
      draw(target);
      return;
    }
    const T = fast ? Math.max(80, beatMs * 0.4) : beatMs * 0.6;
    const segsOwn = frame.path.length;
    const track = thin(frame.track, Math.floor(T / 120) - segsOwn);
    const ballPts: P[] = [from[22] ?? [0.5, 0.5], ...track, ...frame.path];
    // 단순 이동은 최대 600ms, 템플릿·트랙 경로는 비트 비율 그대로
    const dur = ballPts.length <= 2 ? Math.min(600, T) : T;
    const segs = ballPts.length - 1;
    const start = performance.now();
    let prev = 0;
    const tick = (now: number) => {
      const t0 = performance.now();
      const pf = perf.current;
      if (!pf.t0) pf.t0 = now;
      // 1초 넘는 간격은 탭 숨김 복귀로 보고 버림. 아주 느린 기기도 판정되게 100ms 로 자른다
      if (!pf.done && prev && now - prev < 1000) {
        pf.sum += Math.min(100, now - prev);
        pf.n++;
      }
      if (!pf.done && pf.n > 0 && now - pf.t0 >= 2000) {
        // 재생 처음 2초 평균 프레임 간격 > 24ms → 그 경기 동안 스텝 모드 (조용히). data-* 는 측정 확인용
        pf.done = true;
        const avg = pf.sum / pf.n;
        pf.step = avg > 24;
        const ds = svg.current?.dataset;
        if (ds) {
          ds.frameMs = avg.toFixed(1);
          ds.jsMs = (pf.js / pf.n).toFixed(3);
          ds.mode = pf.step ? 'step' : 'smooth';
        }
      }
      prev = now;
      const e = ease(Math.min(1, (now - start) / dur));
      const x = e * segs;
      const k = Math.min(segs - 1, Math.floor(x));
      const a = ballPts[k] ?? target[22]!;
      const b = ballPts[k + 1] ?? a;
      const f = x - k;
      const pts: P[] = target.map((tp, i) => {
        if (i === 22) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        const fp = from[i] ?? tp;
        return [fp[0] + (tp[0] - fp[0]) * e, fp[1] + (tp[1] - fp[1]) * e];
      });
      draw(pts);
      if (!pf.done) pf.js += performance.now() - t0;
      if (now - start < dur && !pf.step) raf.current = requestAnimationFrame(tick);
      else draw(target);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [frame, index, beatMs, fast, reduced]);

  if (!frame) return null;
  const usHome = userSide === 'HOME';
  return (
    <figure className="pitch">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={descId} tabIndex={0} data-mode={reduced ? 'still' : undefined}>
        <rect className="pitch-bg" width={W} height={H} />
        <g className="pitch-lines">
          <rect x={0.5} y={0.5} width={W - 1} height={H - 1} />
          <line x1={W / 2} y1={0.5} x2={W / 2} y2={H - 0.5} />
          <circle cx={W / 2} cy={H / 2} r={9.15} />
          <rect x={0.5} y={13.85} width={16.5} height={40.3} />
          <rect x={W - 17} y={13.85} width={16.5} height={40.3} />
          <rect x={0.5} y={24.85} width={5.5} height={18.3} />
          <rect x={W - 6} y={24.85} width={5.5} height={18.3} />
        </g>
        {frame.goal && !reduced && beatMs > 0 && <rect key={index} className="pitch-goal-flash" x={frame.goal === 'R' ? W - 3 : 0} y={30.34} width={3} height={7.32} />}
        {Array.from({ length: 22 }, (_, i) => {
          const us = i < 11 === usHome;
          return (
            <g key={i} ref={(el) => void (dotEls.current[i] = el)} className={us ? 'dot is-us' : 'dot is-them'} visibility={frame.gone[i] ? 'hidden' : undefined}>
              <circle r={1.7} />
              {frame.ring === i && <circle className="dot-ring" r={3} />}
              {frame.card?.i === i && (frame.card.red ? <rect className="card-red" x={2} y={-3.2} width={1.3} height={2.2} /> : <rect className="card-yellow" x={2} y={-2.8} width={1.7} height={1.7} />)}
            </g>
          );
        })}
        <g ref={ballEl} className="ball">
          <polygon points="0,-1.3 1.3,0 0,1.3 -1.3,0" />
        </g>
      </svg>
      <figcaption id={descId} className="sr-only">
        {frame.desc}
      </figcaption>
    </figure>
  );
}
