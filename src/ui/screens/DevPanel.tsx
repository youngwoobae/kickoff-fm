/** 개발자 패널: 새 게임, 가속 진행, 세이브 내보내기/가져오기, 로그, 전술 상한, 캘리브레이션, 재시뮬 (소유: B) */
import { useState } from 'react';
import type { CalibrationProgress, CalibrationReport, MatchReport, RuleId, ScenarioId, TacticCap } from '../../types';
import { Badge, Card, Empty, Meter, Segmented, Toggle } from '../components/kit';
import { downloadText, signed } from '../format';
import { useNav } from '../app/nav';
import { useAction, useGame, useQuery, useServiceCtx } from '../service/ServiceContext';
import { reloadInFakeMode, reloadInRealMode } from '../service/serviceHost';
import { lastUserFixture } from './HomeScreen';

const SCENARIOS: ScenarioId[] = [
  'BASELINE', 'COUNTER_SPREAD', 'OVR_DIFF_10', 'OVR_DIFF_10_COUNTER', 'OVR_DIFF_25', 'TEMPO_VARIANCE', 'RULE_ISOLATION',
  'REAL_HOME', 'LEAGUE_REALISM', 'STYLE_MATRIX', 'FORMATION_PARITY', 'STYLE_FIT', 'ROLE_SIGNATURE', 'STAMINA_CURVE',
];
const RULE_IDS: RuleId[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R9', 'R10', 'R11', 'R12', 'R13', 'TEMPO', 'LINE_FIT'];
const CAPS: TacticCap[] = [0.25, 0.35, 0.5, 0.6, 0.7];
/** 계약 밖: 리포트에 9×9 셀이 실려 오면 행렬로 그린다 (1.2 CalibrationReport 에는 없음) */
type MatrixCell = { us: string; them: string; winPct: number; lossPct: number };

export function DevPanel() {
  const snap = useGame();
  const run = useAction();
  const { service, mode, reportFatal } = useServiceCtx();
  const { go } = useNav();
  const [days, setDays] = useState('7');
  const [seed, setSeed] = useState('');
  const [importText, setImportText] = useState('');

  const advanceN = () => {
    const n = Math.max(1, Math.min(60, Number(days) || 1));
    run((s) => s.advanceDays(n), (r) => `${r.length}일 진행했어요`);
  };

  return (
    <div className="screen dev">
      <Card title="서비스" extra={<Badge tone={mode === 'fake' ? 'warn' : 'good'}>{mode === 'fake' ? 'FAKE' : 'REAL'}</Badge>}>
        <p className="small muted">
          계약 {service.contractVersion} · 엔진 {snap.engineVersion} · 시드 {snap.gameSeed}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={mode === 'fake' ? reloadInRealMode : reloadInFakeMode}>
          {mode === 'fake' ? '실제 서비스로 전환 (?fake 제거)' : 'fake 모드로 전환 (?fake=1)'}
        </button>
      </Card>

      <Card title="가속 진행">
        <div className="inline-form">
          <label className="field inline">
            <span>일수</span>
            <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ''))} />
          </label>
          <button type="button" className="btn btn-secondary" disabled={snap.phase === 'SEASON_OVER'} onClick={advanceN}>
            N일 넘기기
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" disabled={snap.phase === 'SEASON_OVER'} onClick={() => run((s) => s.advanceToSeasonEnd(), '시즌 끝까지 진행했어요')}>
            시즌 끝까지
          </button>
          <button type="button" className="btn btn-secondary" disabled={snap.phase !== 'SEASON_OVER'} onClick={() => run((s) => s.startNewSeason(), '새 시즌 시작')}>
            새 시즌 시작
          </button>
        </div>
      </Card>

      <Card title="새 게임">
        <label className="field">
          <span>시드 (비우면 무작위)</span>
          <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
        </label>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (!confirm('현재 게임을 버리고 새 게임을 시작할까요?')) return;
              run((s) => s.newGame({ seed: seed ? Number(seed) : undefined, devMode: true, tacCap: snap.settings.tacCap }), '새 게임을 시작했어요');
              go({ tab: 'home' });
            }}
          >
            새 게임
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (confirm('세이브를 지우고 처음 화면으로 갈까요?')) run((s) => s.resetGame());
            }}
          >
            게임 초기화
          </button>
        </div>
      </Card>

      <Card title="세이브·로그">
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => { const t = run((s) => s.exportSave()); if (t) downloadText(`kickoff-save-s${snap.time.season}d${snap.time.day}.json`, t); }}>
            세이브 내보내기
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { const t = run((s) => s.exportActionLog()); if (t) downloadText(`kickoff-actionlog-${Date.now()}.json`, t); }}>
            행동 로그 내보내기
          </button>
        </div>
        <label className="field">
          <span>세이브 가져오기 (파일)</span>
          <input type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImportText(await f.text()); }} />
        </label>
        <label className="field">
          <span>또는 JSON 붙여넣기</span>
          <textarea rows={3} value={importText} onChange={(e) => setImportText(e.target.value)} />
        </label>
        <button type="button" className="btn btn-secondary btn-block" disabled={!importText.trim()} onClick={() => { if (run((s) => s.importSave(importText), '세이브를 불러왔어요')) setImportText(''); }}>
          가져오기
        </button>
      </Card>

      <Card title="전술 상한 (A/B)">
        <Segmented<string>
          label="전술 상한"
          value={String(snap.settings.tacCap)}
          onChange={(v) => run((s) => s.setTacCap(Number(v) as TacticCap), `상한 ${v} 적용 (이후 경기부터)`)}
          options={CAPS.map((c) => ({ value: String(c), label: c.toFixed(2) }))}
        />
      </Card>

      <Calibration reportFatal={reportFatal} />
      <Resimulate />
    </div>
  );
}

function Calibration({ reportFatal }: { reportFatal: (e: unknown) => void }) {
  const snap = useGame();
  const { service } = useServiceCtx();
  const [n, setN] = useState('1000');
  const [seed, setSeed] = useState('42');
  const [picked, setPicked] = useState<ScenarioId[]>(['BASELINE', 'OVR_DIFF_10', 'OVR_DIFF_25']);
  const [progress, setProgress] = useState<CalibrationProgress | null>(null);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const r = await service.runCalibration({ matchesPerScenario: Math.max(10, Number(n) || 1000), tacCap: snap.settings.tacCap, seed: Number(seed) || 42, scenarios: picked }, setProgress);
      setReport(r);
    } catch (e) {
      if (e instanceof Error && /TODO/.test(e.message)) reportFatal(e);
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Card title="캘리브레이션 (8.1 보정 목표)">
      <div className="inline-form">
        <label className="field inline">
          <span>시나리오당 경기</span>
          <input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, ''))} />
        </label>
        <label className="field inline">
          <span>시드</span>
          <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} />
        </label>
      </div>
      <div className="chips">
        {SCENARIOS.map((s) => (
          <button key={s} type="button" className={`chip ${picked.includes(s) ? 'is-active' : ''}`} aria-pressed={picked.includes(s)} onClick={() => setPicked((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))}>
            {s}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={busy || picked.length === 0} onClick={start}>
        {busy ? '실행 중…' : `실행 (상한 ${snap.settings.tacCap})`}
      </button>
      {progress && (
        <div aria-live="polite">
          <p className="small">
            {progress.scenario} · {progress.done}/{progress.total}
          </p>
          <Meter value={progress.done / Math.max(1, progress.total)} label="캘리브레이션 진행률" />
        </div>
      )}
      {err && <p className="warn-line">{err}</p>}
      {report && (
        <>
          <p>
            {report.allPass ? <Badge tone="good">전부 통과</Badge> : <Badge tone="bad">미달 있음</Badge>} <span className="small muted">엔진 {report.engineVersion} · {(report.durationMs / 1000).toFixed(1)}초</span>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th className="t-left">목표</th>
                <th>범위</th>
                <th>실제</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {report.targets.map((t) => (
                <tr key={t.id}>
                  <td className="t-left small">
                    {t.label}
                    <br />
                    <span className="muted">{t.scenario}</span>
                  </td>
                  <td className="small">
                    {t.min ?? '−'}~{t.max ?? '−'} {t.unit}
                  </td>
                  <td>{t.actual}</td>
                  <td>{t.pass ? '✓ 통과' : '✕ 실패'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <StyleMatrix cells={(report as CalibrationReport & { details?: { counterMatrix?: MatrixCell[] } }).details?.counterMatrix} />
        </>
      )}
    </Card>
  );
}

function StyleMatrix({ cells }: { cells: MatrixCell[] | undefined }) {
  const labels = useQuery((s) => Object.fromEntries((s.getCatalog().styles ?? []).map((x) => [x.id, x.label]))).data ?? {};
  if (!cells?.length) return <p className="small muted">9×9 스타일 행렬은 결과에 셀 데이터가 있을 때만 보여요 (STYLE_MATRIX 요약은 위 표)</p>;
  const ids = [...new Set(cells.map((c) => c.us))];
  const at = (a: string, b: string) => cells.find((c) => c.us === a && c.them === b);
  return (
    <div className="matrix-wrap">
      <p className="small">9×9 스타일 행렬 · 칸 = 행 스타일의 (승 − 패) %p</p>
      <table className="table matrix">
        <thead>
          <tr>
            <th className="t-left">우리 \ 상대</th>
            {ids.map((b) => (
              <th key={b} title={labels[b] ?? b}>
                {(labels[b] ?? b).slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((a) => (
            <tr key={a}>
              <th className="t-left">{labels[a] ?? a}</th>
              {ids.map((b) => {
                const c = at(a, b);
                const v = c ? Math.round(c.winPct - c.lossPct) : undefined;
                return (
                  <td key={b} className={v === undefined || a === b ? '' : v >= 6 ? 'm-pos' : v <= -6 ? 'm-neg' : ''}>
                    {v === undefined || a === b ? '·' : v > 0 ? `+${v}` : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Resimulate() {
  const snap = useGame();
  const run = useAction();
  const last = lastUserFixture(snap);
  const base = useQuery((s) => (last ? s.getReport(last.id) : null), [last?.id]).data ?? null;
  const [cap, setCap] = useState<string>(String(snap.settings.tacCap));
  const [tacticsOn, setTacticsOn] = useState(true);
  const [disabled, setDisabled] = useState<RuleId[]>([]);
  const [result, setResult] = useState<MatchReport | null>(null);
  if (!last) return (
    <Card title="시드 고정 재시뮬">
      <Empty>치른 경기가 없어요</Empty>
    </Card>
  );
  const rows = (r: MatchReport | null) => Object.entries(r?.debug?.ruleXg ?? {}) as [RuleId, number][];
  return (
    <Card title={`시드 고정 재시뮬 · Day ${last.day}`}>
      <Segmented<string> label="재시뮬 상한" size="sm" value={cap} onChange={setCap} options={CAPS.map((c) => ({ value: String(c), label: String(c) }))} />
      <Toggle label="전술 효과 켜기" checked={tacticsOn} onChange={setTacticsOn} />
      <div className="chips">
        {RULE_IDS.map((r) => (
          <button key={r} type="button" className={`chip ${disabled.includes(r) ? 'is-off' : 'is-active'}`} aria-pressed={!disabled.includes(r)} onClick={() => setDisabled((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]))}>
            {r}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-secondary btn-block" onClick={() => setResult(run((s) => s.resimulate(last.id, { tacCap: Number(cap) as TacticCap, tacticsEnabled: tacticsOn, disabledRules: disabled })) ?? null)}>
        재시뮬 실행
      </button>
      {(base || result) && (
        <table className="table">
          <thead>
            <tr>
              <th className="t-left">규칙</th>
              <th>원본 xG</th>
              <th>재시뮬 xG</th>
            </tr>
          </thead>
          <tbody>
            {rows(base).map(([k, v]) => (
              <tr key={k}>
                <td className="t-left">{k}</td>
                <td>{signed(v)}</td>
                <td>{result ? signed(result.debug?.ruleXg[k] ?? 0) : '−'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result && (
        <p className="small">
          전술 막대 {signed(base?.factorBars.tactics ?? 0)} → <strong>{signed(result.factorBars.tactics)}</strong> · 보존 오차 {result.debug?.conservationError ?? 0}
        </p>
      )}
    </Card>
  );
}
