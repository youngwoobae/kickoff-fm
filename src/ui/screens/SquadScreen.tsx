/** Q01 선수 목록 · Q02 선수 상세(시트) (소유: B) */
import { useMemo, useState } from 'react';
import { isGameError } from '../../services';
import type { AttrDef, Player, PlayerId } from '../../types';
import { Badge, Card, ConditionBar, Empty, ErrorNote, FitMark, MoneyField, Segmented, Sheet } from '../components/kit';
import { FIT_LABEL, MORALE_LABEL, MORALE_SHORT, POS_LABEL, POS_NAME, POS_ORDER, TRANSFER_ERROR_TEXT, fitOf, formatKc, isAvailable } from '../format';
import { useGame, useInlineAction, useIsOwner, useQuery } from '../service/ServiceContext';

type SortKey = 'pos' | 'ovr' | 'cond' | 'form';

export function SquadScreen() {
  const snap = useGame();
  const squad = useQuery((s) => s.getSquad()).data ?? [];
  const ps = useQuery((s) => s.getPlanState()).data;
  const [sort, setSort] = useState<SortKey>('pos');
  const [sel, setSel] = useState<PlayerId | null>(null);
  const lineup = ps?.confirmed?.plan.lineup ?? ps?.draft?.plan.lineup ?? ps?.preview?.plan.lineup;
  const starters = new Set(lineup?.starters ?? []);
  const bench = new Set(lineup?.bench ?? []);

  const sorted = useMemo(() => {
    const xs = [...squad];
    if (sort === 'pos') xs.sort((a, b) => POS_ORDER.indexOf(a.primary) - POS_ORDER.indexOf(b.primary) || b.ovr - a.ovr);
    if (sort === 'ovr') xs.sort((a, b) => b.ovr - a.ovr);
    if (sort === 'cond') xs.sort((a, b) => a.condition - b.condition);
    if (sort === 'form') xs.sort((a, b) => b.morale - a.morale || b.season.goals - a.season.goals);
    return xs;
  }, [squad, sort]);

  const out = squad.filter((p) => !isAvailable(p)).length;
  const avgCond = squad.length ? Math.round(squad.reduce((a, p) => a + p.condition, 0) / squad.length) : 0;

  return (
    <div className="screen">
      <Card className="card-compact">
        <div className="row-between small">
          <span>{squad.length}명 · 평균 컨디션 {avgCond}</span>
          <span>{out > 0 ? <Badge tone="bad">출전 불가 {out}</Badge> : <Badge tone="good">전원 출전 가능</Badge>}</span>
        </div>
      </Card>
      <Segmented
        label="정렬"
        size="sm"
        value={sort}
        onChange={setSort}
        options={[
          { value: 'pos', label: '포지션' },
          { value: 'ovr', label: 'OVR' },
          { value: 'cond', label: '컨디션↑' },
          { value: 'form', label: '폼' },
        ]}
      />
      {sorted.length === 0 ? (
        <Empty>선수가 없습니다</Empty>
      ) : (
        <ul className="player-list" aria-label="선수 목록">
          {sorted.map((p) => (
            <li key={p.id}>
              <button type="button" className="player-row" onClick={() => setSel(p.id)} aria-label={`${p.name}, ${POS_NAME[p.primary]}, OVR ${p.ovr}, 컨디션 ${Math.round(p.condition)}`}>
                <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span>
                <span className="pr-main">
                  <span className="pr-name">
                    {p.name}
                    {starters.has(p.id) && <span className="tag">선발</span>}
                    {bench.has(p.id) && <span className="tag tag-muted">벤치</span>}
                    {p.isTemporary && <span className="tag tag-muted">임시</span>}
                  </span>
                  <span className="pr-sub">
                    {p.age}세 · 폼 {MORALE_SHORT[p.morale]} · {p.season.apps}경기 {p.season.goals}골
                    {p.availability.injuryDays > 0 && <Badge tone="bad">🩹 부상 {p.availability.injuryDays}일</Badge>}
                    {p.availability.suspendedMatches > 0 && <Badge tone="bad">🟥 정지 {p.availability.suspendedMatches}</Badge>}
                  </span>
                </span>
                <span className="pr-cond">
                  <ConditionBar value={p.condition} />
                </span>
                <span className="pr-ovr" aria-hidden="true">
                  {p.ovr}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PlayerSheet playerId={sel} onClose={() => setSel(null)} season={snap.time.season} />
    </div>
  );
}

export function PlayerSheet({ playerId, onClose }: { playerId: PlayerId | null; onClose: () => void; season?: number }) {
  const catalog = useQuery((s) => s.getCatalog()).data;
  const p = useQuery((s) => (playerId ? s.getPlayer(playerId) : null), [playerId]).data;
  if (!playerId || !p) return null;
  return (
    <Sheet open title={p.name} onClose={onClose}>
      <PlayerDetail p={p} attrs={catalog?.attributes ?? []} onClose={onClose} />
    </Sheet>
  );
}

function PlayerDetail({ p, attrs, onClose }: { p: Player; attrs: AttrDef[]; onClose: () => void }) {
  const groups: [AttrDef['group'], string][] = p.primary === 'GK'
    ? [['GOALKEEPING', '골키핑'], ['MENTAL', '정신'], ['PHYSICAL', '신체'], ['TECHNICAL', '기술']]
    : [['TECHNICAL', '기술'], ['MENTAL', '정신'], ['PHYSICAL', '신체']];
  return (
    <div className="player-detail">
      <div className="pd-top">
        <span className={`pos-badge pos-${p.primary}`}>{POS_LABEL[p.primary]}</span>
        <span>
          {POS_NAME[p.primary]} · {p.age}세
        </span>
        <span className="pd-ovr">OVR {p.ovr}</span>
      </div>
      <div className="pd-grid">
        <div>
          컨디션 <ConditionBar value={p.condition} />
        </div>
        <div>사기 {MORALE_LABEL[p.morale]}</div>
        <div>
          스카우트 등급 {p.scoutRange[0]}~{p.scoutRange[1]}
        </div>
      </div>
      <ContractSection p={p} onClose={onClose} />
      {!isAvailable(p) && (
        <p className="warn-line">
          {p.availability.injuryDays > 0 && `부상 ${p.availability.injuryDays}일 남음 `}
          {p.availability.suspendedMatches > 0 && `출장 정지 ${p.availability.suspendedMatches}경기`}
        </p>
      )}
      <h3 className="h3">포지션 적합도</h3>
      <div className="fit-grid">
        {POS_ORDER.map((pos) => {
          const f = fitOf(p, pos);
          return (
            <span key={pos} className={`fit-cell fit-${f.toLowerCase()}`} title={FIT_LABEL[f]}>
              <FitMark fit={f} /> {POS_LABEL[pos]}
            </span>
          );
        })}
      </div>
      {groups.map(([g, label]) => (
        <div key={g}>
          <h3 className="h3">{label}</h3>
          <ul className="attr-list">
            {attrs
              .filter((a) => a.group === g)
              .map((a) => {
                const v = p.attrs[a.key];
                return (
                  <li key={a.key}>
                    <span>{a.label}</span>
                    <span className="attr-bar" aria-hidden="true">
                      <span style={{ width: `${(v / 20) * 100}%` }} className={v >= 15 ? 'tone-good' : v >= 10 ? 'tone-accent' : 'tone-warn'} />
                    </span>
                    <strong>{v}</strong>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      <h3 className="h3">이번 시즌</h3>
      <p className="small">
        출전 {p.season.apps} (선발 {p.season.starts}) · {p.season.minutes}분 · 골 {p.season.goals} · 슈팅 {p.season.shots} · 키패스 {p.season.keyPasses} · 태클 {p.season.tackles}
      </p>
      <GrowthHistory p={p} />
    </div>
  );
}

/** 성장 기록 (2.1.0 Player.history, 시즌 경계에서 쌓인다): OVR 추이 선 + 시즌 목록 */
function GrowthHistory({ p }: { p: Player }) {
  const hist = p.history ?? [];
  if (!hist.length) {
    return (
      <>
        <h3 className="h3">성장 기록</h3>
        <p className="small muted">시즌이 끝나면 OVR 기록이 쌓여요 (지금 OVR {p.ovr})</p>
      </>
    );
  }
  const pts = [...hist.map((h) => ({ label: `S${h.season}`, ovr: h.ovr })), { label: '현재', ovr: p.ovr }];
  const lo = Math.min(...pts.map((x) => x.ovr)) - 2;
  const hi = Math.max(...pts.map((x) => x.ovr)) + 2;
  const W = 300;
  const H = 90;
  const x = (i: number) => 20 + (i * (W - 40)) / Math.max(1, pts.length - 1);
  const y = (v: number) => 20 + ((hi - v) * (H - 40)) / (hi - lo);
  const delta = (cur: number, prev?: number) => {
    if (prev === undefined) return '';
    const d = cur - prev;
    return d > 0 ? ` ▲+${d}` : d < 0 ? ` ▼${d}` : ' –';
  };
  return (
    <>
      <h3 className="h3">성장 기록</h3>
      <svg className="ovr-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`OVR 추이: ${pts.map((q) => `${q.label} ${q.ovr}`).join(', ')}`}>
        <polyline points={pts.map((q, i) => `${x(i)},${y(q.ovr)}`).join(' ')} />
        {pts.map((q, i) => (
          <g key={q.label}>
            <circle cx={x(i)} cy={y(q.ovr)} r={4} />
            <text x={x(i)} y={y(q.ovr) - 8} textAnchor="middle">
              {q.ovr}
            </text>
            <text x={x(i)} y={H - 4} textAnchor="middle" className="ovr-spark-axis">
              {q.label}
            </text>
          </g>
        ))}
      </svg>
      <ul className="list compact">
        {[...hist].reverse().map((h, i, arr) => (
          <li key={h.season} className="list-row small">
            <span>
              S{h.season} · {h.age}세{h.tier && ` · ${h.tier}`} · {h.apps}경기 {h.goals}골
            </span>
            <span>
              OVR <strong>{h.ovr}</strong>
              {delta(h.ovr, arr[i + 1]?.ovr)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** 계약·재계약·방출 (M4.6, 계약 2.2.0 선택 메서드). 내 선수만, 실행은 구단주만 */
function ContractSection({ p, onClose }: { p: Player; onClose: () => void }) {
  const snap = useGame();
  const isOwner = useIsOwner();
  const [mode, setMode] = useState<'none' | 'renew' | 'release'>('none');
  const mine = p.clubId === snap.userClubId;
  const c = p.contract;
  if (!p.clubId) return <p className="small muted">무소속(FA) 선수예요.</p>;
  return (
    <>
      <h3 className="h3">계약</h3>
      <ul className="list compact">
        <li className="list-row">
          <span>연봉 · 남은 기간</span>
          <span>
            {formatKc(c.salary)} · {c.seasonsLeft}시즌{c.seasonsLeft === 1 && <> <Badge tone="warn">⌛ 이번 시즌 만료</Badge></>}
          </span>
        </li>
        {c.capCharge !== undefined && (
          <li className="list-row">
            <span>캡 산입액</span>
            <span>{formatKc(c.capCharge)}</span>
          </li>
        )}
        {!!c.bonusPerSeason && (
          <li className="list-row">
            <span>보너스 시즌 분할</span>
            <span>{formatKc(c.bonusPerSeason)}</span>
          </li>
        )}
      </ul>
      {!mine ? null : !isOwner ? (
        <p className="small muted">재계약과 방출은 구단주가 해요. 의견이 있으면 구단주에게 전해 주세요.</p>
      ) : (
        <>
          <div className="btn-row">
            <button type="button" className={`btn ${mode === 'renew' ? 'btn-primary' : 'btn-secondary'}`} aria-expanded={mode === 'renew'} onClick={() => setMode(mode === 'renew' ? 'none' : 'renew')}>
              재계약
            </button>
            <button type="button" className={`btn ${mode === 'release' ? 'btn-danger' : 'btn-secondary'}`} aria-expanded={mode === 'release'} onClick={() => setMode(mode === 'release' ? 'none' : 'release')}>
              방출
            </button>
          </div>
          {mode === 'renew' && <RenewalPanel p={p} />}
          {mode === 'release' && <ReleasePanel p={p} onDone={onClose} />}
        </>
      )}
    </>
  );
}

function RenewalPanel({ p }: { p: Player }) {
  const snap = useGame();
  const q = useQuery((s) => s.getRenewalQuote?.(p.id), [p.id]);
  const quote = q.data;
  const { run, error } = useInlineAction();
  const [salary, setSalary] = useState<number | null>(quote?.askSalary ?? null);
  const [seasons, setSeasons] = useState<number>(quote?.seasonsRange[0] ?? 1);
  const [result, setResult] = useState<{ accepted: boolean; ask: number; bonus: number } | null>(null);
  // 수락 뒤에는 계약이 늘어 견적이 RENEWAL_NOT_OPEN 이 되므로 결과를 먼저 보여 준다
  if (result?.accepted)
    return (
      <p className="small">
        <Badge tone="good">✓ 수락</Badge> 재계약했어요. 재계약 보너스 {formatKc(result.bonus)}를 지급했어요.
      </p>
    );
  if (q.error) return <p className="small muted">{(isGameError(q.error) && TRANSFER_ERROR_TEXT[q.error.code]) || q.error.message}</p>;
  if (!quote) return <p className="small muted">재계약은 곧 열려요. 지금은 시즌이 끝나면 계약이 자동으로 이어져요.</p>;
  const [lo, hi] = quote.seasonsRange;
  const bonus = Math.round((quote.bonusPerSeasonRate * (salary ?? 0) * seasons) / 1000) * 1000;
  const offer = () => {
    setResult(null);
    const r = run((s) => s.offerRenewal?.(p.id, salary ?? 0, seasons));
    if (r) setResult({ ...r, bonus });
  };
  return (
    <div className="form-stack">
      <p>
        요구 연봉 <strong>{formatKc(quote.askSalary)}</strong> · 기간 {lo === hi ? lo : `${lo}~${hi}`}시즌
      </p>
      <MoneyField label="제안 연봉" value={salary} onChange={setSalary} hint={`요구 연봉 이상이면 받아들여요 · 재계약 보너스 ${formatKc(bonus)} 즉시 지급`} />
      <div className="field">
        <span>연장 기간</span>
        <Segmented
          label="연장 기간"
          size="sm"
          value={String(seasons)}
          onChange={(v) => setSeasons(Number(v))}
          options={Array.from({ length: hi - lo + 1 }, (_, i) => ({ value: String(lo + i), label: `${lo + i}시즌` }))}
        />
      </div>
      <button type="button" className="btn btn-primary" disabled={!salary} onClick={offer}>
        재계약 제안
      </button>
      {result && (
        <p className="small">
          <Badge tone="bad">✕ 거절</Badge> 선수가 거절했어요. 요구 연봉은 {formatKc(result.ask)}예요.
        </p>
      )}
      <ErrorNote error={error} dev={snap.settings.devMode} />
    </div>
  );
}

function ReleasePanel({ p, onDone }: { p: Player; onDone: () => void }) {
  const snap = useGame();
  const q = useQuery((s) => s.getReleaseQuote?.(p.id), [p.id]);
  const { run, error } = useInlineAction();
  if (q.error) return <p className="small muted">지금은 방출할 수 없어요. 방출 기능이 열리면 위약금을 보여 드릴게요.</p>;
  const quote = q.data;
  if (!quote) return <p className="small muted">방출은 곧 열려요.</p>;
  const release = () => {
    const ok = run((s) => {
      s.releasePlayer?.(p.id);
      return true;
    }, `${p.name} 선수를 방출했어요`);
    if (ok) onDone();
  };
  return (
    <div className="form-stack">
      <p>{quote.exempt ? '위약금 없이 방출할 수 있어요.' : <>위약금 <strong className="neg">{formatKc(quote.penalty)}</strong>를 바로 내야 해요 (남은 연봉의 절반).</>}</p>
      <p className="small muted">방출한 선수는 FA가 되고 연봉 캡에서 빠져요. 18명보다 적어지면 임시 계약 선수가 채워요.</p>
      <button type="button" className="btn btn-danger" onClick={release}>
        {quote.exempt ? '방출하기' : `위약금 ${formatKc(quote.penalty)} 내고 방출`}
      </button>
      <ErrorNote error={error} dev={snap.settings.devMode} />
    </div>
  );
}
