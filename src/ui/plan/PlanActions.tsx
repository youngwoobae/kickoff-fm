/** 플랜 저장·제출(구단주) / 제안하기(코치) 하단 CTA (소유: B) */
import { useState } from 'react';
import type { PlanChangePatch } from '../../types';
import { Sheet, StickyActions } from '../components/kit';
import { isGameError } from '../../services';
import { canPropose, seatLabel } from '../format';
import { useAction, useActor, useIsOwner, useQuery, useSnapshot } from '../service/ServiceContext';
import { diffPatch, isEmptyPatch, usePlanEditor } from './PlanEditor';

/** 2.5.0 NEW_COACH_LOCK: 합류한 날의 코치는 그날 경기 플랜을 볼 수 없다 → 안내 문구, 아니면 null */
export function usePlanLock(): string | null {
  const e = useQuery((s) => s.getPlanState()).error;
  return e && isGameError(e) && e.details.includes('NEW_COACH_LOCK') ? '🔒 합류한 첫날이라 오늘 경기 플랜은 볼 수 없어요. 다음 날부터 볼 수 있어요.' : null;
}

export function PlanStatusLine() {
  const { planState, dirty } = usePlanEditor();
  const snap = useSnapshot();
  if (!planState?.matchId) return <span className="muted">다음 경기가 없어요</span>;
  const c = planState.confirmed;
  const d = planState.draft;
  return (
    <span className="plan-status">
      {c ? (
        <>
          <span className="badge badge-good">✓ 확정 제출</span> Day {c.updatedAt.day} · {snap ? seatLabel(snap.memberships, c.updatedBy) : c.updatedBy}
          {c.sourceProposalId && ' (코치 제안 반영)'}
        </>
      ) : d ? (
        <>
          <span className="badge badge-warn">초안</span> 마감 때 초안은 쓰이지 않아요
        </>
      ) : (
        <>
          <span className="badge badge-bad">미제출</span> 마감 시 {planState.preview ? '자동 적용 플랜' : '기본 플랜'}으로 경기해요
        </>
      )}
      {dirty && <span className="badge badge-accent">편집 중</span>}
    </span>
  );
}

export function ProposeSheet({ open, onClose, patch, title = '코치 제안 보내기' }: { open: boolean; onClose: () => void; patch: PlanChangePatch; title?: string }) {
  const run = useAction();
  const { planState } = usePlanEditor();
  const [reason, setReason] = useState('');
  const submit = () => {
    if (!planState?.matchId) return;
    const r = run((s) => s.propose({ payload: { kind: 'PLAN_CHANGE', matchId: planState.matchId as string, patch }, reason }), '제안을 보냈어요. 구단주 승인을 기다려요');
    if (r) {
      setReason('');
      onClose();
    }
  };
  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={reason.trim().length === 0} onClick={submit}>
          제안 보내기
        </button>
      }
    >
      <p className="muted">바꾼 항목: {Object.keys(patch).map((k) => PATCH_LABEL[k] ?? k).join(', ') || '없음'}</p>
      <label className="field">
        <span>이유 (필수, 최대 80자)</span>
        <input value={reason} maxLength={80} required aria-describedby="plan-reason-count" onChange={(e) => setReason(e.target.value)} placeholder="예: 상대 왼쪽 풀백이 느려요. 뒷공간 노림" />
        <small id="plan-reason-count" className="muted">{reason.length}/80</small>
      </label>
    </Sheet>
  );
}

const PATCH_LABEL: Record<string, string> = {
  lineup: '선발·벤치',
  startSlot: '시작 슬롯',
  instructions: '팀 지시',
  conditionals: '조건부 지시',
  opponentOrders: '상대 맞춤 지시',
};

export function PlanActions() {
  const isOwner = useIsOwner();
  const actor = useActor();
  const run = useAction();
  const { plan, base, dirty, planState, markSaved, reset } = usePlanEditor();
  const [proposeOpen, setProposeOpen] = useState(false);
  if (!plan || !planState?.matchId) return null;

  if (!isOwner) {
    const patch = base ? diffPatch(base, plan) : {};
    return (
      <>
        <StickyActions note={canPropose(actor, 'PLAN_CHANGE') ? <PlanStatusLine /> : <span className="muted">플랜 제안은 전술·선수단 코치와 분석관이 해요. 볼 수만 있어요.</span>}>
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={reset}>
            되돌리기
          </button>
          <button type="button" className="btn btn-primary" disabled={isEmptyPatch(patch) || !canPropose(actor, 'PLAN_CHANGE')} onClick={() => setProposeOpen(true)}>
            제안하기
          </button>
        </StickyActions>
        <ProposeSheet open={proposeOpen} onClose={() => setProposeOpen(false)} patch={patch} />
      </>
    );
  }

  return (
    <StickyActions note={<PlanStatusLine />}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          if (run((s) => s.saveDraft(plan), '초안을 저장했어요 (확정 제출해야 적용돼요)')) markSaved();
        }}
      >
        초안 저장
      </button>
      <button
        type="button"
        className="btn btn-primary"
        data-tour="plan.submit"
        onClick={() => {
          if (run((s) => s.submitPlan(plan), '확정 제출했어요 · ‘다음 날로 넘기기’ 전까지 고칠 수 있어요')) markSaved();
        }}
      >
        확정 제출
      </button>
    </StickyActions>
  );
}
