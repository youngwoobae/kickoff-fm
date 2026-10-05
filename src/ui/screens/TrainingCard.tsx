/** 스쿼드 상단 훈련 카드 (M5.2, 계약 2.3.0 setTrainingFocus·Club.training). 구단 단위 1개, 다음 주부터 적용 */
import { useState } from 'react';
import { Badge, Card } from '../components/kit';
import { useAction, useGame, useIsOwner } from '../service/ServiceContext';
import { trainingOf } from '../types23';
import type { TrainingFocus } from '../../types';

/** 수명주기 설계 8.2 효과표 (표시용 문구) */
export const FOCUS_INFO: Record<TrainingFocus, { label: string; growth: string; effect: string }> = {
  BALANCED: { label: '균형', growth: '성장 ×1.0', effect: '모든 능력치가 고르게 자라요' },
  ATTACK: { label: '공격', growth: '성장 ×1.0', effect: '패스·드리블·결정력·크로스·시야·킥이 주로 자라요' },
  DEFENSE: { label: '수비', growth: '성장 ×1.0', effect: '태클·위치 선정·활동량·선방·공중 장악이 주로 자라요' },
  PHYSICAL: { label: '체력', growth: '성장 ×1.0', effect: '속도·체력·피지컬이 주로 자라요' },
  TACTICAL: { label: '전술 숙련', growth: '성장 ×0.8', effect: '두 전술 슬롯 숙련도가 매일 +3, 안 쓰는 슬롯도 줄지 않아요' },
  RECOVERY: { label: '회복', growth: '성장 ×0.7', effect: '매일 컨디션 회복 +4' },
};
const ORDER: TrainingFocus[] = ['BALANCED', 'ATTACK', 'DEFENSE', 'PHYSICAL', 'TACTICAL', 'RECOVERY'];
const WEEK_STARTS = [1, 8, 15, 22];

/** 예약한 포커스가 적용되는 때 (주 시작 Day 1·8·15·22 00:00) */
function applyAtText(day: number, phase: string): string {
  const next = phase === 'MATCHDAY' ? WEEK_STARTS.find((d) => d > day) : undefined;
  return next ? `Day ${next}부터` : '다음 시즌 Day 1부터';
}

export function TrainingCard() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const run = useAction();
  const [open, setOpen] = useState(false);
  const t = trainingOf(snap.clubs[snap.userClubId]);
  const when = applyAtText(snap.time.day, snap.phase);
  const pending = t.next && t.next !== t.focus ? t.next : undefined;

  const pick = (f: TrainingFocus) => {
    if (f === (pending ?? t.focus)) return;
    run((s) => s.setTrainingFocus(f), f === t.focus ? '예약을 취소하고 지금 훈련을 이어 가요' : `${FOCUS_INFO[f].label} 훈련을 ${when} 적용해요`);
  };

  return (
    <Card
      className="card-compact"
      title={<>🏋 훈련 · {FOCUS_INFO[t.focus].label}</>}
      extra={
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? '접기' : isOwner ? '바꾸기' : '보기'}
        </button>
      }
    >
      <p className="small">
        {FOCUS_INFO[t.focus].growth} · {FOCUS_INFO[t.focus].effect}
      </p>
      {pending && (
        <p className="small">
          <Badge tone="accent">예약</Badge> {FOCUS_INFO[pending].label} 훈련이 {when} 적용돼요
        </p>
      )}
      {open && (
        <>
          <p className="small muted">
            바꾼 훈련은 {when} 적용돼요(주 시작 Day 1·8·15·22). 성장은 27세 이하 선수에게만 효과가 있어서, 노장이 많은 팀에는 회복·전술 숙련이 맞아요.
          </p>
          {!isOwner && <p className="small muted">훈련은 구단주가 정해요. 코치는 볼 수만 있어요.</p>}
          <div className="style-grid" role="radiogroup" aria-label="훈련 포커스">
            {ORDER.map((f) => {
              const cur = (pending ?? t.focus) === f;
              return (
                <button key={f} type="button" role="radio" aria-checked={cur} className={`style-card ${cur ? 'is-active' : ''}`} disabled={!isOwner} onClick={() => pick(f)}>
                  <span className="style-name">
                    {FOCUS_INFO[f].label} {f === t.focus && <Badge tone="neutral">이번 주</Badge>} {f === pending && <Badge tone="accent">예약</Badge>}
                  </span>
                  <span className="small">{FOCUS_INFO[f].growth}</span>
                  <span className="small muted">{FOCUS_INFO[f].effect}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
