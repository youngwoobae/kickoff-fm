/** C05 코치실: 지금 사용자·멤버 관리(2.5.0), 제안 작성(코치) → 승인/거절(구단주), 이적·재계약 제안, 활동 기록 (소유: B) */
import { useState } from 'react';
import type { ActionLogEntry, DealProposal, Membership, PlanChangePatch, Proposal, ProposalReaction, ProposalStatus, SlotKey, Step, TeamInstructions } from '../../types';
import { Badge, Card, Empty, Segmented, Sheet, StepSlider } from '../components/kit';
import { INSTR_LABEL, PROPOSAL_STATUS_LABEL, ROLE_NAME, SLIDERS, canPropose, memberText, proposeAreaText, seatLabel, type SliderKey } from '../format';
import { MembersCard } from './MembersCard';
import { ProfileSheet } from './ProfileSheet';
import { ProposeSheet } from '../plan/PlanActions';
import { useToast } from '../components/Toast';
import { useAction, useActor, useGame, useQuery } from '../service/ServiceContext';

const REJECT_REASONS = ['이번 경기엔 안 맞음', '다른 제안과 겹침', '선수 컨디션 고려', '기타'];

export function CoachScreen() {
  const snap = useGame();
  const actor = useActor();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const [profileOpen, setProfileOpen] = useState(false);
  const status: { status?: ProposalStatus } = filter === 'OPEN' ? { status: 'OPEN' } : {};
  const list = useQuery((s) => s.listProposals(status), [filter]).data ?? [];
  const deals = useQuery((s) => s.listDealProposals?.(status) ?? [], [filter]).data ?? [];
  const seat = actor?.seat ?? 'OWNER';
  // 플랜 제안과 거래 제안을 최신순으로 한 목록에
  const cards = [...list.map((p) => ({ t: p.createdAt, p, d: null })), ...deals.map((d) => ({ t: d.createdAt, p: null, d }))].sort((a, b) => b.t.season - a.t.season || b.t.seq - a.t.seq);

  return (
    <div className="screen coach">
      <Card title="지금 사용자">
        <div className="row-between">
          <strong>{actor ? memberText(actor) : '–'}</strong>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProfileOpen(true)}>
            사용자 바꾸기
          </button>
        </div>
        <p className="small muted">
          {seat === 'OWNER'
            ? '구단주는 플랜·전술·이적·계약을 직접 실행하고, 코치 제안을 승인하거나 거절해요.'
            : `코치는 실행 대신 제안을 보내요. 담당 제안: ${proposeAreaText(actor)}. 다른 제안에는 찬성·반대로 의견을 남길 수 있어요.`}
        </p>
      </Card>
      {profileOpen && <ProfileSheet onClose={() => setProfileOpen(false)} />}

      <MembersCard />

      {canPropose(actor, 'PLAN_CHANGE') && <QuickProposal />}

      <div className="row-between">
        <h3 className="h3">제안함</h3>
        <Segmented label="제안 필터" size="sm" value={filter} onChange={setFilter} options={[{ value: 'OPEN', label: '대기' }, { value: 'ALL', label: '전체' }]} />
      </div>
      {cards.length === 0 ? (
        <Empty>{filter === 'OPEN' ? '대기 중인 제안이 없어요' : '제안 기록이 없어요'}</Empty>
      ) : (
        cards.map((c) => (c.p ? <ProposalCard key={c.p.id} p={c.p} seat={seat} /> : c.d && <DealCard key={c.d.id} d={c.d} seat={seat} />))
      )}

      <Card title="활동 기록">
        <ActivityLog entries={snap.actionLog} memberships={snap.memberships} />
      </Card>
    </div>
  );
}

/** 작성자 표시: 작성 시점 스냅샷(authorName·authorEmoji) > 역할 이름 */
function authorText(p: { authorName?: string; authorEmoji?: string; authorRole?: Proposal['authorRole'] }): string {
  const name = p.authorName ?? (p.authorRole ? ROLE_NAME[p.authorRole] : '코치');
  return p.authorEmoji ? `${p.authorEmoji} ${name}` : name;
}

function reactionsText(rs: readonly ProposalReaction[], memberships: readonly Membership[]): string {
  return rs.map((r) => `${r.choice === 'FOR' ? '👍 찬성' : '👎 반대'} ${r.name ?? seatLabel(memberships, r.userId)}${r.reason ? ` (${r.reason})` : ''}`).join(' · ');
}

const statusTone = (st: ProposalStatus) => (st === 'APPROVED' ? 'good' : st === 'OPEN' ? 'accent' : st === 'REJECTED' || st === 'STALE' ? 'bad' : 'neutral');

/** 2.5.0 이적·재계약 제안 카드: 구단주 = 승인(구단주 명의로 실행)·거절, 코치 = 찬성·반대 */
function DealCard({ d, seat }: { d: DealProposal; seat: string }) {
  const snap = useGame();
  const run = useAction();
  const toast = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const isOpen = d.status === 'OPEN';
  const myReaction = d.reactions.find((r) => r.userId === snap.actorUserId)?.choice;
  const approve = () => {
    const r = run((s) => s.approveDeal?.(d.id), (res) => (res?.ok ? (d.kind === 'TRANSFER_BID' ? '승인했어요. 구단주 이름으로 입찰했어요' : '승인했어요. 재계약이 성립했어요') : undefined));
    if (r && !r.ok) toast.show(`실행하지 못해 제안이 무효가 됐어요: ${r.details.join(', ')}`, 'error');
  };
  return (
    <Card
      className={`proposal ${isOpen ? '' : 'is-closed'}`}
      title={
        <>
          {d.kind === 'TRANSFER_BID' ? '이적 입찰 제안' : '재계약 제안'} · {authorText(d)} · Day {d.createdAt.day}
        </>
      }
      extra={<Badge tone={statusTone(d.status)}>{PROPOSAL_STATUS_LABEL[d.status]}</Badge>}
    >
      <p>
        <strong>{d.summary}</strong>
      </p>
      <p className="small muted">Day {d.expiresAt.day}로 넘어가면 만료 · 승인하면 구단주 이름으로 바로 실행해요</p>
      <p className="reason">이유: “{d.reason}”</p>
      {d.reactions.length > 0 && <p className="small muted">반응: {reactionsText(d.reactions, snap.memberships)}</p>}
      {d.resolutionNote && <p className="small muted">처리 메모: {d.resolutionNote}</p>}
      {isOpen && seat === 'OWNER' && (
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => setRejectOpen(true)}>
            거절
          </button>
          <button type="button" className="btn btn-primary" onClick={approve}>
            승인하고 실행
          </button>
        </div>
      )}
      {isOpen && seat === 'COACH' && (
        <div className="btn-row">
          <button type="button" className={`btn ${myReaction === 'FOR' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={myReaction === 'FOR'} onClick={() => run((s) => s.reactDeal?.(d.id, 'FOR'), '찬성했어요')}>
            👍 찬성
          </button>
          <button type="button" className={`btn ${myReaction === 'AGAINST' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={myReaction === 'AGAINST'} onClick={() => run((s) => s.reactDeal?.(d.id, 'AGAINST', '다른 방안 검토 필요'), '반대했어요')}>
            👎 반대
          </button>
        </div>
      )}
      <RejectSheet open={rejectOpen} onClose={() => setRejectOpen(false)} onPick={(r) => run((s) => s.rejectDeal?.(d.id, r), '제안을 거절했어요')} />
    </Card>
  );
}

function RejectSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (reason: string) => void }) {
  return (
    <Sheet open={open} title="거절 사유" onClose={onClose}>
      <div className="chips">
        {REJECT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className="chip"
            onClick={() => {
              onPick(r);
              onClose();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    </Sheet>
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
    const r = run((s) => s.approve(p.id, edits), (res) => (res.ok ? `승인했어요. 구단주 이름으로 확정 제출했어요${res.superseded.length ? ` (대체된 제안 ${res.superseded.length}건)` : ''}` : undefined));
    if (!r) return;
    if (r.ok) setStale(null);
    else {
      // STALE 제안은 OPEN 필터에서 바로 사라지므로 카드 안 문구만으로는 보이지 않는다 → 토스트로 알린다
      setStale(r.details);
      toast.show(`상황이 바뀌어 제안이 무효가 됐어요: ${r.details.join(', ')}`, 'error');
    }
  };
  const myReaction = p.reactions.find((r) => r.userId === snap.actorUserId)?.choice;

  return (
    <Card
      className={`proposal ${isOpen ? '' : 'is-closed'}`}
      title={
        <>
          플랜 제안 · {authorText(p)} · Day {p.createdAt.day}
        </>
      }
      extra={<Badge tone={statusTone(p.status)}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge>}
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
          반응: {reactionsText(p.reactions, snap.memberships)}
        </p>
      )}
      {p.resolutionNote && <p className="small muted">처리 메모: {p.resolutionNote}</p>}
      {stale && <p className="warn-line">상황이 바뀌어 제안이 무효가 됐어요: {stale.join(', ')}</p>}
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
          <button type="button" className={`btn ${myReaction === 'FOR' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={myReaction === 'FOR'} onClick={() => run((s) => s.react(p.id, 'FOR'), '찬성했어요')}>
            👍 찬성
          </button>
          <button type="button" className={`btn ${myReaction === 'AGAINST' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={myReaction === 'AGAINST'} onClick={() => run((s) => s.react(p.id, 'AGAINST', '다른 방안 검토 필요'), '반대했어요')}>
            👎 반대
          </button>
        </div>
      )}
      <RejectSheet open={rejectOpen} onClose={() => setRejectOpen(false)} onPick={(r) => run((s) => s.reject(p.id, r), '제안을 거절했어요')} />
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
      {keys.length === 0 && <p className="muted">팀 지시가 없는 제안이에요</p>}
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
  SESSION_START: '게임 시작',
  SESSION_END: '게임 종료',
  MANUAL_ROTATION: '수동 로테이션',
  MEMBER_ADDED: '멤버 추가',
  MEMBER_UPDATED: '멤버 수정',
  MEMBER_REMOVED: '멤버 내보냄',
  OWNER_PIN_SET: '구단주 PIN 변경',
  BID_PLACED: '이적 입찰',
  BID_WITHDRAWN: '입찰 철회',
  RENEWAL_OFFERED: '재계약 제안',
};
const HIDDEN = new Set(['SESSION_START', 'SESSION_END', 'REPORT_VIEWED', 'REPLAY_VIEWED', 'SCOUT_VIEWED']);

function ActivityLog({ entries, memberships }: { entries: readonly ActionLogEntry[]; memberships: readonly Membership[] }) {
  const rows = entries.filter((e) => !HIDDEN.has(e.kind)).slice(-20).reverse();
  if (!rows.length) return <Empty>기록이 없어요</Empty>;
  return (
    <ul className="list compact">
      {rows.map((e, i) => (
        <li key={i} className="list-row">
          <span className="small muted">
            시즌 {e.gameTime.season} · Day {e.gameTime.day}
          </span>
          <span>{LOG_LABEL[e.kind] ?? e.kind}</span>
          <span className="small muted">{e.actorName ?? seatLabel(memberships, e.actor)}</span>
        </li>
      ))}
    </ul>
  );
}
