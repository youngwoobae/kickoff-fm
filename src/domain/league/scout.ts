/** 상대 분석 요약 (12.3, 11 H01): 최근 5경기 포메이션·지시 요약 + 약점 한 줄. 소유: A. */
import type { BotStyleTag, Club, ClubId, MatchSummary, OpponentRecentMatch, OpponentScout, RuleId, TeamInstructions } from '../../types';
import type { TacticShape } from '../ai/matchup';

const LABELS: [keyof TeamInstructions, string][] = [
  ['mentality', '공격 성향'],
  ['press', '압박'],
  ['line', '라인'],
  ['width', '폭'],
  ['tempo', '템포'],
  ['directness', '패스'],
];

export function summarizeInstructions(i: TeamInstructions): string {
  const parts: string[] = [];
  for (const [k, label] of LABELS) {
    const v = i[k] as number;
    if (v === 0) continue;
    if (k === 'directness') parts.push(v > 0 ? `패스 길게${v === 2 ? ' +2' : ''}` : `패스 짧게${v === -2 ? ' −2' : ''}`);
    else parts.push(`${label} ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
  }
  if (i.counter) parts.push('역습 ON');
  if (i.offsideTrap) parts.push('오프사이드 트랩');
  return parts.length > 0 ? parts.join(' · ') : '균형 (모든 지시 0)';
}

const WEAKNESS_TEXT: Record<RuleId, string> = {
  R1: '빌드업이 압박에 약하다 — 전방 압박(압박 +1 이상)을 고려하세요',
  R2: '높은 라인 뒷공간이 약하다 — 패스 길게 + 빠른 공격수를 고려하세요',
  R3: '낮은 블록을 상대로 고전한다 — 라인을 내리고 역습을 노려 보세요',
  R4: '측면 수비가 좁다 — 폭을 넓혀 크로스·컷백을 노려 보세요',
  R5: '공격적으로 나오다 역습을 자주 허용한다 — 역습 중시 ON 을 고려하세요',
  R6: '침투형 공격수가 오프사이드 트랩에 걸린다 — 라인 +1 과 오프사이드 트랩을 고려하세요',
  R7: '중원 숫자가 부족하다 — 중앙 MF 가 많은 포메이션을 고려하세요',
  R9: '핵심 선수 의존도가 높다 — 집중 마크를 고려하세요',
  R10: '한쪽 측면 수비가 약하다 — 공략 측면 지정을 고려하세요',
  TEMPO: '빠른 템포에서 턴오버가 잦다 — 압박으로 실수를 유도해 보세요',
  LINE_FIT: '느린 수비수로 높은 라인을 쓴다 — 스루패스·역습을 노려 보세요',
};

const STYLE_HINT: Record<BotStyleTag, string> = {
  POSSESSION: '점유형: 짧은 패스로 빌드업한다 — 전방 압박이나 낮은 블록이 통할 수 있다',
  COUNTER: '역습형: 롱볼과 빠른 전환을 쓴다 — 공격 성향을 낮추고 라인을 내리는 편이 안전하다',
  HIGH_PRESS: '전방압박형: 라인이 높다 — 롱볼·침투로 뒷공간을 노려 보세요',
  LOW_BLOCK: '잠그기형: 내려앉아 역습을 노린다 — 폭을 넓히고 공격 성향 과잉은 피하세요',
  WIDE: '측면형: 크로스가 많다 — 5백이나 수비형 풀백이 도움이 된다',
};

export function buildOpponentScout(clubs: Readonly<Record<string, Club>>, summaries: readonly MatchSummary[], clubId: ClubId): OpponentScout {
  const club = clubs[clubId];
  const mine = summaries
    .filter((s) => s.home.clubId === clubId || s.away.clubId === clubId)
    .sort((a, b) => b.season - a.season || b.day - a.day)
    .slice(0, 5);
  const last5: OpponentRecentMatch[] = mine.map((s) => {
    const me = s.home.clubId === clubId ? s.home : s.away;
    const op = me === s.home ? s.away : s.home;
    return {
      matchId: s.matchId,
      day: s.day,
      opponentId: op.clubId,
      goalsFor: me.goals,
      goalsAgainst: op.goals,
      formation: me.formation,
      instructionsSummary: summarizeInstructions(me.instructions),
    };
  });
  // 약점: 최근 5경기에서 상대(= 이 팀의 상대들)가 가장 많이 이득 본 규칙
  const against: Partial<Record<RuleId, number>> = {};
  for (const s of mine) {
    const op = s.home.clubId === clubId ? s.away : s.home;
    for (const k of Object.keys(op.ruleFires) as RuleId[]) against[k] = (against[k] ?? 0) + (op.ruleFires[k] ?? 0);
  }
  const top = (Object.keys(against) as RuleId[]).filter((k) => k !== 'TEMPO').sort((a, b) => (against[b] ?? 0) - (against[a] ?? 0) || a.localeCompare(b))[0];
  const weakness = top
    ? WEAKNESS_TEXT[top]
    : club?.botStyle
      ? STYLE_HINT[club.botStyle]
      : '아직 경기 기록이 없어 분석할 수 없습니다';
  return { clubId, ...(club?.botStyle ? { botStyle: club.botStyle } : {}), last5, weakness };
}

/** 가장 최근 경기에서 사용한 전술 (봇 슬롯 선택용). 기록이 없으면 구단 슬롯 A */
export function lastTacticOf(clubs: Readonly<Record<string, Club>>, summaries: readonly MatchSummary[], clubId: ClubId): TacticShape | undefined {
  let latest: MatchSummary | undefined;
  for (const s of summaries) {
    if (s.home.clubId !== clubId && s.away.clubId !== clubId) continue;
    if (!latest || s.season > latest.season || (s.season === latest.season && s.day > latest.day)) latest = s;
  }
  if (latest) {
    const me = latest.home.clubId === clubId ? latest.home : latest.away;
    return { formation: me.formation, instructions: me.instructions };
  }
  const c = clubs[clubId];
  return c ? { formation: c.tactics.A.formation, instructions: c.tactics.A.instructions, roles: c.tactics.A.roles } : undefined;
}
