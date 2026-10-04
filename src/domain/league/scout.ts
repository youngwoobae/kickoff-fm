/** 상대 분석 요약 (12.3, 11 H01): 최근 5경기 포메이션·지시 요약 + 약점 한 줄. 소유: A. */
import type { BotStyle, Club, ClubId, MatchSummary, OpponentRecentMatch, OpponentScout, RuleId, StyleId, TeamInstructions } from '../../types';
import { legacyBotTag, nearestStyle } from '../../engine';
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
  R1: '빌드업이 압박에 약하다 — 전방 압박(압박 +1 이상)을 고려해 보세요',
  R2: '높은 라인 뒷공간이 약하다 — 패스 길게 + 빠른 공격수를 고려해 보세요',
  R3: '낮은 블록을 상대로 고전한다 — 라인을 내리고 역습을 노려 보세요',
  R4: '측면 수비가 좁다 — 폭을 넓혀 크로스·컷백을 노려 보세요',
  R5: '공격적으로 나오다 역습을 자주 허용한다 — 역습 중시 ON 을 고려해 보세요',
  R6: '침투형 공격수가 오프사이드 트랩에 걸린다 — 라인 +1 과 오프사이드 트랩을 고려해 보세요',
  R7: '중원 숫자가 부족하다 — 중앙 MF 가 많은 포메이션을 고려해 보세요',
  R9: '핵심 선수 의존도가 높다 — 집중 마크를 고려해 보세요',
  R10: '한쪽 측면 수비가 약하다 — 공략 측면 지정을 고려해 보세요',
  R11: '하프스페이스 커버가 약하다 — 메짤라·인사이드 포워드로 채널을 공략해 보세요',
  R12: '측면 수비수가 올라간 뒤 공간이 빈다 — 빠른 윙어로 1:1 을 노려 보세요',
  R13: '공중전·세컨드볼에 약하다 — 타깃맨과 패스 길게를 고려해 보세요',
  TEMPO: '빠른 템포에서 턴오버가 잦다 — 압박으로 실수를 유도해 보세요',
  LINE_FIT: '느린 수비수로 높은 라인을 쓴다 — 스루패스·역습을 노려 보세요',
};

const STYLE_HINT: Record<StyleId, string> = {
  BALANCED: '균형형: 큰 약점이 없다 — 상대 선수 약점(느린 CB, 공중전)을 노려 보세요',
  POSSESSION: '포지셔널형: 짧은 패스로 점유한다 — 로우 블록이나 전방 압박이 통할 수 있다',
  COUNTER: '미드 블록 역습형: 빠른 공격수가 뒷공간을 노린다 — 라인을 내리고 공격 성향 과잉은 피해 보세요',
  HIGH_PRESS: '게겐프레싱형: 압박이 강하고 라인이 높다 — 롱볼·타깃맨으로 압박을 건너뛰세요',
  LOW_BLOCK: '로우 블록형: 내려앉아 역습을 노린다 — 폭을 넓혀 크로스, 중거리를 노려 보세요',
  DIRECT: '다이렉트형: 타깃맨 롱볼과 세컨드볼 — 공중전에 강한 CB 나 3백이 도움이 된다',
  WING_PLAY: '윙 플레이형: 크로스가 많고 풀백이 올라간다 — 5백·와이드 미드필더, 중앙 수적 우위가 통한다',
  HIGH_LINE: '하이 라인형: 오프사이드 트랩을 쓴다 — 빠른 러너와 2선 침투(메짤라·섀도)로 뒷공간을 노려 보세요',
  WINGBACK_3: '3백 윙백형: 윙백 뒤 공간이 빈다 — 빠른 윙어로 측면 1:1 을 노려 보세요',
};

/** 봇 성향 (style 우선, 스키마 1 레거시 botStyle 은 'WIDE' → 'WING_PLAY') */
export function botStyleOf(club: Club | undefined): BotStyle | undefined {
  if (!club) return undefined;
  if (club.style) return club.style;
  if (club.botStyle) return club.botStyle === 'WIDE' ? 'WING_PLAY' : club.botStyle;
  return undefined;
}


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
  const bot = botStyleOf(club);
  const latest = mine[0] ? (mine[0].home.clubId === clubId ? mine[0].home : mine[0].away) : undefined;
  const style: StyleId | undefined = bot ?? (latest ? nearestStyle(latest.instructions).id : undefined);
  const weakness = top ? WEAKNESS_TEXT[top] : style ? STYLE_HINT[style] : '아직 경기 기록이 없어요. 몇 경기를 치르면 약점을 알려 드릴게요';
  return {
    clubId,
    ...(bot ? { botStyle: legacyBotTag(bot) } : {}),
    ...(style ? { style, styleEstimated: !bot } : {}),
    last5,
    weakness,
  };
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
