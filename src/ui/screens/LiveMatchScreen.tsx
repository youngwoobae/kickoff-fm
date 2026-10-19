/** 2.6.0: 실시간 관전 — 세그먼트(5분)마다 진행, 경기 중 전술 변경 가능, 미니 피치 시각화 (소유: B) */
import { useEffect, useRef, useState } from 'react';
import type { ClubId, CommentaryKind, DayResult, FormationDef, MatchEvent, Step, TacticOverride } from '../../types';
import { Card, Sheet, StepSlider } from '../components/kit';
import { INSTR_LABEL, SLIDERS, pitchRows, type SliderKey } from '../format';
import { useGame, useIsOwner, useQuery, useService } from '../service/ServiceContext';
import { getPrefs, type ReplaySpeed } from '../prefs';

const SEGMENTS = 18;
/** 세그먼트당 대기(ms). 기본값('2')이 18세그먼트 기준 약 3~5분대가 되도록 맞췄다 */
const SEG_DELAY_MS: Record<ReplaySpeed, number> = { '1': 20_000, '2': 13_000, '4': 6_000, instant: 0 };

interface Line {
  minute: number;
  kind: CommentaryKind;
  text: string;
}

/** 간단 중계 문구(경량 — 전체 리플레이의 필러·2D 큐는 쓰지 않는다). 소유: B */
function lineOf(e: MatchEvent, name: (id?: string) => string): Line | null {
  const L = (kind: CommentaryKind, text: string): Line => ({ minute: e.minute, kind, text });
  switch (e.type) {
    case 'KICK_OFF':
      return L('PERIOD', '경기가 시작됐어요.');
    case 'HALF_TIME':
      return L('PERIOD', '전반 종료, 하프타임이에요.');
    case 'GOAL':
      return L('GOAL', `골! ${name(e.playerId)}!`);
    case 'SHOT':
      return e.goal ? null : e.xg >= 0.2 ? L('CHANCE', `${name(e.playerId)}의 결정적인 슈팅, 아쉽게 벗어나요`) : null;
    case 'OFFSIDE':
      return L('TACTIC', '오프사이드로 끊겼어요');
    case 'RED_CARD':
      return L('CARD', `레드카드! ${name(e.playerId)} 퇴장`);
    case 'YELLOW_CARD':
      return L('CARD', `경고! ${name(e.playerId)}`);
    case 'SUBSTITUTION':
      return L('SUB', `교체: ${name(e.out)} OUT, ${name(e.in)} IN${e.reason === 'INJURY' ? ' (부상)' : ''}`);
    case 'INJURY':
      return L('CARD', `${name(e.playerId)} 부상으로 쓰러져요 (${e.days}일)`);
    case 'TRIGGER_FIRED':
      return L('TACTIC', `조건부 지시 발동: ${e.description}`);
    case 'FULL_TIME':
      return L('PERIOD', '경기 종료!');
    default:
      return null;
  }
}

// ── 미니 피치: 공 위치를 이벤트 유형으로 대략 추정해 보여준다(결정 로그 없이, 가벼운 근사) ──
const W = 105;
const H = 68;
const ZONE_U = [0.17, 0.5, 0.83];
const LANE_V = [0.22, 0.5, 0.78];
type BallPos = { u: number; v: number; team: 'home' | 'away' | null };

function posOf(e: MatchEvent, homeId: ClubId): BallPos | null {
  const team = (cid: ClubId): 'home' | 'away' => (cid === homeId ? 'home' : 'away');
  const lane = LANE_V[(e.minute * 7) % 3]!;
  switch (e.type) {
    case 'KICK_OFF':
    case 'HALF_TIME':
    case 'FULL_TIME':
      return { u: ZONE_U[1]!, v: LANE_V[1]!, team: null };
    case 'GOAL':
    case 'SHOT':
    case 'OFFSIDE':
      return { u: ZONE_U[2]!, v: lane, team: team(e.clubId) };
    case 'COUNTER_ATTACK':
    case 'LONG_BALL_ADVANCE':
      return { u: ZONE_U[1]!, v: lane, team: team(e.clubId) };
    default:
      return null;
  }
}

/** 포메이션 슬롯 11개의 기본 배치(u=자기 골문에서 거리, v=측면). PitchView.tsx 의 baseOf 와 같은 계산이지만
 * 그 파일은 별도 lazy 청크라 가져오지 않고, 이미 공개된 pitchRows() 만으로 가볍게 다시 만든다. */
const ROW_U = [0.04, 0.17, 0.27, 0.36, 0.45, 0.55];
const POS_CAT = { GK: 0, CB: 1, FB: 1, DM: 2, CM: 3, AM: 4, W: 4, ST: 5 } as const;
function formationDots(f: FormationDef | undefined): [number, number][] {
  if (!f) return [];
  const out: [number, number][] = f.slots.map(() => [0.5, 0.5]);
  for (const row of [...pitchRows(f)].reverse()) {
    const slots = row.map((i) => f.slots[i]);
    const key = slots.find((s) => s && s.position !== 'FB' && s.position !== 'W') ?? slots[0];
    const u = ROW_U[key ? POS_CAT[key.position] : 3] ?? 0.36;
    row.forEach((si, k) => (out[si] = [u, (k + 1) / (row.length + 1)]));
  }
  return out;
}

function LivePitch({
  pos,
  homeLabel,
  awayLabel,
  goalFlash,
  userIsHome,
  homeFormation,
  awayFormation,
}: {
  pos: BallPos | null;
  homeLabel: string;
  awayLabel: string;
  goalFlash: 'L' | 'R' | null;
  userIsHome: boolean;
  homeFormation?: FormationDef;
  awayFormation?: FormationDef;
}) {
  const p = pos ?? { u: 0.5, v: 0.5, team: null };
  // 사용자 팀은 항상 오른쪽으로 공격하는 방향으로 그린다(team=null 은 좌우 상관없이 중앙)
  const flip = (team: 'home' | 'away', u: number, v: number): [number, number] => {
    const mine = team === (userIsHome ? 'home' : 'away');
    return mine ? [u * W, v * H] : [(1 - u) * W, (1 - v) * H];
  };
  const [bx, by] = p.team ? flip(p.team, p.u, p.v) : [p.u * W, p.v * H];
  return (
    <figure className="live-pitch">
      <span className="live-end live-end-home">{homeLabel}</span>
      <span className="live-end live-end-away">{awayLabel}</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="미니 피치 — 선수 배치·공 대략 위치">
        <rect className="pitch-bg" width={W} height={H} />
        <g className="pitch-lines">
          <rect x={0.5} y={0.5} width={W - 1} height={H - 1} />
          <line x1={W / 2} y1={0.5} x2={W / 2} y2={H - 0.5} />
          <circle cx={W / 2} cy={H / 2} r={9.15} />
          <rect x={0.5} y={13.85} width={16.5} height={40.3} />
          <rect x={W - 17} y={13.85} width={16.5} height={40.3} />
        </g>
        {goalFlash && <rect className="pitch-goal-flash" x={goalFlash === 'R' ? W - 3 : 0} y={30.34} width={3} height={7.32} />}
        {formationDots(homeFormation).map(([u, v], i) => {
          const [x, y] = flip('home', u, v);
          return (
            <g key={`h${i}`} className={userIsHome ? 'dot is-us' : 'dot is-them'} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle r={1.7} />
            </g>
          );
        })}
        {formationDots(awayFormation).map(([u, v], i) => {
          const [x, y] = flip('away', u, v);
          return (
            <g key={`a${i}`} className={!userIsHome ? 'dot is-us' : 'dot is-them'} style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle r={1.7} />
            </g>
          );
        })}
        <g className="ball" style={{ transform: `translate(${bx}px, ${by}px)` }}>
          <polygon points="0,-1.6 1.6,0 0,1.6 -1.6,0" />
        </g>
      </svg>
    </figure>
  );
}

export function LiveMatchScreen({ fixtureId, onDone }: { fixtureId: string; onDone: (result: DayResult) => void }) {
  const svc = useService();
  const snap = useGame();
  const isOwner = useIsOwner();
  const catalog = useQuery((s) => s.getCatalog()).data;
  const fixture = snap.fixtures.find((f) => f.id === fixtureId);
  const homeClub = fixture ? snap.clubs[fixture.homeId] : undefined;
  const awayClub = fixture ? snap.clubs[fixture.awayId] : undefined;
  const userIsHome = fixture?.homeId === snap.userClubId;
  const playerName = (id?: string) => (id ? (snap.players[id]?.name ?? id) : '');
  const homeFormation = catalog?.formations.find((f) => f.id === homeClub?.tactics.A.formation);
  const awayFormation = catalog?.formations.find((f) => f.id === awayClub?.tactics.A.formation);

  const [lines, setLines] = useState<Line[]>([]);
  const [seg, setSeg] = useState(0);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [ballPos, setBallPos] = useState<BallPos | null>(null);
  const [goalFlash, setGoalFlash] = useState<'L' | 'R' | null>(null);
  const [finished, setFinished] = useState(false);
  const [tacticsOpen, setTacticsOpen] = useState(false);
  const [baseInstr, setBaseInstr] = useState(() => homeClub?.tactics.A.instructions);
  const pendingOverride = useRef<TacticOverride | undefined>(undefined);
  const stepping = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  // 라이브 세션은 호출부(HomeScreen)가 beginUserMatch() 로 이미 시작해 두고 fixtureId 를 넘긴다 — 여기서는 진행만
  useEffect(() => {
    if (finished || !fixture) return;
    const speed = getPrefs().replaySpeed;
    const delay = SEG_DELAY_MS[speed];
    const timer = setTimeout(
      () => {
        if (stepping.current) return;
        stepping.current = true;
        const r = svc.stepUserMatch(pendingOverride.current);
        pendingOverride.current = undefined;
        stepping.current = false;
        if (!r.done) {
          const newLines = r.step.newEvents.map((e) => lineOf(e, playerName)).filter((l): l is Line => l !== null);
          if (newLines.length) setLines((xs) => [...xs, ...newLines]);
          for (const e of r.step.newEvents) {
            const pos = posOf(e, fixture.homeId);
            if (pos) setBallPos(pos);
            if (e.type === 'GOAL') {
              const scorerIsUser = (e.clubId === fixture.homeId) === userIsHome;
              setGoalFlash(scorerIsUser ? 'R' : 'L');
              clearTimeout(flashTimer.current);
              flashTimer.current = setTimeout(() => setGoalFlash(null), 600);
            }
          }
          setScore([r.step.homeGoals, r.step.awayGoals]);
          setSeg(r.step.seg + 1);
        } else {
          setFinished(true);
          onDone(r.result);
        }
      },
      delay > 0 ? delay : 10,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, finished]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const skip = () => {
    if (finished) return;
    setFinished(true);
    const r = svc.skipUserMatch();
    onDone(r);
  };

  if (!fixture || !homeClub || !awayClub) return null;
  const myScore = userIsHome ? score[0] : score[1];
  const oppScore = userIsHome ? score[1] : score[0];

  return (
    <div className="screen live-match">
      <Card className="card-compact live-score">
        <div className="row-between">
          <strong>
            {homeClub.shortName} {score[0]} : {score[1]} {awayClub.shortName}
          </strong>
          <span className="muted">
            {Math.min(90, seg * 5)}분 · {seg}/{SEGMENTS}구간
          </span>
        </div>
      </Card>

      <LivePitch
        pos={ballPos}
        homeLabel={homeClub.shortName}
        awayLabel={awayClub.shortName}
        goalFlash={goalFlash}
        userIsHome={userIsHome}
        homeFormation={homeFormation}
        awayFormation={awayFormation}
      />

      <ol className="feed" aria-label="실시간 중계" aria-live="polite">
        {lines.length === 0 && (
          <li className="feed-line">
            <span className="muted small">곧 경기가 시작돼요…</span>
          </li>
        )}
        {lines
          .slice(-8)
          .reverse()
          .map((l, i) => (
            <li key={`${l.minute}-${i}`} className={`feed-line kind-${l.kind.toLowerCase()}`}>
              <span className="feed-min">{l.minute}'</span>
              <span>{l.text}</span>
            </li>
          ))}
      </ol>

      <div className="row-between live-actions">
        <button type="button" className="btn btn-secondary" disabled={!isOwner} title={isOwner ? undefined : '구단주만 바꿀 수 있어요'} onClick={() => setTacticsOpen(true)}>
          전술 변경
        </button>
        <button type="button" className="btn btn-secondary" onClick={skip}>
          건너뛰기
        </button>
      </div>
      <p className="small muted">
        내 팀: {myScore} : {oppScore} 상대 · 전술 변경은 다음 구간부터 반영돼요
      </p>

      {tacticsOpen && baseInstr && (
        <TacticsSheet
          base={baseInstr}
          onClose={() => setTacticsOpen(false)}
          onApply={(patch) => {
            pendingOverride.current = { side: userIsHome ? 'home' : 'away', instructions: patch };
            setBaseInstr((b) => (b ? { ...b, ...patch } : b));
            setTacticsOpen(false);
          }}
        />
      )}
    </div>
  );
}

function TacticsSheet({ base, onClose, onApply }: { base: Record<SliderKey, Step>; onClose: () => void; onApply: (patch: Partial<Record<SliderKey, Step>>) => void }) {
  const [vals, setVals] = useState<Partial<Record<SliderKey, Step>>>({});
  const patch = Object.fromEntries(Object.entries(vals).filter(([k, v]) => base[k as SliderKey] !== v));
  const count = Object.keys(patch).length;
  return (
    <Sheet
      open
      title="경기 중 전술 변경"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={count === 0} onClick={() => onApply(patch)}>
          변경 {count}건 적용 (다음 구간부터)
        </button>
      }
    >
      {SLIDERS.map((s) => (
        <StepSlider
          key={s.key}
          label={INSTR_LABEL[s.key] ?? s.label}
          low={s.low}
          high={s.high}
          value={vals[s.key] ?? base[s.key]}
          changed={(vals[s.key] ?? base[s.key]) !== base[s.key]}
          onChange={(v) => setVals((x) => ({ ...x, [s.key]: v }))}
        />
      ))}
    </Sheet>
  );
}
