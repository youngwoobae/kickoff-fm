/** 유스 아카데미 (M5.2, Q08 간이 · 계약 2.3.0 getYouthIntake·decideYouth). 최대 2명 승격, 마감 Day 7 */
import { useState } from 'react';
import type { PlayerId, ScoutGrade } from '../../types';
import { Badge, Card, Empty, ErrorNote } from '../components/kit';
import { POS_LABEL, POS_NAME } from '../format';
import { useGame, useInlineAction, useIsOwner, useQuery } from '../service/ServiceContext';
import type { YouthCandidate } from '../types23';

const MAX_PROMOTE = 2;
const SQUAD_MAX = 25;
/** 결정 U3: tierRange 는 우리 티어 기준 OVR 을 C 근처에 맞춘 상대 등급. 등급마다 뜻을 함께 보여 준다 */
const TIER_GRADE_LABEL: Record<ScoutGrade, string> = { S: '상위 리그 핵심감', A: '보석', B: '유망주', C: '주전급', D: '로테이션급', E: '육성형' };
const HOT: ScoutGrade[] = ['B', 'A', 'S'];

/** tierRange 가 없으면(구 서비스) 절대 스카우트 등급만 보여 준다 */
function potentialText(c: YouthCandidate): { grade: string; words?: string; hot: boolean } {
  const [lo, hi] = c.tierRange ?? c.scoutRange;
  return {
    grade: lo === hi ? lo : `${lo}~${hi}`,
    words: c.tierRange && (lo === hi ? TIER_GRADE_LABEL[lo] : `${TIER_GRADE_LABEL[lo]} ~ ${TIER_GRADE_LABEL[hi]}`),
    hot: !!c.tierRange && HOT.includes(hi),
  };
}

export function YouthScreen() {
  const snap = useGame();
  const isOwner = useIsOwner();
  const q = useQuery((s) => s.getYouthIntake?.());
  const squadSize = useQuery((s) => s.getSquad().length).data ?? 0;
  const { run, error } = useInlineAction();
  const [sel, setSel] = useState<PlayerId[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ promoted: string[]; released: number } | null>(null);
  const intake = q.data;

  if (q.error) return <Empty>{q.error.message}</Empty>;
  if (intake === undefined) return <Empty>유스 아카데미는 곧 열려요. 시즌마다 16~17세 후보가 찾아와요.</Empty>;

  const resultCard = (promoted: string[], released: number) => (
    <Card title="🌱 유스 결정 완료">
      {promoted.length ? (
        <p>
          <Badge tone="good">✓ 승격</Badge> {promoted.join(', ')} 선수가 선수단에 합류했어요. 계약은 3시즌이에요.
        </p>
      ) : (
        <p>이번 시즌엔 아무도 올리지 않았어요.</p>
      )}
      {released > 0 && <p className="small muted">나머지 후보 {released}명은 아카데미를 떠났어요.</p>}
      <p className="small muted">다음 후보는 다음 시즌 Day 1에 와요.</p>
    </Card>
  );

  if (result) return <div className="screen">{resultCard(result.promoted, result.released)}</div>;
  if (!intake) return <Empty>지금은 유스 후보가 없어요. 새 시즌 Day 1에 후보가 찾아와요.</Empty>;
  if (intake.decided) {
    const ids = new Set(intake.promotedIds ?? []);
    const promoted = intake.candidates.filter((c) => ids.has(c.id)).map((c) => c.name);
    return <div className="screen">{resultCard(promoted, intake.candidates.length - promoted.length)}</div>;
  }

  const daysLeft = intake.deadlineDay - snap.time.day;
  const full = squadSize + sel.length > SQUAD_MAX;
  const toggle = (id: PlayerId) => {
    setConfirming(false);
    setSel((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= MAX_PROMOTE ? xs : [...xs, id]));
  };
  const decide = () => {
    const names = intake.candidates.filter((c) => sel.includes(c.id)).map((c) => c.name);
    const ok = run((s) => s.decideYouth?.(sel), names.length ? `${names.join(', ')} 선수를 승격했어요` : '이번 시즌 유스 결정을 마쳤어요');
    if (ok) setResult({ promoted: names, released: intake.candidates.length - names.length });
    setConfirming(false);
  };

  return (
    <div className="screen">
      <Card title={`🌱 유스 후보 ${intake.candidates.length}명`}>
        <p className="small">
          최대 {MAX_PROMOTE}명까지 1군으로 올릴 수 있어요. 나머지는 아카데미를 떠나요. 한 번 정하면 이번 시즌엔 되돌릴 수 없어요.
        </p>
        <p className={daysLeft <= 1 ? 'warn-line' : 'small'}>
          ⏰ Day {intake.deadlineDay}까지 정해 주세요{daysLeft > 0 ? ` (${daysLeft}일 남음)` : ' (오늘 마감)'}. 정하지 않으면 Day {intake.deadlineDay + 1}에 유망주만 최대 1명 자동으로 올려요.
        </p>
        <p className="small muted">
          잠재력 등급은 우리 리그{intake.tier && `(${intake.tier})`} 기준이에요. C가 이 리그 주전급, B 이상이면 유망주예요. 스카우트 추정이라 실제와 다를 수 있어요.
        </p>
      </Card>

      <ul className="list" aria-label="유스 후보">
        {intake.candidates.map((c) => {
          const on = sel.includes(c.id);
          const pt = potentialText(c);
          const blocked = !on && sel.length >= MAX_PROMOTE;
          return (
            <li key={c.id}>
              <button type="button" className={`style-card ${on ? 'is-active' : ''}`} aria-pressed={on} disabled={!isOwner || blocked} onClick={() => toggle(c.id)}>
                <span className="row-between">
                  <span className="style-name">
                    <span className={`pos-badge pos-${c.primary}`}>{POS_LABEL[c.primary]}</span> {c.name}
                  </span>
                  {on ? <Badge tone="accent">✓ 승격 선택</Badge> : <span className="small muted">OVR {c.ovr}</span>}
                </span>
                <span className="small">
                  {POS_NAME[c.primary]} · {c.age}세 · 현재 OVR <strong>{c.ovr}</strong>
                </span>
                <span className="small">
                  잠재력 <Badge tone={pt.hot ? 'good' : 'neutral'}>{pt.grade}</Badge> {pt.words && <span className="muted">{pt.words}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {!isOwner ? (
        <p className="small muted">유스 승격은 구단주가 정해요. 코치는 볼 수만 있어요.</p>
      ) : (
        <Card className="card-compact">
          <p className="small">
            선택 {sel.length}/{MAX_PROMOTE}명 · 선수단 {squadSize}명 → {squadSize + sel.length}명
          </p>
          {full && <p className="warn-line">선수단이 {SQUAD_MAX}명을 넘어요. 먼저 선수를 방출하거나 판매해 주세요.</p>}
          {confirming ? (
            <div className="btn-row">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={decide}>
                확정하기
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" disabled={full} onClick={() => setConfirming(true)}>
              {sel.length ? `${sel.length}명 승격하고 결정하기` : '아무도 올리지 않고 결정하기'}
            </button>
          )}
          {confirming && <p className="small muted">확정하면 되돌릴 수 없어요. 고르지 않은 후보 {intake.candidates.length - sel.length}명은 떠나요.</p>}
          <ErrorNote error={error} dev={snap.settings.devMode} />
        </Card>
      )}
    </div>
  );
}
