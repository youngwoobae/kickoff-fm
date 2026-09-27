/** C01 리그: 순위표(승강 구역), 일정, 시즌 결산 (소유: B) */
import { useState } from 'react';
import type { StandingRow } from '../../types';
import { Badge, Card, Empty, Segmented } from '../components/kit';
import { formatKc } from '../format';
import { useNav } from '../app/nav';
import { useAction, useGame, useQuery } from '../service/ServiceContext';

export function LeagueScreen() {
  const snap = useGame();
  const outcome = useQuery((s) => s.getSeasonOutcome()).data ?? null;
  const [view, setView] = useState<'table' | 'fixtures' | 'outcome'>(snap.phase === 'SEASON_OVER' ? 'outcome' : 'table');
  return (
    <div className="screen league">
      <Segmented
        label="리그 화면"
        size="sm"
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: '순위표' },
          { value: 'fixtures', label: '일정' },
          { value: 'outcome', label: '시즌 결산', disabled: !outcome },
        ]}
      />
      {view === 'table' && <StandingsTable />}
      {view === 'fixtures' && <FixturesView />}
      {view === 'outcome' && <OutcomeView />}
    </div>
  );
}

function ZoneMark({ zone }: { zone: StandingRow['zone'] }) {
  if (zone === 'PROMOTION') return <span className="zone-mark zone-up" aria-label="승격권">▲</span>;
  if (zone === 'RELEGATION') return <span className="zone-mark zone-down" aria-label="강등권">▼</span>;
  return <span className="zone-mark" aria-hidden="true" />;
}

export function StandingsTable({ rows: given }: { rows?: StandingRow[] }) {
  const snap = useGame();
  const q = useQuery((s) => s.getStandings());
  const rows = given ?? q.data ?? [];
  if (!rows.length) return <Empty>순위 정보가 없어요</Empty>;
  return (
    <Card className="card-flush">
      <table className="table">
        <caption className="sr-only">리그 순위표</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col" className="t-left">
              구단
            </th>
            <th scope="col">경기</th>
            <th scope="col">승-무-패</th>
            <th scope="col">득실</th>
            <th scope="col">승점</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = snap.clubs[r.clubId];
            return (
              <tr key={r.clubId} className={`zone-${r.zone.toLowerCase()} ${r.clubId === snap.userClubId ? 'is-me' : ''}`}>
                <td>
                  <ZoneMark zone={r.zone} />
                  {r.position}
                </td>
                <td className="t-left">
                  {c?.shortName ?? r.clubId}
                  {c?.isHuman && <span className="tag">나</span>}
                  <span className="form" aria-label={`최근 ${r.form.join(' ')}`}>
                    {r.form.map((f, i) => (
                      <span key={i} className={`form-${f}`}>
                        {f === 'W' ? '승' : f === 'D' ? '무' : '패'}
                      </span>
                    ))}
                  </span>
                </td>
                <td>{r.played}</td>
                <td>
                  {r.won}-{r.drawn}-{r.lost}
                </td>
                <td>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                <td>
                  <strong>{r.points}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="legend small">
        <span className="zone-mark zone-up">▲</span> 승격권 <span className="zone-mark zone-down">▼</span> 강등권 · 사람 구단은 “나”
      </p>
    </Card>
  );
}

function FixturesView() {
  const snap = useGame();
  const { go } = useNav();
  const [day, setDay] = useState(Math.min(26, Math.max(1, snap.time.day)));
  const [mine, setMine] = useState(false);
  const fixtures = useQuery((s) => (mine ? s.getFixtures({ clubId: snap.userClubId }) : s.getFixtures({ day })), [day, mine]).data ?? [];
  return (
    <>
      <div className="row-between">
        <Segmented label="일정 보기" size="sm" value={mine ? 'mine' : 'day'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'day', label: '날짜별' }, { value: 'mine', label: '우리 경기' }]} />
        {!mine && (
          <div className="stepper">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="이전 날" disabled={day <= 1} onClick={() => setDay((d) => d - 1)}>
              ‹
            </button>
            <span>Day {day}</span>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="다음 날" disabled={day >= 26} onClick={() => setDay((d) => d + 1)}>
              ›
            </button>
          </div>
        )}
      </div>
      <Card className="card-flush">
        <ul className="fixture-list">
          {fixtures.map((f) => {
            const s = snap.summaries[f.id];
            const mineFx = f.homeId === snap.userClubId || f.awayId === snap.userClubId;
            const content = (
              <>
                {mine && <span className="small muted fx-day">D{f.day}</span>}
                <span className="fx-team">{snap.clubs[f.homeId]?.shortName}</span>
                <span className="fx-score">{s ? `${s.home.goals} : ${s.away.goals}` : f.day === snap.time.day && snap.phase === 'MATCHDAY' ? '오늘' : 'vs'}</span>
                <span className="fx-team">{snap.clubs[f.awayId]?.shortName}</span>
              </>
            );
            return (
              <li key={f.id} className={mineFx ? 'is-me' : ''}>
                {mineFx && f.played ? (
                  <button type="button" className="fx-row" onClick={() => go({ tab: 'match', matchId: f.id, matchView: 'report' })}>
                    {content}
                  </button>
                ) : (
                  <div className="fx-row">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function OutcomeView() {
  const snap = useGame();
  const run = useAction();
  const out = useQuery((s) => s.getSeasonOutcome()).data;
  if (!out) return <Empty>시즌 결산은 Day 26 경기 후 나옵니다</Empty>;
  const myLabel = out.labels[snap.userClubId];
  const fin = snap.finances[snap.userClubId];
  return (
    <>
      <Card title={`시즌 ${out.season} 결산 · ${out.tier}`}>
        <p className="big">
          우승 🏆 {snap.clubs[out.championId]?.name}
        </p>
        <p>
          우리 구단:{' '}
          {myLabel === 'PROMOTED' ? <Badge tone="good">▲ 승격</Badge> : myLabel === 'RELEGATED' ? <Badge tone="bad">▼ 강등</Badge> : <Badge>잔류</Badge>} · 상금{' '}
          {formatKc(out.prizes[snap.userClubId] ?? 0)}
        </p>
        {fin && fin.transferOnlyBudget > 0 && <p className="small">이월 초과분 → 이적 한정 예산 {formatKc(fin.transferOnlyBudget)} (다음 시즌 Day 3 소멸)</p>}
        <p className="small muted">Phase 0에서는 실제 티어 이동이 없어요. 라벨과 보상만 표시합니다.</p>
        {snap.phase === 'SEASON_OVER' && (
          <button type="button" className="btn btn-primary btn-block" onClick={() => run((s) => s.startNewSeason(), '새 시즌이 시작되었습니다')}>
            새 시즌 시작 (나이 +1, 봇 재생성)
          </button>
        )}
      </Card>
      <h3 className="h3">최종 순위</h3>
      <StandingsTable rows={out.finalTable} />
      <Card title="승강 결과">
        <ul className="list compact">
          {out.finalTable.map((r) => (
            <li key={r.clubId} className="list-row">
              <span>
                {r.position}. {snap.clubs[r.clubId]?.shortName}
              </span>
              <span>
                {out.labels[r.clubId] === 'PROMOTED' ? '▲ 승격' : out.labels[r.clubId] === 'RELEGATED' ? '▼ 강등' : '잔류'} · {formatKc(out.prizes[r.clubId] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
