/**
 * 시즌 판정 (6.2, 6.5 ①②③). M3.3: 사람 구단 라벨은 리그별 승강 인원(movesOf, 메인 결정 U-1)을 따른다 —
 * 위 promote 위 안 = PROMOTED, 아래 relegate 위 안 = RELEGATED (T1 승격·T5 강등 없음). D6 로 봇 비율 규칙은 폐기.
 * 실제 이동(movements)은 호출자가 전 리그 순위표로 채운다(pyramid.ts seasonMovements). 소유: A.
 */
import type { Club, Kc, PromotionLabel, SeasonNo, SeasonOutcome, StandingRow, Tier } from '../../types';
import { TIER_ECONOMY, prizeFor } from '../economy/economy';
import { movesOf } from './pyramid';

export function judgeSeason(
  season: SeasonNo,
  tier: Tier,
  finalTable: readonly StandingRow[],
  clubs: Readonly<Record<string, Club>>,
): SeasonOutcome {
  const m = movesOf(tier);
  const n = finalTable.length;
  const labels: Record<string, PromotionLabel> = {};
  for (const h of finalTable.filter((r) => clubs[r.clubId]?.isHuman)) {
    labels[h.clubId] = h.position <= m.promote ? 'PROMOTED' : h.position > n - m.relegate ? 'RELEGATED' : 'STAYED';
  }
  const econ = TIER_ECONOMY[tier];
  const prizes: Record<string, Kc> = {};
  for (const r of finalTable) {
    const p = prizeFor(econ, r.position);
    prizes[r.clubId] = p.prize + p.champion;
  }
  return {
    season,
    tier,
    finalTable: finalTable.map((r) => ({ ...r, form: [...r.form] })),
    championId: finalTable[0]?.clubId ?? '',
    labels,
    prizes,
  };
}
