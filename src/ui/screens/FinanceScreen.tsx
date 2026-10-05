/** C04 재정 (소유: B) */
import { Card, Empty, Meter, Stat } from '../components/kit';
import { LEDGER_LABEL, MEMO_KINDS, formatKc, pct } from '../format';
import { useQuery } from '../service/ServiceContext';

/** 메모가 정보가 되는 항목만(선수 이름·한정 예산 사용분). 연봉·수당 메모는 내부 id 가 섞여 숨긴다 */

export function FinanceScreen() {
  const q = useQuery((s) => s.getFinance());
  const f = q.data;
  if (q.error) return <Empty>{q.error.message}</Empty>;
  if (!f) return null;
  const capTone = f.capUsage > 1 ? 'bad' : f.capUsage > 0.95 ? 'warn' : 'good';
  return (
    <div className="screen finance">
      <Card>
        <div className="stat-grid">
          <Stat label="KC 잔액" value={formatKc(f.balance)} />
          <Stat label="지출 가능액" value={formatKc(f.spendable)} sub="이적에 쓸 수 있는 돈 (입찰 예약액 제외)" />
          <Stat label="입찰 예약액" value={formatKc(f.reserved ?? 0)} sub="정산 때 풀리거나 지급돼요" />
          <Stat label="이번 시즌 수입" value={<span className="pos">{formatKc(f.seasonIncome, true)}</span>} />
          <Stat label="이번 시즌 지출" value={<span className="neg">{formatKc(-Math.abs(f.seasonExpense))}</span>} />
        </div>
      </Card>
      <Card title="연봉 캡">
        <div className="row-between small">
          <span>
            {formatKc(f.salaryTotal)} / {formatKc(f.salaryCap)}
          </span>
          <strong>{pct(f.capUsage, 1)}</strong>
        </div>
        <Meter value={f.capUsage} label="캡 사용률" tone={capTone} />
      </Card>
      <Card title="시즌 종료 예상 이월">
        <ul className="list compact">
          <li className="list-row">
            <span>예상 잔액</span>
            <span>{formatKc(f.projectedCarry.total)}</span>
          </li>
          <li className="list-row">
            <span>이월 상한 (배정금 20%)</span>
            <span>{formatKc(f.projectedCarry.cap)}</span>
          </li>
          <li className="list-row">
            <span>이월</span>
            <strong>{formatKc(f.projectedCarry.carried)}</strong>
          </li>
          <li className="list-row">
            <span>초과분 → 이적 한정 예산</span>
            <span>{formatKc(f.projectedCarry.excess)}</span>
          </li>
        </ul>
        {f.transferOnlyBudget > 0 && <p className="small">현재 이적 한정 예산 {formatKc(f.transferOnlyBudget)}</p>}
      </Card>
      <Card title="최근 내역">
        {f.recent.length === 0 ? (
          <Empty>내역이 없어요</Empty>
        ) : (
          <ul className="list compact">
            {f.recent.map((l, i) => (
              <li key={i} className="list-row">
                <span>
                  <span className="small muted">
                    시즌 {l.season} · Day {l.day}
                  </span>{' '}
                  {LEDGER_LABEL[l.kind]}
                  {l.memo && MEMO_KINDS.has(l.kind) && <span className="small muted"> · {l.memo}</span>}
                </span>
                <strong className={l.amount >= 0 ? 'pos' : 'neg'}>{formatKc(l.amount, true)}</strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
