/** T01 라인업 편집: 탭-탭 교환, 피치/리스트 보기, 벤치 7 (소유: B) */
import { useMemo, useState } from 'react';
import type { FormationDef, MatchPlan, Player, PlayerId } from '../../types';
import { Badge, Card, ConditionBar, DisciplineBadges, Empty, FitMark, Segmented, Stars, Toggle } from '../components/kit';
import { POS_LABEL, fitOf, isAvailable, pitchRows, roleFit } from '../format';
import { PlanActions, usePlanLock } from '../plan/PlanActions';
import { getPrefs } from '../prefs';
import { usePlanEditor } from '../plan/PlanEditor';
import { useGame, useQuery } from '../service/ServiceContext';
import { PlayerSheet } from './SquadScreen';
import { YELLOW_LIMIT, yellowAccumOf } from '../types23';

type Area = 'S' | 'B' | 'R';
interface Pick {
  area: Area;
  index: number;
  id?: PlayerId;
}

function applySwap(plan: MatchPlan, a: Pick, b: Pick, reserves: PlayerId[]): MatchPlan {
  const { starters, bench } = plan.lineup;
  const get = (p: Pick): PlayerId | undefined => (p.area === 'S' ? starters[p.index] : p.area === 'B' ? bench[p.index] : reserves[p.index]);
  const set = (p: Pick, id: PlayerId | undefined) => {
    if (p.area === 'S' && id) starters[p.index] = id;
    if (p.area === 'B') {
      if (id) {
        if (p.index >= bench.length) bench.push(id);
        else bench[p.index] = id;
      } else bench.splice(p.index, 1);
    }
  };
  const ia = get(a);
  const ib = get(b);
  if (a.area === 'R' && b.area === 'R') return plan;
  // 선발 자리를 비울 수는 없다 (빈 벤치 칸 ↔ 선발 교환 금지)
  if ((a.area === 'S' && !ib) || (b.area === 'S' && !ia)) return plan;
  set(a, ib);
  set(b, ia);
  return plan;
}

export function LineupScreen() {
  const snap = useGame();
  const { plan, update, planState } = usePlanEditor();
  const squad = useQuery((s) => s.getSquad()).data ?? [];
  const catalog = useQuery((s) => s.getCatalog()).data;
  const [pick, setPick] = useState<Pick | null>(null);
  const [view, setView] = useState<'pitch' | 'list'>(() => (getPrefs().fontScale === 1.25 ? 'list' : 'pitch'));
  const [detail, setDetail] = useState<PlayerId | null>(null);
  const lock = usePlanLock();

  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const club = snap.clubs[snap.userClubId];

  if (lock) return <Empty>{lock}</Empty>;
  if (!plan || !planState?.matchId || !club) {
    return <Empty>다음 경기가 없어 선발을 편집할 수 없어요 (오프시즌·시즌 종료)</Empty>;
  }
  const slot = club.tactics[plan.startSlot];
  const formation: FormationDef | undefined = catalog?.formations.find((f) => f.id === slot.formation);
  const used = new Set([...plan.lineup.starters, ...plan.lineup.bench]);
  const reserves = squad.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr).map((p) => p.id);

  const tap = (t: Pick) => {
    if (!pick) {
      if (t.id || t.area === 'B') setPick(t);
      return;
    }
    if (pick.area === t.area && pick.index === t.index) {
      setPick(null);
      return;
    }
    update((p) => applySwap(p, pick, t, reserves));
    setPick(null);
  };
  const isPicked = (t: Pick) => !!pick && pick.area === t.area && pick.index === t.index;
  const pickedPlayer = pick?.id ? byId.get(pick.id) : undefined;
  const roleOf = (i: number) => catalog?.roles.find((r) => r.id === slot.roles[i]);
  const roleLabel = (i: number) => roleOf(i)?.label ?? '';
  const stars = (i: number, p: Player | undefined) => {
    const r = roleOf(i);
    return p && r ? roleFit(p, r.keyAttrs).stars : undefined;
  };

  return (
    <div className="screen lineup">
      <Card className="card-compact">
        <div className="row-between">
          <Segmented
            label="시작 전술 슬롯"
            size="sm"
            value={plan.startSlot}
            onChange={(v) => update((p) => ({ ...p, startSlot: v }))}
            options={[
              { value: 'A', label: `슬롯 A · ${club.tactics.A.formation}` },
              { value: 'B', label: `슬롯 B · ${club.tactics.B.formation}` },
            ]}
          />
        </div>
        <p className="small muted">숙련도 {Math.round(slot.familiarity)} · 포메이션·역할은 전술 탭에서 바꿔요</p>
      </Card>

      <div className="row-between">
        <Segmented label="보기" size="sm" value={view} onChange={setView} options={[{ value: 'pitch', label: '피치' }, { value: 'list', label: '목록' }]} />
        <span className="legend small">◎주 ○숙련 △가능 ✕부적합 · ★역할 적합</span>
      </div>

      <OutStartersWarning ids={plan.lineup.starters} byId={byId} />

      <div className="pick-bar" aria-live="polite">
        {pick ? (
          <>
            <span>
              선택됨: <strong>{pickedPlayer?.name ?? '빈 벤치 자리'}</strong> → 바꿀 자리를 탭해 주세요
            </span>
            {pickedPlayer && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetail(pickedPlayer.id)}>
                상세
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPick(null)}>
              취소
            </button>
          </>
        ) : (
          <span className="muted">선수를 탭하고, 바꿀 자리를 다시 탭하면 교환돼요</span>
        )}
      </div>

      {view === 'pitch' && formation ? (
        <div className="pitch" data-tour="lineup.pitch" role="group" aria-label="피치 (위가 상대 골대)">
          <span className="pitch-goal-label">상대 골대 ↑</span>
          {pitchRows(formation).map((row, ri) => (
            <div key={ri} className="pitch-row">
              {row.map((i) => {
                const fs = formation.slots[i];
                const id = plan.lineup.starters[i];
                const p = id ? byId.get(id) : undefined;
                const fit = p && fs ? fitOf(p, fs.position) : 'UNSUITED';
                const t: Pick = { area: 'S', index: i, id };
                return (
                  <button
                    key={i}
                    type="button"
                    className={`token ${isPicked(t) ? 'is-picked' : ''} ${p && !isAvailable(p) ? 'is-out' : ''}`}
                    onClick={() => tap(t)}
                    aria-pressed={isPicked(t)}
                    aria-label={`${fs ? POS_LABEL[fs.position] : ''} ${roleLabel(i)}, ${p?.name ?? '비어 있음'}, 컨디션 ${Math.round(p?.condition ?? 0)}, 적합도 ${fit}, 역할 적합 ${stars(i, p) ?? 0}/5`}
                  >
                    <span className="token-pos">
                      {fs && POS_LABEL[fs.position]} <FitMark fit={fit} />
                    </span>
                    <span className="token-name">{p?.name ?? '—'}</span>
                    {stars(i, p) !== undefined && <Stars n={stars(i, p)!} />}
                    {p && <ConditionBar value={p.condition} compact />}
                    {p && !isAvailable(p) && <span className="token-warn">{p.availability.suspendedMatches > 0 ? '🟥 정지' : '🩹 부상'}</span>}
                    {p && isAvailable(p) && yellowAccumOf(p) >= YELLOW_LIMIT - 1 && <span className="token-warn">🟨 {yellowAccumOf(p)}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <ul className="slot-list" data-tour="lineup.pitch" aria-label="선발 목록">
          {plan.lineup.starters.map((id, i) => {
            const fs = formation?.slots[i];
            const p = byId.get(id);
            const t: Pick = { area: 'S', index: i, id };
            return (
              <li key={i}>
                <button type="button" className={`slot-row ${isPicked(t) ? 'is-picked' : ''}`} onClick={() => tap(t)} aria-pressed={isPicked(t)}>
                  <span className="slot-pos">{fs && POS_LABEL[fs.position]}</span>
                  <span className="slot-role small muted">{roleLabel(i)}</span>
                  <span className="slot-name">
                    {p?.name ?? '—'} {p && fs && <FitMark fit={fitOf(p, fs.position)} />} {stars(i, p) !== undefined && <Stars n={stars(i, p)!} />}
                    {p && p.availability.injuryDays > 0 && <Badge tone="bad">🩹 부상</Badge>} {p && <DisciplineBadges p={p} />}
                  </span>
                  {p && <ConditionBar value={p.condition} />}
                  <span className="slot-ovr">{p?.ovr}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="h3">벤치 ({plan.lineup.bench.length}/7)</h3>
      <div className="tray" role="list">
        {plan.lineup.bench.map((id, i) => (
          <TrayCard key={id} p={byId.get(id)} picked={isPicked({ area: 'B', index: i })} onTap={() => tap({ area: 'B', index: i, id })} />
        ))}
        {plan.lineup.bench.length < 7 && (
          <button type="button" role="listitem" className={`tray-card is-empty ${isPicked({ area: 'B', index: plan.lineup.bench.length }) ? 'is-picked' : ''}`} onClick={() => tap({ area: 'B', index: plan.lineup.bench.length })}>
            + 빈 자리
          </button>
        )}
      </div>

      <h3 className="h3">명단 외 ({reserves.length})</h3>
      <div className="tray" role="list">
        {reserves.map((id, i) => (
          <TrayCard key={id} p={byId.get(id)} picked={isPicked({ area: 'R', index: i })} onTap={() => tap({ area: 'R', index: i, id })} />
        ))}
      </div>

      <Card className="card-compact" tour="lineup.autoRotation">
        <Toggle label="자동 로테이션" hint="경기 전 컨디션 70 미만 선발을 자동 대체" checked={plan.autoRotation} onChange={(v) => update((p) => ({ ...p, autoRotation: v }))} />
      </Card>

      <PlanActions />
      <PlayerSheet playerId={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function TrayCard({ p, picked, onTap }: { p: Player | undefined; picked: boolean; onTap: () => void }) {
  if (!p) return null;
  return (
    <button type="button" role="listitem" className={`tray-card ${picked ? 'is-picked' : ''} ${!isAvailable(p) ? 'is-out' : ''}`} onClick={onTap} aria-pressed={picked} aria-label={`${p.name}, ${POS_LABEL[p.primary]}, 컨디션 ${Math.round(p.condition)}`}>
      <span className="tray-name">{p.name}</span>
      <span className="small">
        {POS_LABEL[p.primary]} {p.ovr}
      </span>
      <ConditionBar value={p.condition} compact />
      {!isAvailable(p) && <Badge tone="bad">{p.availability.suspendedMatches > 0 ? `🟥 정지 ${p.availability.suspendedMatches}` : '🩹 부상'}</Badge>}
      {isAvailable(p) && yellowAccumOf(p) >= YELLOW_LIMIT - 1 && <Badge tone="warn">🟨 {yellowAccumOf(p)}</Badge>}
    </button>
  );
}

/** 선발에 출장 정지·부상 선수가 있으면 경고 (경기 전 자동 대체되지만 미리 바꾸는 편이 낫다) */
function OutStartersWarning({ ids, byId }: { ids: PlayerId[]; byId: Map<PlayerId, Player> }) {
  const out = ids.map((id) => byId.get(id)).filter((p): p is Player => !!p && !isAvailable(p));
  if (!out.length) return null;
  return (
    <p className="warn-line" role="alert">
      ⚠ 선발에 뛸 수 없는 선수가 있어요:{' '}
      {out.map((p) => `${p.name}(${p.availability.suspendedMatches > 0 ? `🟥 출장 정지 ${p.availability.suspendedMatches}경기` : `🩹 부상 ${p.availability.injuryDays}일`})`).join(', ')}. 바꾸지 않으면 경기 전에 자동으로 다른 선수로 바뀌어요.
    </p>
  );
}
