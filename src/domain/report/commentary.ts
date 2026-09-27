/** 결정 로그·이벤트 → 텍스트 중계 줄 (10.6 MVP 텍스트 해설). 소유: A. */
import type { ClubId, CommentaryLine, MatchEvent, MatchReplay, MatchResult } from '../../types';
import { hashString } from '../../engine';
import { chanceLabel } from './buildReport';

export interface ReplayNames {
  clubs?: Readonly<Record<string, string>>;
  players?: Readonly<Record<string, string>>;
}

const FILLER = [
  '{team} 가 후방에서 공을 돌리며 틈을 찾는다',
  '{team} 가 중원에서 점유를 이어간다',
  '양 팀이 중원에서 치열하게 공을 다툰다',
  '{team} 의 측면 전개가 시작된다',
  '{team} 가 라인을 끌어올린다',
];

export function buildReplay(result: MatchResult, names: ReplayNames = {}): MatchReplay {
  const homeId = result.home.clubId;
  const awayId = result.away.clubId;
  const club = (id: ClubId) => names.clubs?.[id] ?? id;
  const player = (id: string) => names.players?.[id] ?? id;
  const score: [number, number] = [0, 0];
  const lines: CommentaryLine[] = [];
  const push = (minute: number, kind: CommentaryLine['kind'], text: string, clubId?: ClubId) =>
    lines.push({ minute, kind, text, score: [score[0], score[1]], ...(clubId ? { clubId } : {}) });

  // 세그먼트별 필러 (결정 로그에서 그 구간 점유가 많은 팀 기준, 무작위 없이 해시로 문장 선택)
  const segPoss: [number, number][] = Array.from({ length: 18 }, () => [0, 0]);
  const zoneCounts: [number, number, number][] = Array.from({ length: 18 }, () => [0, 0, 0]);
  for (const L of result.log) {
    const seg = Math.min(17, Math.max(0, Math.floor((L.minute - 1) / 5)));
    const isHome = L.actor === homeId;
    if (L.kind === 'BINARY' && (L.dp === 'DP1' || L.dp === 'DP2' || L.dp === 'DP4')) segPoss[seg]![isHome ? 0 : 1] += 1;
    if (!isHome) continue;
    if (L.kind === 'CHOICE') zoneCounts[seg]![2] += 1;
    else if (L.dp === 'DP1') zoneCounts[seg]![0] += 1;
    else if (L.dp === 'DP2') zoneCounts[seg]![1] += 1;
  }

  const events: MatchEvent[] = result.events;
  let nextFillerSeg = 0;
  const flushFillers = (upToMinute: number) => {
    while (nextFillerSeg < 18 && nextFillerSeg * 5 + 3 <= upToMinute) {
      const [h, a] = segPoss[nextFillerSeg]!;
      const team = h >= a ? homeId : awayId;
      const idx = hashString(`${result.matchId}|${nextFillerSeg}`) % FILLER.length;
      push(nextFillerSeg * 5 + 3, 'NEUTRAL', FILLER[idx]!.replace('{team}', club(team)), team);
      nextFillerSeg += 1;
    }
  };

  for (const e of events) {
    flushFillers(e.minute - 1);
    switch (e.type) {
      case 'KICK_OFF':
        push(0, 'PERIOD', `킥오프! ${club(homeId)} vs ${club(awayId)}`);
        break;
      case 'HALF_TIME':
        push(45, 'PERIOD', `전반 종료 ${score[0]} : ${score[1]}`);
        break;
      case 'FULL_TIME':
        break;
      case 'SHOT':
        if (!e.goal) {
          const big = e.xg >= 0.2;
          push(e.minute, 'CHANCE', `${club(e.clubId)} ${player(e.playerId)} 의 ${chanceLabel(e.chance)} 슈팅${big ? ' — 결정적 기회였지만' : ''} 골문을 벗어난다 (xG ${e.xg.toFixed(2)})`, e.clubId);
        }
        break;
      case 'GOAL':
        if (e.clubId === homeId) score[0] += 1;
        else score[1] += 1;
        push(e.minute, 'GOAL', `골!!! ${club(e.clubId)} ${player(e.playerId)} (${chanceLabel(e.chance)}) — ${score[0]} : ${score[1]}`, e.clubId);
        break;
      case 'OFFSIDE':
        push(e.minute, 'TACTIC', `오프사이드! ${club(e.clubId)} 의 침투가 한발 빨랐다`, e.clubId);
        break;
      case 'LONG_BALL_ADVANCE':
        if (hashString(`${result.matchId}|lb|${e.minute}`) % 3 === 0) push(e.minute, 'TACTIC', `${club(e.clubId)} 의 롱볼이 압박을 뛰어넘는다`, e.clubId);
        break;
      case 'COUNTER_ATTACK':
        push(e.minute, 'TACTIC', `${club(e.clubId)} 역습 전개!`, e.clubId);
        break;
      case 'TRIGGER_FIRED':
        push(e.minute, 'TACTIC', `${club(e.clubId)} 조건부 지시 발동: ${e.description}`, e.clubId);
        break;
      case 'SUBSTITUTION':
        push(e.minute, 'SUB', `${club(e.clubId)} 교체: ${player(e.out)} OUT, ${player(e.in)} IN${e.reason === 'INJURY' ? ' (부상)' : ''}`, e.clubId);
        break;
      case 'INJURY':
        push(e.minute, 'CARD', `${club(e.clubId)} ${player(e.playerId)} 부상으로 쓰러진다 (${e.days}일)`, e.clubId);
        break;
      case 'RED_CARD':
        push(e.minute, 'CARD', `레드카드! ${club(e.clubId)} ${player(e.playerId)} 퇴장`, e.clubId);
        break;
      case 'YELLOW_CARD':
        push(e.minute, 'CARD', `경고! ${club(e.clubId)} ${player(e.playerId)}`, e.clubId);
        break;
      case 'CONDITION_DROP':
        break;
    }
  }
  flushFillers(90);
  push(90, 'PERIOD', `경기 종료 ${score[0]} : ${score[1]}`);
  lines.sort((a, b) => a.minute - b.minute);

  const zoneBars = zoneCounts.map(([a, b, c]) => {
    const t = a + b + c;
    return t > 0 ? ([round3(a / t), round3(b / t), round3(c / t)] as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
  });
  return { matchId: result.matchId, homeId, awayId, lines, momentum: [...result.momentum], zoneBars };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
