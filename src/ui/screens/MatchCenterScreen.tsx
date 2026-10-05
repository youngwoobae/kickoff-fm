/** M03 텍스트 중계(즉시 재생·속도) · M05 경기 리포트 (소유: B) */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommentaryLine, MatchReplay, MatchReport, TeamInstructions } from '../../types';
import { Badge, Card, Empty, Segmented, Stat } from '../components/kit';
import { INSTR_LABEL, minuteText, pct, signed, stepText } from '../format';
import { useNav } from '../app/nav';
import { ProposeSheet } from '../plan/PlanActions';
import { getPrefs, setPrefs, usePrefs, useReducedMotion } from '../prefs';
import { useAction, useGame, useIsOwner, useQuery, useService } from '../service/ServiceContext';

/**
 * 계약 1.2 의 MatchReport·CommentaryLine 에는 새 통계(유효슈팅·코너·경고·시간 점유)와 addedMinute 가 없다.
 * 서비스가 이 선택 필드를 채우면 표시하고, 없으면 "–" 로 둔다.
 */
type SummaryExt = MatchReport['summary'] & {
  shotsOnTargetFor?: number;
  shotsOnTargetAgainst?: number;
  cornersFor?: number;
  cornersAgainst?: number;
  yellowCardsFor?: number;
  yellowCardsAgainst?: number;
  possessionTime?: number;
};
type Added = { addedMinute?: number };
const minOf = (l: { minute: number } & Added) => minuteText(l.minute, l.addedMinute);
/** 2.4.0 event 우선, 없으면(구 세이브) 문구 폴백 */
const isYellow = (l: CommentaryLine) => (l.event ? l.event === 'YELLOW_CARD' : l.kind === 'CARD' && l.text.startsWith('경고'));
const pair = (a?: number, b?: number) => (a === undefined || b === undefined ? '–' : `${a} : ${b}`);

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

  if (!matchId) return <Empty>아직 치른 경기가 없어요. 홈에서 ‘다음 날로 넘기기’를 눌러 보세요.</Empty>;
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
                Day {f.day} · {home} {s ? `${s.home.goals} : ${s.away.goals}` : 'vs'} {away}
              </option>
            );
          })}
        </select>
      </label>
      <Segmented
        label="경기 화면"
        panelId="match-panel"
        value={nav.matchView}
        onChange={(v) => go({ matchView: v })}
        options={[
          { value: 'replay', label: '중계' },
          { value: 'report', label: '경기 리포트' },
        ]}
      />
      <div role="tabpanel" id="match-panel" aria-labelledby={`match-panel-tab-${nav.matchView}`} className="screen">
        {nav.matchView === 'replay' ? <ReplayView key={matchId} matchId={matchId} /> : <ReportView key={matchId} matchId={matchId} />}
      </div>
    </div>
  );
}

const SPEEDS = { '1': 700, '2': 300, '4': 110 } as const;
type Speed = keyof typeof SPEEDS | 'instant';
/** 줄 간격 = 속도 기본값 × 가중치 (온보딩_UX 4.4·4.7). 텍스트와 2D 가 같은 시계를 쓴다 */
const WEIGHT: Record<string, number> = { GOAL: 3, SHOT: 1.5, CHANCE: 1.5, KICK_OFF: 1.5, HALF_TIME: 1.5, FULL_TIME: 1.5, PERIOD: 1.5 };
const beatWeight = (l?: CommentaryLine) => (l ? (WEIGHT[l.event ?? l.kind] ?? 1) : 1);
const PitchView = lazy(() => import('../match/PitchView'));

function ReplayView({ matchId }: { matchId: string }) {
  const snap = useGame();
  const service = useService();
  const { go } = useNav();
  const q = useQuery((s) => s.getMatchReplay(matchId), [matchId]);
  const replay: MatchReplay | undefined = q.data;
  const [shown, setShown] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(() => getPrefs().replaySpeed);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const total = replay?.lines.length ?? 0;
  const reduceMotion = useReducedMotion();
  const { pitch2d } = usePrefs();
  const catalog = useQuery((s) => s.getCatalog()).data;
  const formations = useMemo(
    () => ({
      home: replay?.formations && catalog?.formations.find((f) => f.id === replay.formations?.home),
      away: replay?.formations && catalog?.formations.find((f) => f.id === replay.formations?.away),
    }),
    [replay, catalog],
  );
  const names = useMemo(() => ({ home: snap.clubs[replay?.homeId ?? '']?.shortName ?? '홈', away: snap.clubs[replay?.awayId ?? '']?.shortName ?? '원정' }), [snap.clubs, replay]);
  const players = snap.players;
  const playerName = useCallback((id: string) => players[id]?.name, [players]);

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
    timer.current = setTimeout(() => setShown((n) => Math.min(total, n + 1)), SPEEDS[speed] * beatWeight(replay.lines[Math.max(1, shown) - 1]));
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
        <div className="sb-min">{done ? '경기 종료' : cur ? minOf(cur) : '0′'}</div>
        <div className="zone-bar" role="img" aria-label={`홈 팀 공격 구역 분포: 수비 진영 ${pct(zone[0])}, 중원 ${pct(zone[1])}, 공격 진영 ${pct(zone[2])}`}>
          <span style={{ flex: zone[0] }}>수비 진영</span>
          <span style={{ flex: zone[1] }}>중원</span>
          <span style={{ flex: zone[2] }}>공격 진영</span>
        </div>
        <div className="momentum" role="img" aria-label="모멘텀 (위: 홈 우세, 아래: 원정 우세)">
          {replay.momentum.map((m, i) => (
            <span key={i} className={`mo ${i > seg && !done ? 'is-future' : ''}`}>
              <span className="mo-up" style={{ height: `${Math.max(0, m) * 50}%` }} />
              <span className="mo-down" style={{ height: `${Math.max(0, -m) * 50}%` }} />
            </span>
          ))}
        </div>
      </Card>
      {pitch2d && (
        <Suspense fallback={<div className="pitch" />}>
          <PitchView
            replay={replay}
            index={visible.length - 1}
            beatMs={speed === 'instant' || !playing ? 0 : SPEEDS[speed] * beatWeight(cur)}
            fast={speed === '4'}
            reduced={reduceMotion}
            userSide={replay.awayId === snap.userClubId ? 'AWAY' : 'HOME'}
            names={names}
            formations={formations}
            playerName={playerName}
          />
        </Suspense>
      )}
      {lastTactic && (
        <div className="tactic-banner" role="status">
          📋 {minOf(lastTactic)} {lastTactic.text}
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
          onChange={(v) => {
            // '즉시'(모션 줄이기 기본값)에서 배속을 고르면 처음부터 다시 재생
            if (speed === 'instant' && v !== 'instant') {
              setShown(1);
              setPlaying(true);
            }
            setSpeed(v);
          }}
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
        <label className="pitch-switch">
          <input type="checkbox" role="switch" checked={pitch2d} onChange={(e) => setPrefs({ pitch2d: e.target.checked })} />
          2D
        </label>
      </div>
      <ol className="feed" aria-label="텍스트 중계">
        {[...visible].reverse().map((l, i) => (
          <li key={`${l.minute}-${i}`} className={`feed-line kind-${l.kind.toLowerCase()}`}>
            <span className="feed-min">{minOf(l)}</span>
            <span>
              {isYellow(l) ? '🟨 ' : ''}
              {l.text}
            </span>
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
  const ruleWhy = useQuery((s) => Object.fromEntries(s.getCatalog().rules.map((x) => [x.id, x.why]))).data ?? {};
  // 경고 수 폴백: 계약에 통계가 없으면 중계의 경고 줄을 센다
  const replay = useQuery((s) => s.getMatchReplay(matchId), [matchId]).data;

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
  const s: SummaryExt = r.summary;
  const yellows = (clubId: string) => replay?.lines.filter((l) => isYellow(l) && l.clubId === clubId).length;
  const yFor = s.yellowCardsFor ?? yellows(r.clubId);
  const yAgainst = s.yellowCardsAgainst ?? yellows(r.opponentId);
  const res = s.goalsFor > s.goalsAgainst ? '승' : s.goalsFor === s.goalsAgainst ? '무' : '패';
  const bars: [string, number][] = [
    ['전력', r.factorBars.strength],
    ['준비', r.factorBars.prep],
    ...(r.factorBars.state !== undefined ? ([['경기 흐름', r.factorBars.state]] as [string, number][]) : []),
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
          <Stat label="점유" value={pct(s.possessionTime ?? s.possession)} sub={s.possessionTime !== undefined ? '시간 기준' : undefined} />
          <Stat label="슈팅" value={`${s.shotsFor} : ${s.shotsAgainst}`} />
          <Stat label="유효슈팅" value={pair(s.shotsOnTargetFor, s.shotsOnTargetAgainst)} />
          <Stat label="코너" value={pair(s.cornersFor, s.cornersAgainst)} />
          <Stat label="🟨 경고" value={pair(yFor, yAgainst)} />
          <Stat label="시즌 승점" value={`${r.seasonPoints.actual}`} sub={`기대 ${r.seasonPoints.expected.toFixed(1)}`} />
        </div>
        <p className={`luck luck-${r.luck.level.toLowerCase()}`}>
          {r.luck.level === 'LUCKY' ? '🍀' : r.luck.level === 'UNLUCKY' ? '☔' : '⚖'} {r.luck.text} ({signed(r.luck.delta)})
        </p>
      </Card>

      <Card tour="report.keyFactors" title="승부 요인 3가지">
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
                {ruleWhy[k.ruleId] && <div className="small">왜? {ruleWhy[k.ruleId]}</div>}
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
              <span className="bar-track" aria-hidden="true">
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
                <span className="feed-min">{minOf(t)}</span>
                <span>
                  {TL_ICON[t.kind] ?? ''} {t.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {r.suggestions.length > 0 && (
        <Card tour="report.suggestions" title="다음 경기 제안">
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

const TL_ICON: Record<string, string> = { GOAL: '⚽', TRIGGER: '📋', SUB: '🔁', CONDITION: '🥵', INJURY: '🩹', RED_CARD: '🟥', YELLOW_CARD: '🟨' };

function useRuleLabels(): Record<string, string> {
  const catalog = useQuery((s) => s.getCatalog()).data;
  return useMemo(() => Object.fromEntries((catalog?.rules ?? []).map((r) => [r.id, r.label])), [catalog]);
}
