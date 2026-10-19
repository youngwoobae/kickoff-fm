/** 2.6.0: 실시간 관전 — 세그먼트(5분)마다 진행, 경기 중 전술 변경 가능 (소유: B) */
import { useEffect, useRef, useState } from 'react';
import type { DayResult, MatchEvent, Step, TacticOverride } from '../../types';
import { Card, Sheet, StepSlider } from '../components/kit';
import { INSTR_LABEL, SLIDERS, type SliderKey } from '../format';
import { useGame, useIsOwner, useService } from '../service/ServiceContext';
import { getPrefs, type ReplaySpeed } from '../prefs';

const SEGMENTS = 18;
/** 세그먼트당 대기(ms). 기본값('2')이 18세그먼트 기준 약 3~5분대가 되도록 맞췄다 */
const SEG_DELAY_MS: Record<ReplaySpeed, number> = { '1': 20_000, '2': 13_000, '4': 6_000, instant: 0 };

/** 간단 중계 문구(경량 — 전체 리플레이의 필러·2D 큐는 쓰지 않는다). 소유: B */
function genericLine(e: MatchEvent, name: (id?: string) => string): string | null {
  switch (e.type) {
    case 'KICK_OFF':
      return '경기가 시작됐어요.';
    case 'HALF_TIME':
      return '전반 종료, 하프타임이에요.';
    case 'GOAL':
      return `골! ${name(e.playerId)}!`;
    case 'SHOT':
      return e.goal ? null : e.xg >= 0.2 ? `${name(e.playerId)}의 결정적인 슈팅, 아쉽게 벗어나요` : null;
    case 'OFFSIDE':
      return '오프사이드로 끊겼어요';
    case 'RED_CARD':
      return `레드카드! ${name(e.playerId)} 퇴장`;
    case 'YELLOW_CARD':
      return `경고! ${name(e.playerId)}`;
    case 'SUBSTITUTION':
      return `교체: ${name(e.out)} OUT, ${name(e.in)} IN${e.reason === 'INJURY' ? ' (부상)' : ''}`;
    case 'INJURY':
      return `${name(e.playerId)} 부상으로 쓰러져요 (${e.days}일)`;
    case 'TRIGGER_FIRED':
      return `조건부 지시 발동: ${e.description}`;
    case 'FULL_TIME':
      return '경기 종료!';
    default:
      return null;
  }
}

export function LiveMatchScreen({ fixtureId, onDone }: { fixtureId: string; onDone: (result: DayResult) => void }) {
  const svc = useService();
  const snap = useGame();
  const isOwner = useIsOwner();
  const fixture = snap.fixtures.find((f) => f.id === fixtureId);
  const homeClub = fixture ? snap.clubs[fixture.homeId] : undefined;
  const awayClub = fixture ? snap.clubs[fixture.awayId] : undefined;
  const userIsHome = fixture?.homeId === snap.userClubId;
  const playerName = (id?: string) => (id ? (snap.players[id]?.name ?? id) : '');

  const [lines, setLines] = useState<{ minute: number; text: string }[]>([]);
  const [seg, setSeg] = useState(0);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [finished, setFinished] = useState(false);
  const [tacticsOpen, setTacticsOpen] = useState(false);
  const [baseInstr, setBaseInstr] = useState(() => homeClub?.tactics.A.instructions);
  const pendingOverride = useRef<TacticOverride | undefined>(undefined);
  const stepping = useRef(false);

  // 라이브 세션은 호출부(HomeScreen)가 beginUserMatch() 로 이미 시작해 두고 fixtureId 를 넘긴다 — 여기서는 진행만
  useEffect(() => {
    if (finished) return;
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
          setLines((xs) => [...xs, ...r.step.newEvents.map((e) => ({ minute: e.minute, text: genericLine(e, playerName) })).filter((l): l is { minute: number; text: string } => l.text !== null)]);
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
          <span className="muted">{Math.min(90, seg * 5)}분 · {seg}/{SEGMENTS}구간</span>
        </div>
      </Card>

      <div className="live-feed" aria-live="polite">
        {lines.length === 0 && <p className="muted small">곧 경기가 시작돼요…</p>}
        {lines
          .slice(-8)
          .reverse()
          .map((l, i) => (
            <p key={`${l.minute}-${i}`} className="live-line">
              <span className="muted">{l.minute}'</span> {l.text}
            </p>
          ))}
      </div>

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
