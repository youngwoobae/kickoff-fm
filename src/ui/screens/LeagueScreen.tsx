/** C01 리그: 티어 탭(피라미드) · 순위표(승강 구역) · 일정 · 시즌 결산(승강 연출) (소유: B, 계약 2.1.0) */
import { useState } from 'react';
import type { ClubId, ClubMovement, LeagueId, LeagueInfo, PromotionLabel, SeasonOutcome, StandingRow, Tier } from '../../types';
import { Badge, Card, Empty, Segmented } from '../components/kit';
import { LABEL_TEXT, LABEL_TONE, formatKc, tierText } from '../format';
import { useNav } from '../app/nav';
import { useAction, useGame, useQuery } from '../service/ServiceContext';

export function LeagueScreen() {
  const snap = useGame();
  const outcome = useQuery((s) => s.getSeasonOutcome()).data ?? null;
  const pyramid = useQuery((s) => s.getPyramid?.() ?? null).data ?? null;
  const [view, setView] = useState<'table' | 'fixtures' | 'outcome'>(snap.phase === 'SEASON_OVER' ? 'outcome' : 'table');
  const [picked, setPicked] = useState<LeagueId | null>(null);
  // 승강으로 사용자 리그가 바뀌면 고른 탭이 사라질 수 있다 → 사용자 리그로
  const league = pyramid?.leagues.find((l) => l.id === picked) ?? pyramid?.leagues.find((l) => l.isUserLeague);
  return (
    <div className="screen league">
      <Segmented
        label="리그 화면"
        panelId="league-panel"
        size="sm"
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: '순위표' },
          { value: 'fixtures', label: '일정' },
          { value: 'outcome', label: '시즌 결산', disabled: !outcome },
        ]}
      />
      <div role="tabpanel" id="league-panel" aria-labelledby={`league-panel-tab-${view}`} className="screen">
        {view !== 'outcome' && pyramid && <TierTabs leagues={pyramid.leagues} value={league?.id} onChange={setPicked} />}
        {view !== 'outcome' && league && <LeagueHead league={league} />}
        {view === 'table' && <StandingsTable leagueId={league?.id} promote={league?.promoteCount} relegate={league?.relegateCount} />}
        {view === 'fixtures' && <FixturesView key={league?.id ?? 'user'} leagueId={league?.id} isUserLeague={league?.isUserLeague ?? true} />}
        {view === 'outcome' && <OutcomeView />}
      </div>
    </div>
  );
}

/** 티어 탭. 리그가 하나뿐이면(단일 리그 세이브) 탭을 숨긴다 */
function TierTabs({ leagues, value, onChange }: { leagues: LeagueInfo[]; value?: LeagueId; onChange(id: LeagueId): void }) {
  if (leagues.length < 2 || !value) return null;
  return (
    <Segmented
      label="리그 티어"
      value={value}
      onChange={onChange}
      options={leagues.map((l) => ({ value: l.id, label: l.isUserLeague ? `${l.tier}·나` : l.tier }))}
    />
  );
}

function LeagueHead({ league }: { league: LeagueInfo }) {
  return (
    <p className="league-head small">
      <strong>{tierText(league.tier)}</strong>
      {league.isUserLeague && <span className="tag">우리 리그</span>} · {league.clubIds.length}구단
      {league.promoteCount > 0 && <> · <span className="zone-up">▲</span> 승격 {league.promoteCount}</>}
      {league.relegateCount > 0 && <> · <span className="zone-down">▼</span> 강등 {league.relegateCount}</>}
    </p>
  );
}

function ZoneMark({ zone }: { zone: StandingRow['zone'] }) {
  if (zone === 'PROMOTION') return <span className="zone-mark zone-up" role="img" aria-label="승격권">▲</span>;
  if (zone === 'RELEGATION') return <span className="zone-mark zone-down" role="img" aria-label="강등권">▼</span>;
  return <span className="zone-mark" aria-hidden="true" />;
}

export function StandingsTable({ rows: given, leagueId, promote, relegate }: { rows?: StandingRow[]; leagueId?: LeagueId; promote?: number; relegate?: number }) {
  const snap = useGame();
  const q = useQuery((s) => (given ? given : s.getStandings(leagueId)), [given, leagueId]);
  const rows = q.data ?? [];
  if (q.error) return <Empty>이 리그의 순위는 아직 볼 수 없어요</Empty>;
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
                  <span className="form" role="img" aria-label={`최근 경기 ${r.form.map((f) => (f === 'W' ? '승' : f === 'D' ? '무' : '패')).join(' ')}`}>
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
        {promote !== 0 && (
          <>
            <span className="zone-mark zone-up">▲</span> 승격권{promote !== undefined && ` ${promote}구단`}{' '}
          </>
        )}
        {relegate !== 0 && (
          <>
            <span className="zone-mark zone-down">▼</span> 강등권{relegate !== undefined && ` ${relegate}구단`}{' '}
          </>
        )}
        · 사람 구단은 “나”
      </p>
    </Card>
  );
}

function FixturesView({ leagueId, isUserLeague }: { leagueId?: LeagueId; isUserLeague: boolean }) {
  const snap = useGame();
  const { go } = useNav();
  const [day, setDay] = useState(Math.min(26, Math.max(1, snap.time.day)));
  const [mineSel, setMine] = useState(false);
  const mine = mineSel && isUserLeague;
  const fixtures =
    useQuery((s) => (mine ? s.getFixtures({ leagueId, clubId: snap.userClubId }) : s.getFixtures({ leagueId, day })), [day, mine, leagueId]).data ?? [];
  return (
    <>
      <div className="row-between">
        {isUserLeague ? (
          <Segmented label="일정 보기" size="sm" value={mine ? 'mine' : 'day'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'day', label: '날짜별' }, { value: 'mine', label: '우리 경기' }]} />
        ) : (
          <span />
        )}
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
      {fixtures.length === 0 ? (
        <Empty>{isUserLeague ? '이 날은 경기가 없어요' : '이 리그의 일정은 아직 볼 수 없어요'}</Empty>
      ) : (
        <Card className="card-flush">
          <ul className="fixture-list">
            {fixtures.map((f) => {
              const s = snap.summaries[f.id];
              const mineFx = f.homeId === snap.userClubId || f.awayId === snap.userClubId;
              const content = (
                <>
                  {mine && <span className="small muted fx-day">D{f.day}</span>}
                  <span className="fx-team">{snap.clubs[f.homeId]?.shortName ?? f.homeId}</span>
                  <span className="fx-score">{s ? `${s.home.goals} : ${s.away.goals}` : f.played ? '종료' : f.day === snap.time.day && snap.phase === 'MATCHDAY' ? '오늘' : 'vs'}</span>
                  <span className="fx-team">{snap.clubs[f.awayId]?.shortName ?? f.awayId}</span>
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
      )}
    </>
  );
}

/** 사용자 구단의 시즌 결과: 실제 이동(movements)이 있으면 그것, 없으면 labels 폴백 */
export function userResult(out: SeasonOutcome, clubId: ClubId): { label: PromotionLabel; move?: ClubMovement; real: boolean } {
  if (out.movements) {
    const move = out.movements.find((m) => m.clubId === clubId);
    return { label: move?.kind ?? 'STAYED', move, real: true };
  }
  return { label: out.labels[clubId] ?? 'STAYED', real: false };
}

/** 시즌 결산 승강 연출 (기호 ▲▼ + 문구 병기, 모션 줄이기면 정지) */
export function PromotionBanner({ out }: { out: SeasonOutcome }) {
  const snap = useGame();
  const { label, move, real } = userResult(out, snap.userClubId);
  const row = out.finalTable.find((r) => r.clubId === snap.userClubId);
  const title = label === 'PROMOTED' ? '▲ 승격!' : label === 'RELEGATED' ? '▼ 강등' : '– 잔류';
  const sub = move ? `${tierText(move.from)} → ${tierText(move.to)}` : label === 'STAYED' ? `${tierText(out.tier)} 잔류` : tierText(out.tier);
  return (
    <div className={`promo-banner promo-${LABEL_TONE[label]}`} role="status">
      <div className="promo-title">{title}</div>
      <div className="promo-sub">
        {row && `${row.position}위 · 승점 ${row.points} · `}
        {sub}
      </div>
      {!real && <div className="promo-note small muted">이 세이브는 실제 티어 이동 없이 라벨만 표시해요</div>}
    </div>
  );
}

const TIER_ORDER: Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

function OutcomeView() {
  const snap = useGame();
  const run = useAction();
  const out = useQuery((s) => s.getSeasonOutcome()).data;
  if (!out) return <Empty>시즌 결산은 Day 26 경기 뒤에 나와요</Empty>;
  const fin = snap.finances[snap.userClubId];
  const { label, move } = userResult(out, snap.userClubId);
  return (
    <>
      <PromotionBanner out={out} />
      <Card title={`시즌 ${out.season} 결산 · ${tierText(out.tier)}`}>
        <p className="big">우승 🏆 {snap.clubs[out.championId]?.name}</p>
        <p>
          우리 구단: <Badge tone={LABEL_TONE[label]}>{LABEL_TEXT[label]}</Badge> · 상금{' '}
          {formatKc(out.prizes[snap.userClubId] ?? 0)}
        </p>
        {fin && fin.transferOnlyBudget > 0 && <p className="small">이월 초과분 → 이적 한정 예산 {formatKc(fin.transferOnlyBudget)} (다음 시즌 Day 3 소멸)</p>}
        {snap.phase === 'SEASON_OVER' && (
          <button type="button" className="btn btn-primary btn-block" onClick={() => run((s) => s.startNewSeason(), '새 시즌을 시작했어요')}>
            새 시즌 시작{move ? ` (${tierText(move.to)})` : ''}
          </button>
        )}
      </Card>
      <h3 className="h3">최종 순위</h3>
      <StandingsTable rows={out.finalTable} />
      {out.movements ? <MovementsCard movements={out.movements} /> : <LabelsCard out={out} />}
    </>
  );
}

/** 전 리그 실제 이동 (2.1.0 movements) */
function MovementsCard({ movements }: { movements: ClubMovement[] }) {
  const snap = useGame();
  if (!movements.length) return <Card title="승강 결과">이번 시즌 이동한 구단이 없어요</Card>;
  return (
    <Card title="승강 결과 (전 리그)">
      {TIER_ORDER.map((t) => {
        const ms = movements.filter((m) => m.from === t).sort((a, b) => a.position - b.position);
        if (!ms.length) return null;
        return (
          <div key={t}>
            <h4 className="h4">{tierText(t)}</h4>
            <ul className="list compact">
              {ms.map((m) => (
                <li key={m.clubId} className={`list-row ${m.isHuman ? 'is-me' : ''}`}>
                  <span>
                    {m.position}위 {snap.clubs[m.clubId]?.shortName ?? m.clubId}
                    {m.isHuman && <span className="tag">나</span>}
                  </span>
                  <span className={m.kind === 'PROMOTED' ? 'zone-up' : 'zone-down'}>
                    {LABEL_TEXT[m.kind]} → {m.to}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Card>
  );
}

/** 폴백: 실제 이동이 없는 세이브. labels 는 사람 구단 기준이라 나머지는 순위 구역으로 표시 */
function LabelsCard({ out }: { out: SeasonOutcome }) {
  const snap = useGame();
  const labelOf = (r: StandingRow): PromotionLabel =>
    r.clubId === snap.userClubId ? (out.labels[r.clubId] ?? 'STAYED') : r.zone === 'PROMOTION' ? 'PROMOTED' : r.zone === 'RELEGATION' ? 'RELEGATED' : 'STAYED';
  return (
    <Card title="승강 결과">
      <ul className="list compact">
        {out.finalTable.map((r) => (
          <li key={r.clubId} className={`list-row ${r.clubId === snap.userClubId ? 'is-me' : ''}`}>
            <span>
              {r.position}. {snap.clubs[r.clubId]?.shortName}
            </span>
            <span>
              {LABEL_TEXT[labelOf(r)]} · {formatKc(out.prizes[r.clubId] ?? 0)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
