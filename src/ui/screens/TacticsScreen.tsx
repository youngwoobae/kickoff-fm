/** T03 팀 전술: 슬롯 A/B, 프리셋, 포메이션, 역할, 6 슬라이더 + 토글 2 (소유: B) */
import { useEffect, useMemo, useState } from 'react';
import type { FormationId, PresetId, RoleId, SlotKey, TacticSlot, TeamInstructions } from '../../types';
import { Badge, Card, Meter, Segmented, StepSlider, StickyActions, Toggle } from '../components/kit';
import { INSTR_LABEL, POS_LABEL, SLIDERS, stepText } from '../format';
import { ProposeSheet } from '../plan/PlanActions';
import { useAction, useGame, useIsOwner, useQuery } from '../service/ServiceContext';

type Draft = Omit<TacticSlot, 'familiarity' | 'key'>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function TacticsScreen() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const run = useAction();
  const catalog = useQuery((s) => s.getCatalog()).data;
  const next = useQuery((s) => s.getNextMatch()).data;
  const [slotKey, setSlotKey] = useState<SlotKey>('A');
  const club = snap.clubs[snap.userClubId];
  const saved = club?.tactics[slotKey];
  const [draft, setDraft] = useState<Draft | null>(saved ? strip(saved) : null);
  const [proposeOpen, setProposeOpen] = useState(false);

  // 슬롯 전환·서버 변경 시 편집본 동기화
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(saved ? strip(saved) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, savedKey]);

  const formation = useMemo(() => catalog?.formations.find((f) => f.id === draft?.formation), [catalog, draft?.formation]);
  if (!club || !saved || !draft || !catalog) return null;

  const dirty = !same(strip(saved), draft);
  const formationChanged = draft.formation !== saved.formation;
  const preset = catalog.presets.find((p) => same(p.instructions, draft.instructions));
  const changes = (Object.keys(draft.instructions) as (keyof TeamInstructions)[]).filter((k) => draft.instructions[k] !== saved.instructions[k]);

  const setInstr = (patch: Partial<TeamInstructions>) =>
    setDraft((d) => {
      if (!d) return d;
      const instructions = { ...d.instructions, ...patch };
      if (instructions.line < 1) instructions.offsideTrap = false;
      return { ...d, instructions };
    });
  const setFormation = (id: FormationId) => {
    const f = catalog.formations.find((x) => x.id === id);
    if (!f) return;
    setDraft((d) => (d ? { ...d, formation: id, roles: f.slots.map((s) => s.defaultRole) } : d));
  };
  const setPreset = (id: PresetId) => {
    const p = catalog.presets.find((x) => x.id === id);
    if (p) setDraft((d) => (d ? { ...d, instructions: { ...p.instructions } } : d));
  };
  const setRole = (i: number, r: RoleId) => setDraft((d) => (d ? { ...d, roles: d.roles.map((x, j) => (j === i ? r : x)) } : d));

  const save = () =>
    run((s) => s.updateTacticSlot(slotKey, draft), (r) => (r.familiarityHalved ? `저장했어요. 포메이션 변경으로 숙련도 ${Math.round(saved.familiarity)} → ${Math.round(r.slot.familiarity)}` : '팀 전술을 저장했어요'));

  const instrPatch: Partial<TeamInstructions> = Object.fromEntries(changes.map((k) => [k, draft.instructions[k]]));

  return (
    <div className="screen tactics">
      <Segmented
        label="전술 슬롯"
        value={slotKey}
        onChange={setSlotKey}
        options={[
          { value: 'A', label: `슬롯 A · ${club.tactics.A.formation}` },
          { value: 'B', label: `슬롯 B · ${club.tactics.B.formation}` },
        ]}
      />
      <Card className="card-compact">
        <div className="row-between small">
          <span>숙련도 {Math.round(saved.familiarity)}</span>
          {formationChanged && <Badge tone="warn">저장 시 숙련도 {Math.round(saved.familiarity)} → {Math.round(saved.familiarity * 0.5)}</Badge>}
        </div>
        <Meter value={saved.familiarity / 100} label="슬롯 숙련도" tone={saved.familiarity >= 60 ? 'good' : saved.familiarity >= 30 ? 'warn' : 'bad'} />
      </Card>

      <Card title="프리셋" extra={<span className="small muted">{preset ? preset.label : '사용자 지정'}</span>}>
        <div className="chips">
          {catalog.presets.map((p) => (
            <button key={p.id} type="button" className={`chip ${preset?.id === p.id ? 'is-active' : ''}`} aria-pressed={preset?.id === p.id} onClick={() => setPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="small muted">프리셋은 팀 지시만 바꿔서 숙련도가 줄지 않아요</p>
      </Card>

      <Card title="포메이션">
        <div className="chips">
          {catalog.formations.map((f) => (
            <button key={f.id} type="button" className={`chip ${draft.formation === f.id ? 'is-active' : ''}`} aria-pressed={draft.formation === f.id} onClick={() => setFormation(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="선수 역할">
        <ul className="role-list">
          {formation?.slots.map((fs) => (
            <li key={fs.index}>
              <span className="slot-pos">{POS_LABEL[fs.position]}</span>
              <select aria-label={`${fs.index + 1}번 자리 ${POS_LABEL[fs.position]} 역할`} value={draft.roles[fs.index]} onChange={(e) => setRole(fs.index, e.target.value as RoleId)}>
                {fs.allowedRoles.map((r) => (
                  <option key={r} value={r}>
                    {catalog.roles.find((x) => x.id === r)?.label ?? r}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="팀 지시">
        {SLIDERS.map((s) => (
          <StepSlider key={s.key} label={s.label} low={s.low} high={s.high} value={draft.instructions[s.key]} changed={draft.instructions[s.key] !== saved.instructions[s.key]} onChange={(v) => setInstr({ [s.key]: v })} />
        ))}
        <Toggle label="역습" hint="공을 뺏으면 빠르게 전진" checked={draft.instructions.counter} onChange={(v) => setInstr({ counter: v })} />
        <Toggle label="오프사이드 트랩" hint="수비 라인 +1 이상에서만" checked={draft.instructions.offsideTrap} disabled={draft.instructions.line < 1} onChange={(v) => setInstr({ offsideTrap: v })} />
      </Card>

      {changes.length > 0 && (
        <Card title={`변경 사항 ${changes.length}개`}>
          <ul className="list compact">
            {changes.map((k) => (
              <li key={k} className="list-row">
                <span>{INSTR_LABEL[k]}</span>
                <span>
                  {fmt(saved.instructions[k])} → <strong>{fmt(draft.instructions[k])}</strong>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isOwner ? (
        <StickyActions note={dirty ? '저장하지 않은 변경이 있어요' : '팀 지시는 구단 슬롯에 저장되어 모든 경기 플랜에 쓰여요'}>
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setDraft(strip(saved))}>
            되돌리기
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty} onClick={save}>
            전술 저장
          </button>
        </StickyActions>
      ) : (
        <>
          <StickyActions note={formationChanged || !same(draft.roles, saved.roles) ? '코치 제안은 팀 지시만 담을 수 있어요 (포메이션·역할 제외)' : '코치는 팀 지시 변경을 제안할 수 있어요'}>
            <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => setDraft(strip(saved))}>
              되돌리기
            </button>
            <button type="button" className="btn btn-primary" disabled={changes.length === 0 || !next} onClick={() => setProposeOpen(true)}>
              지시 변경 제안
            </button>
          </StickyActions>
          <ProposeSheet open={proposeOpen} onClose={() => setProposeOpen(false)} patch={{ instructions: { slot: slotKey, patch: instrPatch } }} title="팀 지시 변경 제안" />
        </>
      )}
    </div>
  );
}

function strip(t: TacticSlot): Draft {
  return { formation: t.formation, roles: [...t.roles], instructions: { ...t.instructions } };
}
function fmt(v: unknown): string {
  return typeof v === 'boolean' ? (v ? '켬' : '끔') : stepText(v as number);
}
