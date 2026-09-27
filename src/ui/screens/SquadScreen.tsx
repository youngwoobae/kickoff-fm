/** Q01 선수 목록 · Q02 선수 상세(시트) (소유: B) */
import { useMemo, useState } from 'react';
import type { AttrDef, Player, PlayerId } from '../../types';
import { Badge, Card, ConditionBar, Empty, FitMark, Segmented, Sheet } from '../components/kit';
import { FIT_LABEL, MORALE_LABEL, MORALE_SHORT, POS_LABEL, POS_NAME, POS_ORDER, fitOf, formatKc, isAvailable } from '../format';
import { useGame, useQuery } from '../service/ServiceContext';

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
      <PlayerDetail p={p} attrs={catalog?.attributes ?? []} />
    </Sheet>
  );
}

function PlayerDetail({ p, attrs }: { p: Player; attrs: AttrDef[] }) {
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
        <div>
          계약 {p.contract.seasonsLeft}시즌 · 연봉 {formatKc(p.contract.salary)}
        </div>
      </div>
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
    </div>
  );
}
