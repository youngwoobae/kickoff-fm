/** H01 홈(오늘) (소유: B) */
import { useState } from 'react';
import type { DayResult, Fixture, MatchSummary } from '../../types';
import { Badge, Card, Empty, Meter, Sheet, StickyActions } from '../components/kit';
import { ADJ_LABEL, BOT_STYLE_LABEL, PLAN_SOURCE_LABEL, formatKc, LEDGER_LABEL } from '../format';
import { useNav } from '../app/nav';
import { usePlanEditor } from '../plan/PlanEditor';
import { PlanStatusLine } from '../plan/PlanActions';
import { useAction, useActor, useGame, useQuery, useService } from '../service/ServiceContext';

export function HomeScreen() {
  const snap = useGame();
  const run = useAction();
  const actor = useActor();
  const isOwner = actor?.seat === 'OWNER';
  const [dayResult, setDayResult] = useState<DayResult | null>(null);
  const preview = useQuery((s) => s.previewResolvedPlan()).data ?? null;
  const next = useQuery((s) => s.getNextMatch()).data ?? null;

  const advance = () => {
    const r = run((s) => s.advanceDay());
    if (r) setDayResult(r);
  };
  const recommendAndSubmit = () =>
    run((s) => {
      const plan = s.recommendPlan();
      return s.submitPlan(plan);
    }, '추천 플랜을 확정 제출했어요');

  const recChanges = preview?.adjustments.filter((a) => a.kind === 'UNAVAILABLE_REPLACED' || a.kind === 'AUTO_ROTATION') ?? [];
  const progress = snap.time.day / 28;

  return (
    <div className="screen home">
      <Card className="card-compact">
        <div className="row-between">
          <span>
            시즌 {snap.time.season} · Day {snap.time.day}/28
          </span>
          <span className="muted">{snap.phase === 'MATCHDAY' ? '경기일' : snap.phase === 'OFFSEASON' ? (snap.time.day === 27 ? '리뷰 데이' : '정산 데이') : '시즌 종료'}</span>
        </div>
        <Meter value={progress} label="시즌 진행" />
      </Card>

      {snap.phase === 'SEASON_OVER' && <SeasonOverCard />}
      {next ? <NextMatchCard fixture={next} /> : snap.phase !== 'SEASON_OVER' && <OffseasonCard day={snap.time.day} />}
      {next && <AppliedPlanCard />}
      <TodoCard />
      <LastResultCard />

      {snap.phase !== 'SEASON_OVER' && (
        <StickyActions
          note={
            next && recChanges.length > 0 ? (
              <span>
                추천 변경 {recChanges.length}건: {recChanges.map((a) => a.note).join(', ')}
              </span>
            ) : next ? (
              <PlanStatusLine />
            ) : null
          }
        >
          {next && (
            <button type="button" className="btn btn-secondary" disabled={!isOwner} title={isOwner ? undefined : '구단주 권한 필요'} onClick={recommendAndSubmit}>
              추천대로 제출
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={advance}>
            다음 날로 넘기기 ▶
          </button>
        </StickyActions>
      )}
      <DayResultSheet result={dayResult} onClose={() => setDayResult(null)} />
    </div>
  );
}

function NextMatchCard({ fixture }: { fixture: Fixture }) {
  const snap = useGame();
  const { go } = useNav();
  const service = useService();
  const isHome = fixture.homeId === snap.userClubId;
  const oppId = isHome ? fixture.awayId : fixture.homeId;
  const opp = snap.clubs[oppId];
  const standings = useQuery((s) => s.getStandings()).data ?? [];
  const oppRow = standings.find((r) => r.clubId === oppId);
  const scout = useQuery((s) => s.getOpponentScout(oppId), [oppId]).data;
  const [open, setOpen] = useState(false);
  const today = fixture.day === snap.time.day;
  return (
    <Card title="다음 경기" extra={<Badge tone={today ? 'accent' : 'neutral'}>{today ? '오늘' : `Day ${fixture.day}`}</Badge>}>
      <div className="match-line">
        <span className="big">
          {isHome ? '홈' : '원정'} vs {opp?.name ?? oppId}
        </span>
        {oppRow && <span className="muted">{oppRow.position}위 · 승점 {oppRow.points}</span>}
      </div>
      <p className="muted small">킥오프 21:00 · 플랜 마감 20:50 (Phase 0: "넘기기"를 누르는 순간이 마감)</p>
      {scout && (
        <div className="scout">
          <div>
            상대 성향: <strong>{scout.botStyle ? BOT_STYLE_LABEL[scout.botStyle] : '사람 구단'}</strong>
            {scout.last5[0] && <> · 최근 {scout.last5[0].formation}</>}
          </div>
          <div className="weak">약점: {scout.weakness}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setOpen(true);
              try {
                service.logEvent('SCOUT_VIEWED', { clubId: oppId });
              } catch {
                /* noop */
              }
            }}
          >
            최근 5경기 보기
          </button>
        </div>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={() => go({ tab: 'squad', squad: 'lineup' })}>
          선발 편집
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => go({ tab: 'tactics', tactics: 'plan' })}>
          경기 플랜
        </button>
      </div>
      <Sheet open={open} title={`${opp?.name ?? ''} 최근 5경기`} onClose={() => setOpen(false)}>
        {scout && scout.last5.length > 0 ? (
          <ul className="list">
            {scout.last5.map((m) => (
              <li key={m.matchId} className="list-row">
                <span>
                  Day {m.day} vs {snap.clubs[m.opponentId]?.shortName ?? m.opponentId}
                </span>
                <strong>
                  {m.goalsFor}:{m.goalsAgainst}
                </strong>
                <span className="muted small">
                  {m.formation} · {m.instructionsSummary}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>아직 경기 기록이 없어요</Empty>
        )}
      </Sheet>
    </Card>
  );
}

function AppliedPlanCard() {
  const snap = useGame();
  const { planState } = usePlanEditor();
  const preview = planState?.preview;
  if (!preview) return null;
  const club = snap.clubs[snap.userClubId];
  const slot = club?.tactics[preview.plan.startSlot];
  return (
    <Card title="지금 마감되면 적용될 플랜">
      <p>
        <strong>{PLAN_SOURCE_LABEL[preview.source]}</strong> · 슬롯 {preview.plan.startSlot} ({slot?.formation}) · 조건부 지시 {preview.plan.conditionals.filter((c) => c.enabled).length}개
      </p>
      {!planState?.confirmed && <p className="warn-line">⚠ 확정 제출하지 않으면 상대 맞춤 지시 없이 이 플랜으로 경기합니다</p>}
      {preview.adjustments.length > 0 && (
        <ul className="list compact">
          {preview.adjustments.map((a, i) => (
            <li key={i} className="list-row">
              <Badge tone="warn">{ADJ_LABEL[a.kind]}</Badge> <span className="small">{a.note}</span>
            </li>
          ))}
        </ul>
      )}
      <PlanStatusLine />
    </Card>
  );
}

function TodoCard() {
  const snap = useGame();
  const actor = useActor();
  const { go } = useNav();
  const ps = useQuery((s) => s.getPlanState()).data;
  const open = useQuery((s) => s.listProposals({ status: 'OPEN' })).data ?? [];
  const squad = useQuery((s) => s.getSquad()).data ?? [];
  const starters = new Set(ps?.preview?.plan.lineup.starters ?? []);
  const unavailable = squad.filter((p) => p.availability.injuryDays > 0 || p.availability.suspendedMatches > 0);
  const tired = squad.filter((p) => starters.has(p.id) && p.condition < 70);
  const items: { done: boolean; text: string; onClick?: () => void }[] = [];
  if (ps?.matchId) items.push({ done: !!ps.confirmed, text: ps.confirmed ? '오늘 플랜 확정 제출됨' : '오늘 플랜 확정 제출하기', onClick: () => go({ tab: 'tactics', tactics: 'plan' }) });
  if (unavailable.length) items.push({ done: false, text: `출전 불가 ${unavailable.length}명 (${unavailable.map((p) => p.name).slice(0, 2).join(', ')}${unavailable.length > 2 ? '…' : ''})`, onClick: () => go({ tab: 'squad', squad: 'list' }) });
  if (tired.length) items.push({ done: false, text: `선발 예정 중 컨디션 70 미만 ${tired.length}명`, onClick: () => go({ tab: 'squad', squad: 'lineup' }) });
  if (open.length) items.push({ done: false, text: actor?.seat === 'OWNER' ? `코치 제안 ${open.length}건 처리` : `내 제안 ${open.length}건 대기 중`, onClick: () => go({ tab: 'club', club: 'coach' }) });
  const last = lastUserFixture(snap);
  if (last) items.push({ done: false, text: '어제 경기 리포트 확인', onClick: () => go({ tab: 'match', matchId: last.id, matchView: 'report' }) });
  if (!items.length) return null;
  return (
    <Card title="오늘 할 일">
      <ul className="todo">
        {items.map((it, i) => (
          <li key={i}>
            <button type="button" className="todo-item" onClick={it.onClick}>
              <span aria-hidden="true">{it.done ? '☑' : '☐'}</span>
              <span className={it.done ? 'muted' : ''}>{it.text}</span>
              <span aria-hidden="true" className="chev">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function lastUserFixture(snap: ReturnType<typeof useGame>): Fixture | undefined {
  return snap.fixtures
    .filter((f) => f.played && f.season === snap.time.season && (f.homeId === snap.userClubId || f.awayId === snap.userClubId))
    .sort((a, b) => b.day - a.day)[0];
}

export function resultOf(sum: MatchSummary, clubId: string) {
  const me = sum.home.clubId === clubId ? sum.home : sum.away;
  const op = sum.home.clubId === clubId ? sum.away : sum.home;
  const res = me.goals > op.goals ? '승' : me.goals === op.goals ? '무' : '패';
  return { me, op, res, tone: (res === '승' ? 'good' : res === '무' ? 'neutral' : 'bad') as 'good' | 'neutral' | 'bad' };
}

function LastResultCard() {
  const snap = useGame();
  const { go } = useNav();
  const last = lastUserFixture(snap);
  const sum = last ? snap.summaries[last.id] : undefined;
  const report = useQuery((s) => (last ? s.getReport(last.id) : null), [last?.id]).data;
  if (!last || !sum) return null;
  const { me, op, res, tone } = resultOf(sum, snap.userClubId);
  const f = report?.keyFactors[0];
  return (
    <Card title="어제 결과">
      <button type="button" className="result-card" onClick={() => go({ tab: 'match', matchId: last.id, matchView: 'report' })}>
        <span className="score">
          {me.goals} : {op.goals}
        </span>
        <Badge tone={tone}>{res}</Badge>
        <span>vs {snap.clubs[op.clubId]?.name}</span>
        <span className="muted small">
          xG {me.xg.toFixed(2)} : {op.xg.toFixed(2)}
        </span>
        {f && <span className="quote">“{f.text}”</span>}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
    </Card>
  );
}

function OffseasonCard({ day }: { day: number }) {
  return (
    <Card title="오프시즌">
      <p>{day === 27 ? '리뷰 데이: 순위 상금과 우승 수당이 입금되었어요.' : day === 28 ? '정산 데이: 이월 판정이 진행되었어요. 넘기면 시즌이 끝납니다.' : '경기 일정이 끝났어요.'}</p>
    </Card>
  );
}

function SeasonOverCard() {
  const snap = useGame();
  const run = useAction();
  const { go } = useNav();
  const out = useQuery((s) => s.getSeasonOutcome()).data;
  if (!out) return null;
  const row = out.finalTable.find((r) => r.clubId === snap.userClubId);
  const label = out.labels[snap.userClubId];
  return (
    <Card title={`시즌 ${out.season} 종료`}>
      <p className="big">
        {row?.position}위 · 승점 {row?.points}{' '}
        {label === 'PROMOTED' ? <Badge tone="good">▲ 승격</Badge> : label === 'RELEGATED' ? <Badge tone="bad">▼ 강등</Badge> : <Badge>잔류</Badge>}
      </p>
      <p className="muted small">우승: {snap.clubs[out.championId]?.name} · 상금 {formatKc(out.prizes[snap.userClubId] ?? 0)} (Phase 0: 실제 티어 이동 없음)</p>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={() => go({ tab: 'club', club: 'league' })}>
          시즌 결산 보기
        </button>
        <button type="button" className="btn btn-primary" onClick={() => run((s) => s.startNewSeason(), '새 시즌이 시작되었습니다')}>
          새 시즌 시작
        </button>
      </div>
    </Card>
  );
}

function DayResultSheet({ result, onClose }: { result: DayResult | null; onClose: () => void }) {
  const snap = useGame();
  const { go } = useNav();
  if (!result) return null;
  const userSum = result.matches.find((m) => m.matchId === result.userMatchId);
  return (
    <Sheet
      open
      title={`Day ${result.from.day} 결과`}
      onClose={onClose}
      footer={
        userSum ? (
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                go({ tab: 'match', matchId: userSum.matchId, matchView: 'replay' });
              }}
            >
              중계 보기
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onClose();
                go({ tab: 'match', matchId: userSum.matchId, matchView: 'report' });
              }}
            >
              리포트 보기
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            확인
          </button>
        )
      }
    >
      {userSum &&
        (() => {
          const { me, op, res, tone } = resultOf(userSum, snap.userClubId);
          return (
            <div className="result-hero">
              <span className="score">
                {me.goals} : {op.goals}
              </span>
              <Badge tone={tone}>{res}</Badge>
              <span>vs {snap.clubs[op.clubId]?.name}</span>
            </div>
          );
        })()}
      {result.userResolvedPlan && (
        <p className="small muted">
          적용 플랜: {PLAN_SOURCE_LABEL[result.userResolvedPlan.source]}
          {result.userResolvedPlan.adjustments.length > 0 && ` · 보정 ${result.userResolvedPlan.adjustments.length}건`}
        </p>
      )}
      {result.notices.length > 0 && (
        <ul className="list compact">
          {result.notices.map((n, i) => (
            <li key={i} className="list-row">
              {n}
            </li>
          ))}
        </ul>
      )}
      {result.ledger.length > 0 && (
        <>
          <h3 className="h3">재정 변동</h3>
          <ul className="list compact">
            {result.ledger.map((l, i) => (
              <li key={i} className="list-row">
                <span>{LEDGER_LABEL[l.kind]}</span>
                <strong className={l.amount >= 0 ? 'pos' : 'neg'}>{formatKc(l.amount, true)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.expiredProposals.length > 0 && <p className="small muted">만료된 제안 {result.expiredProposals.length}건</p>}
      {result.matches.length > 0 && (
        <>
          <h3 className="h3">오늘의 다른 경기</h3>
          <ul className="list compact">
            {result.matches
              .filter((m) => m.matchId !== result.userMatchId)
              .map((m) => (
                <li key={m.matchId} className="list-row">
                  <span>{snap.clubs[m.home.clubId]?.shortName}</span>
                  <strong>
                    {m.home.goals} : {m.away.goals}
                  </strong>
                  <span>{snap.clubs[m.away.clubId]?.shortName}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
