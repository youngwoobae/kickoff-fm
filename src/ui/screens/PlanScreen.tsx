/** 경기 플랜: 시작 슬롯, 상대 맞춤 지시, 조건부 지시(T04), 자동 교체, 초안/제출/기본 플랜/추천 (소유: B) */
import { useState } from 'react';
import type { ClubId, ConditionalOrder, Lane, SlotKey, TriggerAction, TriggerCondition } from '../../types';
import { Badge, Card, Empty, Segmented, Sheet, Toggle } from '../components/kit';
import { conditionalText, EDGE_LABEL, PLAN_SOURCE_LABEL, SIZE_LABEL } from '../format';
import { PlanActions, usePlanLock } from '../plan/PlanActions';
import { usePlanEditor } from '../plan/PlanEditor';
import { useAction, useGame, useIsOwner, useQuery } from '../service/ServiceContext';

type TimeOpt = 'none' | 'HT' | '45' | '60' | '75';
type ScoreOpt = 'none' | 'LEAD' | 'DRAW' | 'TRAIL';
type ActOpt = 'SLOT_A' | 'SLOT_B' | 'M+1' | 'M+2' | 'M-1' | 'M-2' | 'HT_TEMPO+' | 'HT_TEMPO-' | 'HT_PRESS+' | 'HT_PRESS-';

const TEMPLATES: { label: string; make: () => Omit<ConditionalOrder, 'id'> }[] = [
  { label: '지키기', make: () => ({ conditions: [{ kind: 'TIME', after: 75 }, { kind: 'SCORE', state: 'LEAD', minDiff: 1 }], action: { kind: 'MENTALITY_DELTA', delta: -1 }, enabled: true }) },
  { label: '추격', make: () => ({ conditions: [{ kind: 'TIME', after: 60 }, { kind: 'SCORE', state: 'TRAIL', minDiff: 1 }], action: { kind: 'MENTALITY_DELTA', delta: 2 }, enabled: true }) },
  { label: '동점 시 공세', make: () => ({ conditions: [{ kind: 'TIME', after: 75 }, { kind: 'SCORE', state: 'DRAW' }], action: { kind: 'MENTALITY_DELTA', delta: 1 }, enabled: true }) },
  { label: '리드 시 슬롯 B', make: () => ({ conditions: [{ kind: 'TIME', after: 'HT' }, { kind: 'SCORE', state: 'LEAD', minDiff: 1 }], action: { kind: 'SWITCH_SLOT', slot: 'B' }, enabled: true }) },
  { label: '하프타임 압박 완화', make: () => ({ conditions: [{ kind: 'TIME', after: 'HT' }], action: { kind: 'HT_ADJUST', target: 'press', delta: -1 }, enabled: true }) },
];

export function PlanScreen() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const run = useAction();
  const { plan, update, replace, planState, dirty, reset } = usePlanEditor();
  const issues = useQuery((s) => (plan ? s.validatePlan(plan) : []), [plan]).data ?? [];
  const [builderOpen, setBuilderOpen] = useState(false);
  const oppId = planState?.opponentId ?? null;
  const oppSquad = useQuery((s) => (oppId ? s.getSquad(oppId) : []), [oppId]).data ?? [];
  const mySquad = useQuery((s) => s.getSquad()).data ?? [];
  const lock = usePlanLock();

  if (lock) return <Empty>{lock}</Empty>;
  if (!plan || !planState?.matchId) return <Empty>다음 경기가 없어요. 오프시즌에는 플랜을 제출하지 않아요.</Empty>;
  const club = snap.clubs[snap.userClubId];
  const opp = oppId ? snap.clubs[oppId] : undefined;
  const oo = plan.opponentOrders?.opponentId === oppId ? plan.opponentOrders : undefined;
  const setOO = (patch: Partial<NonNullable<typeof plan.opponentOrders>>) =>
    update((p) => {
      const cur = p.opponentOrders?.opponentId === oppId ? p.opponentOrders : undefined;
      const nextOO = { ...(cur ?? { opponentId: oppId as string }), ...patch };
      if (!nextOO.markTarget && !nextOO.marker && !nextOO.attackSide) {
        const { opponentOrders: _omit, ...rest } = p;
        void _omit;
        return rest;
      }
      return { ...p, opponentOrders: nextOO };
    });
  const moveCond = (i: number, d: -1 | 1) =>
    update((p) => {
      const xs = [...p.conditionals];
      const j = i + d;
      const a = xs[i];
      const b = xs[j];
      if (!a || !b) return p;
      xs[i] = b;
      xs[j] = a;
      return { ...p, conditionals: xs };
    });
  const addCond = (c: Omit<ConditionalOrder, 'id'>) => update((p) => ({ ...p, conditionals: [...p.conditionals, { ...c, id: `cond-${Date.now().toString(36)}` }].slice(0, 3) }));

  const errors = issues.filter((i) => i.severity === 'ERROR');
  const warnings = issues.filter((i) => i.severity === 'WARNING');
  const starters = plan.lineup.starters.map((id) => mySquad.find((p) => p.id === id)).filter((p) => !!p);

  return (
    <div className="screen plan">
      <Card className="card-compact">
        <div className="row-between">
          <strong>Day {planState.day} vs {opp?.name}</strong>
          {planState.preview && <span className="small muted">미제출 시: {PLAN_SOURCE_LABEL[planState.preview.source]}</span>}
        </div>
      </Card>

      <Card title="시작 전술 슬롯">
        <Segmented
          label="시작 슬롯"
          value={plan.startSlot}
          onChange={(v) => update((p) => ({ ...p, startSlot: v }))}
          options={(['A', 'B'] as SlotKey[]).map((k) => ({ value: k, label: `${k} · ${club?.tactics[k].formation ?? ''}` }))}
        />
      </Card>

      {oppId && <MatchupCard slot={plan.startSlot} oppId={oppId} />}

      <Card title="조건부 지시" extra={<span className="small muted">{plan.conditionals.length}/3 · 위에서부터 우선</span>}>
        {plan.conditionals.length === 0 && <Empty>아직 없어요. 아래 예시를 눌러 시작해 보세요.</Empty>}
        <ol className="cond-list">
          {plan.conditionals.map((c, i) => (
            <li key={c.id} className={`cond-item ${c.enabled ? '' : 'is-off'}`}>
              <div className="cond-text">
                <span className="cond-num">{i + 1}</span> 만약 {conditionalText(c)}
              </div>
              <div className="cond-actions">
                <Toggle label="사용" checked={c.enabled} onChange={(v) => update((p) => ({ ...p, conditionals: p.conditionals.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)) }))} />
                <button type="button" className="btn btn-ghost btn-icon" aria-label="위로" disabled={i === 0} onClick={() => moveCond(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="아래로" disabled={i === plan.conditionals.length - 1} onClick={() => moveCond(i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn btn-ghost btn-icon" aria-label="삭제" onClick={() => update((p) => ({ ...p, conditionals: p.conditionals.filter((x) => x.id !== c.id) }))}>
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ol>
        {plan.conditionals.length < 3 && (
          <>
            <div className="chips">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" className="chip" onClick={() => addCond(t.make())}>
                  + {t.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setBuilderOpen(true)}>
              직접 만들기
            </button>
          </>
        )}
      </Card>

      <Card title="상대 맞춤 지시" extra={<Badge>선택</Badge>}>
        <p className="small muted">이 경기 상대({opp?.shortName}) 기준. 다른 상대와 경기하면 자동으로 지워져요.</p>
        <label className="field">
          <span>집중 마크 대상 (상대)</span>
          <select value={oo?.markTarget ?? ''} onChange={(e) => setOO({ markTarget: e.target.value || undefined })}>
            <option value="">없음</option>
            {[...oppSquad].sort((a, b) => b.ovr - a.ovr).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.primary} {p.ovr})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>마커 (우리 선발)</span>
          <select value={oo?.marker ?? ''} onChange={(e) => setOO({ marker: e.target.value || undefined })}>
            <option value="">자동</option>
            {starters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.primary})
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>공략 측면</span>
          <Segmented<'none' | Exclude<Lane, 'C'>>
            label="공략 측면"
            size="sm"
            value={oo?.attackSide ?? 'none'}
            onChange={(v) => setOO({ attackSide: v === 'none' ? undefined : v })}
            options={[
              { value: 'none', label: '없음' },
              { value: 'L', label: '왼쪽' },
              { value: 'R', label: '오른쪽' },
            ]}
          />
        </div>
      </Card>

      <Card title="자동 교체·로테이션">
        <div className="field">
          <span>자동 교체 컨디션 기준: {plan.autoSubThreshold}</span>
          <Segmented
            label="자동 교체 임계치"
            size="sm"
            value={String(plan.autoSubThreshold)}
            onChange={(v) => update((p) => ({ ...p, autoSubThreshold: Number(v) }))}
            options={['45', '50', '55', '60', '65'].map((v) => ({ value: v, label: v }))}
          />
        </div>
        <Toggle label="자동 로테이션" hint="경기 전 컨디션 70 미만 선발 대체" checked={plan.autoRotation} onChange={(v) => update((p) => ({ ...p, autoRotation: v }))} />
        <label className="field">
          <span>세트피스 키커</span>
          <select value={plan.setPieceTaker ?? ''} onChange={(e) => update((p) => ({ ...p, setPieceTaker: e.target.value || undefined }))}>
            <option value="">자동</option>
            {starters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (킥 {p.attrs.kicking} · 크로스 {p.attrs.crossing})
              </option>
            ))}
          </select>
        </label>
        {!isOwner && <p className="small muted">자동 교체·로테이션·키커는 제안에 담을 수 없어요</p>}
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <Card title="제출 전 검사">
          <ul className="list compact">
            {errors.map((i, k) => (
              <li key={`e${k}`} className="list-row">
                <Badge tone="bad">오류</Badge> {i.message}
              </li>
            ))}
            {warnings.map((i, k) => (
              <li key={`w${k}`} className="list-row">
                <Badge tone="warn">주의</Badge> {i.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card tour="plan.default" title="추천·기본 플랜">
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => { const r = run((s) => s.recommendPlan()); if (r) replace(r); }}>
            추천 플랜 불러오기
          </button>
          <button type="button" className="btn btn-secondary" disabled={!isOwner} onClick={() => run((s) => s.setDefaultPlan(plan), '기본 플랜으로 저장했어요 (상대 맞춤 지시 제외)')}>
            이 플랜을 기본 플랜으로
          </button>
        </div>
        {planState.defaultPlan ? <p className="small muted">기본 플랜 지정됨 · 슬롯 {planState.defaultPlan.startSlot}</p> : <p className="small muted">기본 플랜이 없으면 직전 경기 플랜이 쓰여요</p>}
        {dirty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
            편집 취소 (저장된 플랜으로)
          </button>
        )}
      </Card>

      <PlanActions />
      <ConditionalBuilder open={builderOpen} onClose={() => setBuilderOpen(false)} onAdd={(c) => { addCond(c); setBuilderOpen(false); }} />
    </div>
  );
}

/** 상성 힌트: 상대 스타일 + 발동 예상 규칙 상위 3개 (logit 숫자 없이 S/M/L 크기만) */
function MatchupCard({ slot, oppId }: { slot: SlotKey; oppId: ClubId }) {
  const catalog = useQuery((s) => s.getCatalog()).data;
  const scout = useQuery((s) => s.getOpponentScout(oppId), [oppId]).data;
  const q = useQuery((s) => s.getMatchupPreview(slot, oppId), [slot, oppId]);
  const mp = q.data ?? null;
  const styleId = mp?.opponentStyle ?? scout?.style;
  const estimated = mp ? mp.opponentStyleEstimated : scout?.styleEstimated;
  const styleLabel = catalog?.styles?.find((x) => x.id === styleId)?.label;
  const rule = (id: string) => catalog?.rules.find((r) => r.id === id);
  return (
    <Card title="상성 힌트" extra={<span className="small muted">슬롯 {slot} 기준</span>}>
      <p>
        상대 스타일: <strong>{styleLabel ?? '알 수 없음'}</strong> {styleLabel && estimated && <Badge tone="warn">추정</Badge>}
      </p>
      {!mp ? (
        <p className="small muted">{q.error ? q.error.message : '상성 미리보기를 볼 수 없어요'}</p>
      ) : (
        <>
          <div className="edge" role="img" aria-label={`전체 판정 ${EDGE_LABEL[mp.styleEdge]}`}>
            {([-2, -1, 0, 1, 2] as const).map((v) => (
              <span key={v} className={`edge-cell ${v === mp.styleEdge ? `is-on ${v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : ''}` : ''}`} />
            ))}
          </div>
          <p className="small center">
            전체 판정: <strong>{EDGE_LABEL[mp.styleEdge]}</strong>
          </p>
          {mp.rules.length === 0 ? (
            <Empty>뚜렷하게 발동할 규칙이 없어요</Empty>
          ) : (
            <ul className="factor-list">
              {mp.rules.slice(0, 3).map((h, i) => (
                <li key={`${h.id}-${h.dp}-${i}`} className={`factor factor-${h.sign > 0 ? 'us' : 'them'}`}>
                  <div className="row-between">
                    <strong>
                      {h.sign > 0 ? '▲ 우리 유리' : '▼ 상대 유리'} · {rule(h.id)?.label ?? h.id}
                    </strong>
                    <span className="size-meter" role="img" aria-label={`영향 ${SIZE_LABEL[h.size]}`}>
                      <span className={`size-fill size-${h.size} ${h.sign > 0 ? 'is-pos' : 'is-neg'}`} />
                    </span>
                  </div>
                  <div>{h.reason}</div>
                  <div className="small muted">
                    영향 {SIZE_LABEL[h.size]}
                    {h.sign < 0 && rule(h.id)?.counter ? ` · 대응: ${rule(h.id)?.counter}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function ConditionalBuilder({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (c: Omit<ConditionalOrder, 'id'>) => void }) {
  const [time, setTime] = useState<TimeOpt>('75');
  const [score, setScore] = useState<ScoreOpt>('TRAIL');
  const [diff, setDiff] = useState<'1' | '2'>('1');
  const [act, setAct] = useState<ActOpt>('M+1');
  const isHT = time === 'HT';
  const actIsHT = act.startsWith('HT_');
  const conditions: TriggerCondition[] = [];
  if (time !== 'none') conditions.push({ kind: 'TIME', after: time === 'HT' ? 'HT' : (Number(time) as 45 | 60 | 75) });
  if (score !== 'none') conditions.push(score === 'DRAW' ? { kind: 'SCORE', state: 'DRAW' } : { kind: 'SCORE', state: score, minDiff: Number(diff) });
  const action: TriggerAction =
    act === 'SLOT_A' ? { kind: 'SWITCH_SLOT', slot: 'A' }
    : act === 'SLOT_B' ? { kind: 'SWITCH_SLOT', slot: 'B' }
    : act.startsWith('M') ? { kind: 'MENTALITY_DELTA', delta: Number(act.slice(1)) as -2 | -1 | 1 | 2 }
    : { kind: 'HT_ADJUST', target: act.includes('TEMPO') ? 'tempo' : 'press', delta: act.endsWith('+') ? 1 : -1 };
  const valid = conditions.length > 0 && (!actIsHT || isHT);
  const preview: ConditionalOrder = { id: 'preview', conditions, action, enabled: true };

  return (
    <Sheet
      open={open}
      title="조건부 지시 만들기"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={!valid} onClick={() => onAdd({ conditions, action, enabled: true })}>
          추가
        </button>
      }
    >
      <div className="field">
        <span>조건 1 · 시간</span>
        <Segmented label="시간 조건" size="sm" value={time} onChange={setTime} options={[{ value: 'none', label: '없음' }, { value: 'HT', label: '하프타임' }, { value: '45', label: '45′' }, { value: '60', label: '60′' }, { value: '75', label: '75′' }]} />
      </div>
      <div className="field">
        <span>조건 2 · 스코어 (그리고)</span>
        <Segmented label="스코어 조건" size="sm" value={score} onChange={setScore} options={[{ value: 'none', label: '없음' }, { value: 'LEAD', label: '이기고' }, { value: 'DRAW', label: '비기고' }, { value: 'TRAIL', label: '지고' }]} />
        {(score === 'LEAD' || score === 'TRAIL') && (
          <Segmented label="점수 차" size="sm" value={diff} onChange={setDiff} options={[{ value: '1', label: '1골 차 이상' }, { value: '2', label: '2골 차 이상' }]} />
        )}
      </div>
      <div className="field">
        <span>행동</span>
        <div className="chips">
          {(
            [
              ['SLOT_A', '슬롯 A로 전환'], ['SLOT_B', '슬롯 B로 전환'], ['M+1', '공격 성향 +1'], ['M+2', '공격 성향 +2'], ['M-1', '공격 성향 −1'], ['M-2', '공격 성향 −2'],
              ['HT_TEMPO+', '템포 +1 (하프타임)'], ['HT_TEMPO-', '템포 −1 (하프타임)'], ['HT_PRESS+', '압박 +1 (하프타임)'], ['HT_PRESS-', '압박 −1 (하프타임)'],
            ] as [ActOpt, string][]
          ).map(([v, l]) => {
            const disabled = v.startsWith('HT_') && !isHT;
            return (
              <button key={v} type="button" className={`chip ${act === v ? 'is-active' : ''}`} aria-pressed={act === v} disabled={disabled} title={disabled ? '하프타임 조건을 골라야 쓸 수 있어요' : undefined} onClick={() => setAct(v)}>
                {l}
              </button>
            );
          })}
        </div>
      </div>
      <p className="summary-box">{valid ? `요약: 만약 ${conditionalText(preview)}` : conditions.length === 0 ? '조건을 하나 이상 골라 주세요' : '하프타임 조정은 하프타임 조건과만 쓸 수 있어요'}</p>
    </Sheet>
  );
}
