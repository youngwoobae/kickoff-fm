/** M03 텍스트 중계(즉시 재생·속도) · M05 경기 리포트 (소유: B) */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchReplay, MatchReport, TeamInstructions } from '../../types';
import { Badge, Card, Empty, Segmented, Stat } from '../components/kit';
import { INSTR_LABEL, pct, signed, stepText } from '../format';
import { useNav } from '../app/nav';
import { ProposeSheet } from '../plan/PlanActions';
import { useAction, useGame, useIsOwner, useQuery, useService } from '../service/ServiceContext';

export function MatchCenterScreen() {
  const snap = useGame();
  const { nav, go } = useNav();
  const played = useMemo(
    () =>
      snap.fixtures
        .filter((f) => f.played && f.season === snap.time.season && (f.homeId === snap.userClubId || f.awayId === snap.userClubId))
        .sort((a, b) => b.day - a.day),
    [snap],
  );
  const matchId = nav.matchId && played.some((f) => f.id === nav.matchId) ? nav.matchId : (played[0]?.id ?? null);

  if (!matchId) return <Empty>아직 치른 경기가 없어요. 홈에서 "다음 날로 넘기기"를 눌러 보세요.</Empty>;
  return (
    <div className="screen match">
      <label className="field">
        <span className="sr-only">경기 선택</span>
        <select value={matchId} onChange={(e) => go({ matchId: e.target.value })}>
          {played.map((f) => {
            const s = snap.summaries[f.id];
            const home = snap.clubs[f.homeId]?.shortName;
            const away = snap.clubs[f.awayId]?.shortName;
            return (
              <option key={f.id} value={f.id}>
                Day {f.day} · {home} {s ? `${s.home.goals}:${s.away.goals}` : 'vs'} {away}
              </option>
            );
          })}
        </select>
      </label>
      <Segmented
        label="경기 화면"
        value={nav.matchView}
        onChange={(v) => go({ matchView: v })}
        options={[
          { value: 'replay', label: '텍스트 중계' },
          { value: 'report', label: '경기 리포트' },
        ]}
      />
      {nav.matchView === 'replay' ? <ReplayView key={matchId} matchId={matchId} /> : <ReportView key={matchId} matchId={matchId} />}
    </div>
  );
}

const SPEEDS = { '1': 700, '2': 300, '4': 110 } as const;
type Speed = keyof typeof SPEEDS | 'instant';

function ReplayView({ matchId }: { matchId: string }) {
  const snap = useGame();
  const service = useService();
  const { go } = useNav();
  const q = useQuery((s) => s.getMatchReplay(matchId), [matchId]);
  const replay: MatchReplay | undefined = q.data;
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>('2');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const total = replay?.lines.length ?? 0;
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    try {
      service.logEvent('REPLAY_VIEWED', { matchId });
    } catch {
      /* noop */
    }
  }, [service, matchId]);
  useEffect(() => {
    if (reduceMotion) setSpeed('instant');
  }, [reduceMotion]);
  useEffect(() => {
    if (!replay) return;
    if (speed === 'instant') {
      setShown(total);
      return;
    }
    if (!playing || shown >= total) return;
    timer.current = setTimeout(() => setShown((n) => Math.min(total, n + 1)), SPEEDS[speed]);
    return () => clearTimeout(timer.current);
  }, [replay, playing, shown, total, speed]);

  if (q.error) return <Empty>{q.error.message}</Empty>;
  if (!replay) return null;
  const visible = replay.lines.slice(0, Math.max(1, shown));
  const cur = visible[visible.length - 1];
  const minute = cur?.minute ?? 0;
  const seg = Math.min(17, Math.floor(minute / 5));
  const zone = replay.zoneBars[seg] ?? [0.33, 0.34, 0.33];
  const home = snap.clubs[replay.homeId];
  const away = snap.clubs[replay.awayId];
  const lastTactic = [...visible].reverse().find((l) => l.kind === 'TACTIC');
  const done = shown >= total;

  return (
    <>
      <Card className="scoreboard">
        <div className="sb-row">
          <span className="sb-team">{home?.shortName}</span>
          <span className="sb-score" aria-live="polite">
            {cur?.score[0] ?? 0} : {cur?.score[1] ?? 0}
          </span>
          <span className="sb-team">{away?.shortName}</span>
        </div>
        <div className="sb-min">{done ? '경기 종료' : `${minute}′`}</div>
        <div className="zone-bar" aria-label={`구역 점유 Z0 ${pct(zone[0])}, Z1 ${pct(zone[1])}, Z2 ${pct(zone[2])}`}>
          <span style={{ flex: zone[0] }}>Z0 수비</span>
          <span style={{ flex: zone[1] }}>Z1 중원</span>
          <span style={{ flex: zone[2] }}>Z2 공격</span>
        </div>
        <div className="momentum" aria-label="모멘텀 (위: 홈 우세, 아래: 원정 우세)">
          {replay.momentum.map((m, i) => (
            <span key={i} className={`mo ${i > seg && !done ? 'is-future' : ''}`}>
              <span className="mo-up" style={{ height: `${Math.max(0, m) * 50}%` }} />
              <span className="mo-down" style={{ height: `${Math.max(0, -m) * 50}%` }} />
            </span>
          ))}
        </div>
      </Card>
      {lastTactic && (
        <div className="tactic-banner" role="status">
          📋 {lastTactic.minute}′ {lastTactic.text}
        </div>
      )}
      <div className="replay-controls">
        <button type="button" className="btn btn-secondary" onClick={() => setPlaying((p) => !p)} disabled={done || speed === 'instant'}>
          {playing ? '⏸ 일시정지' : '▶ 재생'}
        </button>
        <Segmented
          label="재생 속도"
          size="sm"
          value={speed}
          onChange={setSpeed}
          options={[
            { value: '1', label: '1×' },
            { value: '2', label: '2×' },
            { value: '4', label: '4×' },
            { value: 'instant', label: '즉시' },
          ]}
        />
        <button type="button" className="btn btn-ghost" onClick={() => setShown(total)}>
          ⏩ 결과로
        </button>
      </div>
      <ol className="feed" aria-label="텍스트 중계">
        {[...visible].reverse().map((l, i) => (
          <li key={`${l.minute}-${i}`} className={`feed-line kind-${l.kind.toLowerCase()}`}>
            <span className="feed-min">{l.minute}′</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ol>
      {done && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => go({ matchView: 'report' })}>
          경기 리포트 보기
        </button>
      )}
    </>
  );
}

function ReportView({ matchId }: { matchId: string }) {
  const snap = useGame();
  const service = useService();
  const isOwner = useIsOwner();
  const run = useAction();
  const q = useQuery((s) => s.getReport(matchId), [matchId]);
  const r: MatchReport | undefined = q.data;
  const [propose, setPropose] = useState<Partial<TeamInstructions> | null>(null);
  const nextSlot = useQuery((s) => s.getPlanState()).data?.confirmed?.plan.startSlot ?? 'A';
  const rules = useRuleLabels();

  useEffect(() => {
    try {
      service.logEvent('REPORT_VIEWED', { matchId });
    } catch {
      /* noop */
    }
  }, [service, matchId]);

  if (q.error) return <Empty>{q.error.message}</Empty>;
  if (!r) return null;
  const opp = snap.clubs[r.opponentId];
  const s = r.summary;
  const res = s.goalsFor > s.goalsAgainst ? '승' : s.goalsFor === s.goalsAgainst ? '무' : '패';
  const bars: [string, number][] = [
    ['전력', r.factorBars.strength],
    ['준비', r.factorBars.prep],
    ['전술', r.factorBars.tactics],
    ['운', r.factorBars.luck],
  ];
  const maxBar = Math.max(0.5, ...bars.map(([, v]) => Math.abs(v)));

  const applySuggestion = (patch: Partial<TeamInstructions>) => {
    const club = snap.clubs[snap.userClubId];
    if (!club) return;
    const slot = club.tactics[nextSlot];
    const { familiarity: _f, key: _k, ...rest } = slot;
    void _f;
    void _k;
    run((sv) => sv.updateTacticSlot(nextSlot, { ...rest, instructions: { ...slot.instructions, ...patch } }), `슬롯 ${nextSlot} 팀 지시에 반영했어요`);
  };

  return (
    <>
      <Card>
        <div className="result-hero">
          <span className="score">
            {s.goalsFor} : {s.goalsAgainst}
          </span>
          <Badge tone={res === '승' ? 'good' : res === '패' ? 'bad' : 'neutral'}>{res}</Badge>
          <span>
            {s.isHome ? '홈' : '원정'} vs {opp?.name}
          </span>
        </div>
        <div className="stat-grid">
          <Stat label="xG" value={`${s.xgFor.toFixed(2)} : ${s.xgAgainst.toFixed(2)}`} />
          <Stat label="점유" value={pct(s.possession)} />
          <Stat label="슈팅" value={`${s.shotsFor} : ${s.shotsAgainst}`} />
          <Stat label="시즌 승점" value={`${r.seasonPoints.actual}`} sub={`기대 ${r.seasonPoints.expected.toFixed(1)}`} />
        </div>
        <p className={`luck luck-${r.luck.level.toLowerCase()}`}>
          {r.luck.level === 'LUCKY' ? '🍀' : r.luck.level === 'UNLUCKY' ? '☔' : '⚖'} {r.luck.text} ({signed(r.luck.delta)})
        </p>
      </Card>

      <Card title="승부 요인 Top 3">
        {r.keyFactors.length === 0 ? (
          <Empty>뚜렷한 전술 요인이 없었어요</Empty>
        ) : (
          <ul className="factor-list">
            {r.keyFactors.map((k) => (
              <li key={k.ruleId} className={`factor factor-${k.beneficiary === 'US' ? 'us' : 'them'}`}>
                <div className="row-between">
                  <strong>
                    {k.beneficiary === 'US' ? '▲ 우리 유리' : '▼ 상대 유리'} · {rules[k.ruleId] ?? k.ruleId}
                  </strong>
                  <span className={k.xg >= 0 ? 'pos' : 'neg'}>{signed(k.xg)} xG</span>
                </div>
                <div>{k.text}</div>
                <div className="small muted">
                  {k.count}회 (리그 평균 {k.leagueAvgCount.toFixed(1)})
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="요소별 영향 (xG 환산)">
        <ul className="bars">
          {bars.map(([label, v]) => (
            <li key={label} className="bar-row">
              <span className="bar-label">{label}</span>
              <span className="bar-track" aria-label={`${label} ${signed(v)}`}>
                <span className="bar-mid" />
                <span className={`bar-fill ${v >= 0 ? 'is-pos' : 'is-neg'}`} style={{ width: `${(Math.abs(v) / maxBar) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
              </span>
              <span className={`bar-val ${v >= 0 ? 'pos' : 'neg'}`}>{signed(v)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="구역 흐름 (통과율)">
        <ul className="list compact">
          {r.zoneFlow.map((z) => (
            <li key={z.zone} className="list-row">
              <span>{z.label}</span>
              <span>
                <strong>{pct(z.passRate)}</strong> <span className="small muted">리그 {pct(z.leagueAvg)}</span>{' '}
                <span className={z.passRate >= z.leagueAvg ? 'pos' : 'neg'}>{z.passRate >= z.leagueAvg ? '▲' : '▼'}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="타임라인">
        {r.timeline.length === 0 ? (
          <Empty>기록된 장면이 없어요</Empty>
        ) : (
          <ol className="timeline">
            {r.timeline.map((t, i) => (
              <li key={i} className={`tl tl-${t.kind.toLowerCase()} ${t.clubId === snap.userClubId ? 'is-us' : 'is-them'}`}>
                <span className="feed-min">{t.minute}′</span>
                <span>{TL_ICON[t.kind]} {t.text}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {r.suggestions.length > 0 && (
        <Card title="다음 경기 제안">
          <ul className="list">
            {r.suggestions.map((sg, i) => (
              <li key={i} className="suggestion">
                <div>
                  <Badge tone="accent">{rules[sg.ruleId] ?? sg.ruleId}</Badge> {sg.text}
                </div>
                {sg.instructionPatch && (
                  <div className="row-between small">
                    <span className="muted">
                      {Object.entries(sg.instructionPatch)
                        .map(([k, v]) => `${INSTR_LABEL[k as keyof TeamInstructions]} → ${typeof v === 'boolean' ? (v ? '켬' : '끔') : stepText(v as number)}`)
                        .join(', ')}
                    </span>
                    {isOwner ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => sg.instructionPatch && applySuggestion(sg.instructionPatch)}>
                        슬롯 {nextSlot}에 적용
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPropose(sg.instructionPatch ?? null)}>
                        제안하기
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {propose && <ProposeSheet open onClose={() => setPropose(null)} patch={{ instructions: { slot: nextSlot, patch: propose } }} title="리포트 제안을 구단주에게" />}
    </>
  );
}

const TL_ICON: Record<string, string> = { GOAL: '⚽', TRIGGER: '📋', SUB: '🔁', CONDITION: '🥵', INJURY: '🩹', RED_CARD: '🟥' };

function useRuleLabels(): Record<string, string> {
  const catalog = useQuery((s) => s.getCatalog()).data;
  return useMemo(() => Object.fromEntries((catalog?.rules ?? []).map((r) => [r.id, r.label])), [catalog]);
}
