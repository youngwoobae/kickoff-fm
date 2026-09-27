/**
 * 시즌 판정 (6.2, 6.5 ①②③). Phase 0: 사람 팀 1개 → 봇 비율 > 40% 규칙에 따라
 * 전체 1·2위일 때만 PROMOTED, 전체 11~14위면 RELEGATED (T5 는 강등 없음). 실제 티어 이동 없음. 소유: A.
 */
import type { Club, Kc, PromotionLabel, SeasonNo, SeasonOutcome, StandingRow, Tier } from '../../types';
import { TIER_ECONOMY, prizeFor } from '../economy/economy';

const LEAGUE_SIZE = 14;

export function judgeSeason(
  season: SeasonNo,
  tier: Tier,
  finalTable: readonly StandingRow[],
  clubs: Readonly<Record<string, Club>>,
): SeasonOutcome {
  const humans = finalTable.filter((r) => clubs[r.clubId]?.isHuman);
  const botRatio = 1 - humans.length / LEAGUE_SIZE;
  const promoteLimitRank = botRatio > 0.4 ? 2 : 4;
  const promoted = tier === 'T1' ? [] : humans.filter((r) => r.position <= promoteLimitRank).slice(0, 2);
  const relegated = tier === 'T5' ? [] : humans.filter((r) => r.position >= 11);
  const labels: Record<string, PromotionLabel> = {};
  for (const h of humans) {
    labels[h.clubId] = promoted.includes(h) ? 'PROMOTED' : relegated.includes(h) ? 'RELEGATED' : 'STAYED';
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
