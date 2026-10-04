/** C05 커리어 기록: 시즌별 티어·순위·승점, 트로피, 최고 티어 (소유: B, 계약 2.1.0 getCareer) */
import { Badge, Card, Empty, Stat } from '../components/kit';
import { LABEL_TEXT, LABEL_TONE, TIER_NAME, tierText } from '../format';
import { useQuery } from '../service/ServiceContext';

export function CareerScreen() {
  const q = useQuery((s) => s.getCareer?.() ?? null);
  const c = q.data;
  if (q.error) return <Empty>커리어 기록을 불러오지 못했어요 ({q.error.message})</Empty>;
  if (!c) return <Empty>커리어 기록은 아직 볼 수 없어요</Empty>;
  const seasons = [...c.seasons].reverse(); // 최신 시즌이 위
  return (
    <div className="screen career">
      <Card title="커리어 요약">
        <div className="stat-grid">
          <Stat label="현재" value={c.currentTier} sub={TIER_NAME[c.currentTier]} />
          <Stat label="최고 티어" value={c.highestTier} sub={TIER_NAME[c.highestTier]} />
          <Stat label="시작" value={c.startTier} sub={TIER_NAME[c.startTier]} />
          <Stat label="우승" value={`🏆 ${c.trophies.length}`} sub={`${c.seasons.length}시즌 완료`} />
        </div>
      </Card>
      {c.trophies.length > 0 && (
        <Card title="트로피">
          <ul className="list compact">
            {c.trophies.map((t) => (
              <li key={`${t.season}-${t.tier}`} className="list-row">
                <span>🏆 시즌 {t.season} 리그 우승</span>
                <span className="small muted">{tierText(t.tier)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <h3 className="h3">시즌별 기록</h3>
      {seasons.length === 0 ? (
        <Empty>첫 시즌이 끝나면 기록이 쌓여요</Empty>
      ) : (
        <Card className="card-flush">
          <table className="table">
            <caption className="sr-only">시즌별 커리어 기록</caption>
            <thead>
              <tr>
                <th scope="col">시즌</th>
                <th scope="col">티어</th>
                <th scope="col">순위</th>
                <th scope="col">승점</th>
                <th scope="col">승-무-패</th>
                <th scope="col" className="t-left">
                  결과
                </th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((x) => (
                <tr key={x.season}>
                  <td>{x.season}</td>
                  <td title={TIER_NAME[x.tier]}>{x.tier}</td>
                  <td>{x.position}위</td>
                  <td>
                    <strong>{x.points}</strong>
                  </td>
                  <td>
                    {x.won}-{x.drawn}-{x.lost}
                  </td>
                  <td className="t-left">
                    <Badge tone={LABEL_TONE[x.label]}>{LABEL_TEXT[x.label]}</Badge>
                    {x.champion && <span className="tag">🏆 우승</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
