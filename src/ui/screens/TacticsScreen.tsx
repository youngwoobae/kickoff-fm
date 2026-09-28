/** T03 팀 전술: 슬롯 A/B, 스타일 9종, 포메이션, 역할, 6 슬라이더 + 토글 2 (소유: B) */
import { useEffect, useMemo, useState } from 'react';
import type { FormationId, Player, PresetDef, PresetId, RoleDef, RoleId, RuleDef, SlotKey, StyleDef, StyleFit, TacticSlot, TeamInstructions } from '../../types';
import type { StyleApplyMode } from '../../services';
import { Badge, Card, Meter, Segmented, Sheet, Stars, StepSlider, StickyActions, Toggle } from '../components/kit';
import { FIT_LEVEL_LABEL, FIT_LEVEL_TONE, INSTR_LABEL, POS_LABEL, SLIDERS, nearestStyle, roleFit, stepText } from '../format';
import { ProposeSheet } from '../plan/PlanActions';
import { useAction, useGame, useIsOwner, useQuery, useService } from '../service/ServiceContext';

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
  const [styleOpen, setStyleOpen] = useState<StyleDef | null>(null);
  const [roleSlot, setRoleSlot] = useState<number | null>(null);
  const service = useService();
  const squad = useQuery((s) => s.getSquad()).data;
  const resolved = useQuery((s) => s.previewResolvedPlan()).data;

  // 슬롯 전환·서버 변경 시 편집본 동기화
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(saved ? strip(saved) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, savedKey]);

  const formation = useMemo(() => catalog?.formations.find((f) => f.id === draft?.formation), [catalog, draft?.formation]);
  const roleById = useMemo(() => new Map((catalog?.roles ?? []).map((r) => [r.id, r])), [catalog]);
  if (!club || !saved || !draft || !catalog) return null;

  const dirty = !same(strip(saved), draft);
  const formationChanged = draft.formation !== saved.formation;
  // 역할 적합 ★ 은 "다음 경기 선발이 이 슬롯 포메이션으로 선다" 는 전제에서만 정확하다
  const byId = new Map((squad ?? []).map((p) => [p.id, p]));
  const slotPlayers: (Player | undefined)[] =
    resolved && resolved.plan.startSlot === slotKey && !formationChanged ? resolved.plan.lineup.starters.map((id) => byId.get(id)) : [];
  const near = nearestStyle(catalog.styles ?? [], draft.instructions);
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

  const applyStyle = (st: StyleDef, mode: StyleApplyMode) => {
    setStyleOpen(null);
    if (isOwner && service.applyStyle) {
      run(
        (s) => s.applyStyle!(slotKey, st.id, mode),
        (r) => r.warning ?? (mode === 'FULL' ? `${st.label}: 포메이션·역할·지시를 적용했어요` : `${st.label}: 팀 지시를 적용했어요 (숙련도 유지)`),
      );
      return;
    }
    // 폴백(메서드 없음·코치): 편집본에만 반영 → 저장/제안 버튼으로 확정
    setDraft((d) =>
      d ? (mode === 'FULL' ? { formation: st.formation, roles: [...st.roles], instructions: { ...st.instructions } } : { ...d, instructions: { ...st.instructions } }) : d,
    );
  };

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
          {near && <span className="muted">{near.exact ? near.style.label : `사용자 지정 (가장 가까운: ${near.style.label})`}</span>}
          {formationChanged && <Badge tone="warn">저장 시 숙련도 {Math.round(saved.familiarity)} → {Math.round(saved.familiarity * 0.5)}</Badge>}
        </div>
        <Meter value={saved.familiarity / 100} label="슬롯 숙련도" tone={saved.familiarity >= 60 ? 'good' : saved.familiarity >= 30 ? 'warn' : 'bad'} />
      </Card>

      <StylePicker
        styles={catalog.styles ?? []}
        instructions={draft.instructions}
        onOpen={setStyleOpen}
        fallbackPresets={catalog.presets}
        onPreset={setPreset}
      />

      <Card title="포메이션">
        <div className="chips">
          {catalog.formations.map((f) => (
            <button key={f.id} type="button" className={`chip ${draft.formation === f.id ? 'is-active' : ''}`} aria-pressed={draft.formation === f.id} onClick={() => setFormation(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title="선수 역할" extra={<span className="small muted">탭해서 역할 바꾸기</span>}>
        <ul className="role-list">
          {formation?.slots.map((fs) => {
            const role = roleById.get(draft.roles[fs.index] ?? fs.defaultRole);
            const p = slotPlayers[fs.index];
            const fit = p && role ? roleFit(p, role.keyAttrs) : undefined;
            return (
              <li key={fs.index}>
                <span className="slot-pos">{POS_LABEL[fs.position]}</span>
                <button type="button" className="role-btn" onClick={() => setRoleSlot(fs.index)} aria-label={`${fs.index + 1}번 자리 ${POS_LABEL[fs.position]} 역할 ${role?.label ?? ''} 바꾸기`}>
                  <span>{role?.label ?? draft.roles[fs.index]}</span>
                  {p && fit && (
                    <span className="small muted">
                      {p.name} <Stars n={fit.stars} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {slotPlayers.length === 0 && <p className="small muted">선수별 역할 적합 ★은 이 슬롯이 다음 경기 시작 슬롯이고 포메이션을 바꾸지 않았을 때 보여요</p>}
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
      <StyleSheet
        style={styleOpen}
        onClose={() => setStyleOpen(null)}
        styles={catalog.styles ?? []}
        rules={catalog.rules}
        familiarity={saved.familiarity}
        currentFormation={saved.formation}
        canFull={isOwner}
        dirty={dirty}
        onApply={applyStyle}
      />
      {roleSlot !== null && formation?.slots[roleSlot] && (
        <RoleSheet
          allowed={formation.slots[roleSlot].allowedRoles.map((r) => roleById.get(r)).filter((r): r is RoleDef => !!r)}
          current={draft.roles[roleSlot]}
          recommended={near && near.style.formation === draft.formation ? near.style.roles[roleSlot] : undefined}
          player={slotPlayers[roleSlot]}
          title={`${roleSlot + 1}번 자리 · ${POS_LABEL[formation.slots[roleSlot].position]} 역할`}
          onPick={(r) => {
            setRole(roleSlot, r);
            setRoleSlot(null);
          }}
          onClose={() => setRoleSlot(null)}
        />
      )}
    </div>
  );
}

function StylePicker({
  styles,
  instructions,
  onOpen,
  fallbackPresets,
  onPreset,
}: {
  styles: StyleDef[];
  instructions: TeamInstructions;
  onOpen: (s: StyleDef) => void;
  fallbackPresets: PresetDef[];
  onPreset: (id: PresetId) => void;
}) {
  const fits = useQuery((s) => s.getStyleFits?.() ?? null).data ?? null;
  if (styles.length === 0) {
    // 목 서비스 호환: styles 가 없으면 기존 프리셋 칩
    const cur = fallbackPresets.find((p) => same(p.instructions, instructions));
    return (
      <Card title="프리셋" extra={<span className="small muted">{cur ? cur.label : '사용자 지정'}</span>}>
        <div className="chips">
          {fallbackPresets.map((p) => (
            <button key={p.id} type="button" className={`chip ${cur?.id === p.id ? 'is-active' : ''}`} aria-pressed={cur?.id === p.id} onClick={() => onPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </Card>
    );
  }
  return (
    <Card title="전술 스타일" extra={<span className="small muted">탭하면 상세·적용</span>}>
      <div className="style-grid">
        {styles.map((st) => {
          const active = same(st.instructions, instructions);
          return (
            <button key={st.id} type="button" className={`style-card ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={() => onOpen(st)}>
              <span className="style-name">
                {st.label} {active && <Badge tone="accent">현재</Badge>}
              </span>
              <span className="small">{st.summary}</span>
              <span className="small muted">
                {st.formation} · <Stamina n={st.staminaCost} />
              </span>
              <FitLine fit={fits?.find((f) => f.styleId === st.id)} />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function Stamina({ n }: { n: number }) {
  return (
    <span role="img" aria-label={`체력 비용 ${n}/4`}>
      {'⚡'.repeat(n)}
      <span className="stamina-off">{'⚡'.repeat(4 - n)}</span>
    </span>
  );
}

function FitLine({ fit, full }: { fit: StyleFit | undefined; full?: boolean }) {
  if (!fit) return <span className="small muted">스쿼드 적합도 정보 없음</span>;
  const miss = full ? fit.missing : fit.missing.slice(0, 2);
  return (
    <span className="small">
      <Badge tone={FIT_LEVEL_TONE[fit.level]}>
        적합 {Math.round(fit.fit * 100)}% · {FIT_LEVEL_LABEL[fit.level]}
      </Badge>
      {miss.length > 0 && <span className="muted"> 부족: {miss.map((m) => (full ? `${m.label} (현재 ${Math.round(m.actual)} / 필요 ${m.required})` : m.label)).join(', ')}</span>}
    </span>
  );
}

function StyleSheet({
  style,
  onClose,
  styles,
  rules,
  familiarity,
  currentFormation,
  canFull,
  dirty,
  onApply,
}: {
  style: StyleDef | null;
  onClose: () => void;
  styles: StyleDef[];
  rules: RuleDef[];
  familiarity: number;
  currentFormation: FormationId;
  canFull: boolean;
  dirty: boolean;
  onApply: (s: StyleDef, mode: StyleApplyMode) => void;
}) {
  const [confirmFull, setConfirmFull] = useState(false);
  const fits = useQuery((s) => s.getStyleFits?.() ?? null).data ?? null;
  useEffect(() => setConfirmFull(false), [style]);
  if (!style) return null;
  const halves = style.formation !== currentFormation;
  const ruleName = (id: string) => rules.find((r) => r.id === id)?.label ?? id;
  const styleName = (id: string) => styles.find((s) => s.id === id)?.label ?? id;
  const halfText = `포메이션 ${currentFormation} → ${style.formation}, 숙련도 ${Math.round(familiarity)} → ${Math.round(familiarity * 0.5)}`;
  return (
    <Sheet
      open
      title={style.label}
      onClose={onClose}
      footer={
        confirmFull ? (
          <div className="confirm-box" role="alert">
            <p>
              <strong>⚠ 숙련도가 절반이 돼요.</strong> {halfText}
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmFull(false)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onApply(style, 'FULL')}>
                그래도 적용
              </button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={() => onApply(style, 'INSTRUCTIONS_ONLY')}>
              지시만 적용
            </button>
            <button type="button" className="btn btn-primary" disabled={!canFull} onClick={() => (halves ? setConfirmFull(true) : onApply(style, 'FULL'))}>
              포메이션·역할까지 적용
            </button>
          </div>
        )
      }
    >
      <p className="small muted">실제 모델: {style.realModel}</p>
      <p>{style.principle}</p>
      <p className="small">
        권장 포메이션 <strong>{style.formation}</strong> · 체력 비용 <Stamina n={style.staminaCost} /> {style.staminaCost}/4 (경기당 +{style.drainExtra})
      </p>
      <FitLine fit={fits?.find((f) => f.styleId === style.id)} full />
      <h3 className="h3">강점</h3>
      <div className="chips">
        {style.strengths.map((r) => (
          <Badge key={r} tone="good">
            ▲ {ruleName(r)}
          </Badge>
        ))}
      </div>
      <h3 className="h3">약점</h3>
      <div className="chips">
        {style.weaknesses.map((r) => (
          <Badge key={r} tone="bad">
            ▼ {ruleName(r)}
          </Badge>
        ))}
      </div>
      <p className="small">
        <strong>잘 통하는 상대:</strong> {style.goodAgainst.map(styleName).join(', ') || '없음'}
      </p>
      <p className="small">
        <strong>조심할 상대:</strong> {style.badAgainst.map(styleName).join(', ') || '없음'}
      </p>
      <p className="small muted">
        "지시만 적용"은 숙련도를 유지해요. "포메이션·역할까지"는 {halves ? `숙련도가 절반이 돼요 (${halfText}).` : '포메이션이 같아 숙련도가 유지돼요.'}
        {!canFull && ' 코치는 지시만 바꿔 제안할 수 있어요.'}
        {dirty && ' 저장하지 않은 편집은 덮어써져요.'}
      </p>
    </Sheet>
  );
}

function RoleSheet({
  allowed,
  current,
  recommended,
  player,
  title,
  onPick,
  onClose,
}: {
  allowed: RoleDef[];
  current: RoleId | undefined;
  recommended: RoleId | undefined;
  player: Player | undefined;
  title: string;
  onPick: (r: RoleId) => void;
  onClose: () => void;
}) {
  const attrs = useQuery((s) => s.getCatalog().attributes).data ?? [];
  const attrLabel = (k: string) => attrs.find((a) => a.key === k)?.label ?? k;
  return (
    <Sheet open title={title} onClose={onClose}>
      {player && <p className="small muted">★ = {player.name} 의 역할 핵심 능력 평균 (1~20 → 5단계)</p>}
      <ul className="list">
        {allowed.map((r) => {
          const fit = player ? roleFit(player, r.keyAttrs) : undefined;
          return (
            <li key={r.id}>
              <button type="button" className={`role-opt ${r.id === current ? 'is-active' : ''}`} aria-pressed={r.id === current} onClick={() => onPick(r.id)}>
                <span className="row-between">
                  <strong>
                    {r.label} {r.id === recommended && <Badge tone="accent">권장</Badge>} {r.id === current && <Badge>현재</Badge>}
                  </strong>
                  {fit && (
                    <span className="small">
                      <Stars n={fit.stars} /> {fit.avg.toFixed(1)}
                    </span>
                  )}
                </span>
                <span className="small">경기에서 하는 일: {r.effect ?? r.summary}</span>
                <span className="small muted">
                  핵심 능력 {r.keyAttrs.map(attrLabel).join(' · ')}
                  {r.drainExtra ? ` · 체력 소모 ${r.drainExtra > 0 ? '+' : '−'}${Math.abs(r.drainExtra)}` : ''}
                </span>
                {r.fitsIn && <span className="small muted">어울림: {r.fitsIn}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function strip(t: TacticSlot): Draft {
  return { formation: t.formation, roles: [...t.roles], instructions: { ...t.instructions } };
}
function fmt(v: unknown): string {
  return typeof v === 'boolean' ? (v ? '켬' : '끔') : stepText(v as number);
}
