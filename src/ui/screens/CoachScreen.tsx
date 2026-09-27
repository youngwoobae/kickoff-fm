/** C05 코치실: 역할 전환, 제안 작성(코치) → 승인/거절(구단주), 활동 기록 (소유: B) */
import { useState } from 'react';
import type { Membership, PlanChangePatch, Proposal, SlotKey, Step, TeamInstructions } from '../../types';
import { Badge, Card, Empty, Segmented, Sheet, StepSlider } from '../components/kit';
import { INSTR_LABEL, PROPOSAL_STATUS_LABEL, SLIDERS, seatLabel, type SliderKey } from '../format';
import { ProposeSheet } from '../plan/PlanActions';
import { useToast } from '../components/Toast';
import { useAction, useActor, useGame, useQuery } from '../service/ServiceContext';

const REJECT_REASONS = ['이번 경기엔 안 맞음', '다른 제안과 겹침', '선수 컨디션 고려', '기타'];

export function CoachScreen() {
  const snap = useGame();
  const actor = useActor();
  const run = useAction();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const list = useQuery((s) => s.listProposals(filter === 'OPEN' ? { status: 'OPEN' } : {}), [filter]).data ?? [];
  const seat = actor?.seat ?? 'OWNER';

  return (
    <div className="screen coach">
      <Card title="역할 전환 (로컬 시연)">
        <Segmented
          label="현재 역할"
          value={seat === 'OWNER' ? 'OWNER' : 'COACH'}
          onChange={(v) => run((s) => s.switchRole(v), (m) => `${m.seat === 'OWNER' ? '구단주' : '전술 코치'}로 전환했어요`)}
          options={[
            { value: 'OWNER', label: '👑 구단주' },
            { value: 'COACH', label: '🧢 전술 코치' },
          ]}
        />
        <p className="small muted">
          {seat === 'OWNER'
            ? '구단주는 플랜·전술을 직접 바꾸고, 코치 제안을 승인하거나 거절해요.'
            : '코치는 편집 대신 제안을 보내요. 선발·경기 플랜·전술 화면의 "제안하기" 버튼이나 아래 빠른 제안을 쓰세요.'}
        </p>
      </Card>

      {seat === 'COACH' && <QuickProposal />}

      <div className="row-between">
        <h3 className="h3">제안함</h3>
        <Segmented label="제안 필터" size="sm" value={filter} onChange={setFilter} options={[{ value: 'OPEN', label: '대기' }, { value: 'ALL', label: '전체' }]} />
      </div>
      {list.length === 0 ? <Empty>{filter === 'OPEN' ? '대기 중인 제안이 없어요' : '제안 기록이 없어요'}</Empty> : list.map((p) => <ProposalCard key={p.id} p={p} seat={seat} />)}

      <Card title="활동 기록">
        <ActivityLog entries={snap.actionLog} memberships={snap.memberships} />
      </Card>
    </div>
  );
}

function QuickProposal() {
  const snap = useGame();
  const next = useQuery((s) => s.getNextMatch()).data;
  const [slot, setSlot] = useState<SlotKey>('A');
  const club = snap.clubs[snap.userClubId];
  const base = club?.tactics[slot].instructions;
  const [vals, setVals] = useState<Partial<Record<SliderKey, Step>>>({});
  const [open, setOpen] = useState(false);
  if (!base) return null;
  const patch: Partial<TeamInstructions> = Object.fromEntries(Object.entries(vals).filter(([k, v]) => base[k as SliderKey] !== v));
  const count = Object.keys(patch).length;
  return (
    <Card title="빠른 제안: 팀 지시">
      {!next ? (
        <Empty>다음 경기가 없어 제안할 수 없어요</Empty>
      ) : (
        <>
          <Segmented label="대상 슬롯" size="sm" value={slot} onChange={(v) => { setSlot(v); setVals({}); }} options={[{ value: 'A', label: '슬롯 A' }, { value: 'B', label: '슬롯 B' }]} />
          {SLIDERS.map((s) => (
            <StepSlider key={s.key} label={s.label} low={s.low} high={s.high} value={vals[s.key] ?? base[s.key]} changed={(vals[s.key] ?? base[s.key]) !== base[s.key]} onChange={(v) => setVals((x) => ({ ...x, [s.key]: v }))} />
          ))}
          <button type="button" className="btn btn-primary btn-block" disabled={count === 0} onClick={() => setOpen(true)}>
            변경 {count}건 제안하기
          </button>
          <ProposeSheet
            open={open}
            onClose={() => {
              setOpen(false);
              setVals({});
            }}
            patch={{ instructions: { slot, patch } }}
            title="팀 지시 변경 제안"
          />
        </>
      )}
    </Card>
  );
}

function ProposalCard({ p, seat }: { p: Proposal; seat: string }) {
  const snap = useGame();
  const run = useAction();
  const toast = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [stale, setStale] = useState<string[] | null>(null);
  const opp = (() => {
    const f = snap.fixtures.find((x) => x.id === p.payload.matchId);
    if (!f) return '';
    const oppId = f.homeId === snap.userClubId ? f.awayId : f.homeId;
    return snap.clubs[oppId]?.name ?? '';
  })();
  const isOpen = p.status === 'OPEN';
  const approve = (edits?: PlanChangePatch) => {
    const r = run((s) => s.approve(p.id, edits), (res) => (res.ok ? `승인했어요. 구단주 명의로 확정 제출됨${res.superseded.length ? ` (대체된 제안 ${res.superseded.length}건)` : ''}` : undefined));
    if (!r) return;
    if (r.ok) setStale(null);
    else {
      // STALE 제안은 OPEN 필터에서 바로 사라지므로 카드 안 문구만으로는 보이지 않는다 → 토스트로 알린다
      setStale(r.details);
      toast.show(`재검증 실패로 무효 처리: ${r.details.join(', ')}`, 'error');
    }
  };
  const myReaction = p.reactions.find((r) => r.userId === snap.actorUserId)?.choice;

  return (
    <Card
      className={`proposal ${isOpen ? '' : 'is-closed'}`}
      title={
        <>
          제안 · 전술 코치 · Day {p.createdAt.day}
        </>
      }
      extra={<Badge tone={p.status === 'APPROVED' ? 'good' : p.status === 'OPEN' ? 'accent' : p.status === 'REJECTED' || p.status === 'STALE' ? 'bad' : 'neutral'}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge>}
    >
      <p className="small muted">
        대상: Day {p.expiresAt.day} 경기 플랜{opp && ` (vs ${opp})`} · 마감 시 만료
      </p>
      <p className="small">변경 {p.diff.length}건</p>
      <ul className="diff-list">
        {p.diff.map((d) => (
          <li key={d.path}>
            · {d.label} <span className="muted">{d.before}</span> → <strong>{d.after}</strong>
          </li>
        ))}
      </ul>
      <p className="reason">이유: “{p.reason}”</p>
      {p.reactions.length > 0 && (
        <p className="small muted">
          반응: {p.reactions.map((r) => `${r.choice === 'FOR' ? '👍' : '👎'}${r.reason ? ` ${r.reason}` : ''}`).join(' · ')}
        </p>
      )}
      {p.resolutionNote && <p className="small muted">처리 메모: {p.resolutionNote}</p>}
      {stale && <p className="warn-line">재검증 실패로 무효 처리: {stale.join(', ')}</p>}
      {isOpen && seat === 'OWNER' && (
        <div className="btn-row three">
          <button type="button" className="btn btn-ghost" onClick={() => setRejectOpen(true)}>
            거절
          </button>
          <button type="button" className="btn btn-secondary" disabled={!p.payload.patch.instructions} title={p.payload.patch.instructions ? undefined : '팀 지시 제안만 수정 후 승인할 수 있어요'} onClick={() => setEditOpen(true)}>
            수정 후 승인
          </button>
          <button type="button" className="btn btn-primary" onClick={() => approve()}>
            승인
          </button>
        </div>
      )}
      {isOpen && seat === 'COACH' && (
        <div className="btn-row">
          <button type="button" className={`btn ${myReaction === 'FOR' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => run((s) => s.react(p.id, 'FOR'), '찬성했어요')}>
            👍 찬성
          </button>
          <button type="button" className={`btn ${myReaction === 'AGAINST' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => run((s) => s.react(p.id, 'AGAINST', '다른 방안 검토 필요'), '반대했어요')}>
            👎 반대
          </button>
        </div>
      )}
      <Sheet open={rejectOpen} title="거절 사유" onClose={() => setRejectOpen(false)}>
        <div className="chips">
          {REJECT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className="chip"
              onClick={() => {
                run((s) => s.reject(p.id, r), '제안을 거절했어요');
                setRejectOpen(false);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </Sheet>
      {editOpen && p.payload.patch.instructions && (
        <EditApproveSheet
          p={p}
          onClose={() => setEditOpen(false)}
          onApprove={(edits) => {
            approve(edits);
            setEditOpen(false);
          }}
        />
      )}
    </Card>
  );
}

function EditApproveSheet({ p, onClose, onApprove }: { p: Proposal; onClose: () => void; onApprove: (edits: PlanChangePatch) => void }) {
  const snap = useGame();
  const ins = p.payload.patch.instructions;
  const [vals, setVals] = useState<Partial<TeamInstructions>>(ins?.patch ?? {});
  if (!ins) return null;
  const base = snap.clubs[snap.userClubId]?.tactics[ins.slot].instructions;
  const keys = Object.keys(ins.patch).filter((k): k is SliderKey => SLIDERS.some((s) => s.key === k));
  return (
    <Sheet
      open
      title={`수정 후 승인 · 슬롯 ${ins.slot}`}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={() => onApprove({ ...p.payload.patch, instructions: { slot: ins.slot, patch: vals } })}>
          수정한 내용으로 승인
        </button>
      }
    >
      {keys.length === 0 && <p className="muted">슬라이더 항목이 없는 제안입니다</p>}
      {keys.map((k) => {
        const s = SLIDERS.find((x) => x.key === k);
        if (!s) return null;
        return <StepSlider key={k} label={`${INSTR_LABEL[k]} (현재 ${base?.[k] ?? 0})`} low={s.low} high={s.high} value={(vals[k] as Step | undefined) ?? 0} onChange={(v) => setVals((x) => ({ ...x, [k]: v }))} />;
      })}
    </Sheet>
  );
}

const LOG_LABEL: Record<string, string> = {
  PLAN_DRAFT_SAVED: '플랜 초안 저장',
  PLAN_SUBMITTED: '플랜 확정 제출',
  PLAN_RECOMMENDED_SUBMITTED: '추천 플랜 제출',
  DEFAULT_PLAN_SET: '기본 플랜 지정',
  TACTIC_CHANGED: '팀 전술 변경',
  ROLE_SWITCHED: '역할 전환',
  PROPOSAL_CREATED: '제안 작성',
  PROPOSAL_REACTED: '제안 반응',
  PROPOSAL_APPROVED: '제안 승인',
  PROPOSAL_REJECTED: '제안 거절',
  PROPOSAL_EXPIRED: '제안 만료',
  DAY_ADVANCED: '다음 날로',
  SEASON_STARTED: '새 시즌',
  REPORT_VIEWED: '리포트 열람',
  REPLAY_VIEWED: '중계 열람',
  SCOUT_VIEWED: '상대 분석 열람',
  SESSION_START: '세션 시작',
  SESSION_END: '세션 종료',
  MANUAL_ROTATION: '수동 로테이션',
};
const HIDDEN = new Set(['SESSION_START', 'SESSION_END', 'REPORT_VIEWED', 'REPLAY_VIEWED', 'SCOUT_VIEWED']);

function ActivityLog({ entries, memberships }: { entries: readonly { at: string; gameTime: { season: number; day: number }; actor: string; kind: string }[]; memberships: readonly Membership[] }) {
  const rows = entries.filter((e) => !HIDDEN.has(e.kind)).slice(-20).reverse();
  if (!rows.length) return <Empty>기록이 없어요</Empty>;
  return (
    <ul className="list compact">
      {rows.map((e, i) => (
        <li key={i} className="list-row">
          <span className="small muted">
            S{e.gameTime.season} D{e.gameTime.day}
          </span>
          <span>{LOG_LABEL[e.kind] ?? e.kind}</span>
          <span className="small muted">{seatLabel(memberships, e.actor)}</span>
        </li>
      ))}
    </ul>
  );
}
