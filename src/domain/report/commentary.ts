/** 결정 로그·이벤트 → 텍스트 중계 줄 (10.6 MVP 텍스트 해설) + 2D 연출 큐(2.4.0). 소유: A. */
import type { ClubId, CommentaryLine, Lane, MatchEvent, MatchReplay, MatchResult, PitchCue, Zone } from '../../types';
import { hashString } from '../../engine';
import { josa } from '../josa';
import { chanceLabel } from './buildReport';

export interface ReplayNames {
  clubs?: Readonly<Record<string, string>>;
  players?: Readonly<Record<string, string>>;
}

const FILLER: ((team: string) => string)[] = [
  (t) => `${josa(t, '이/가')} 후방에서 공을 돌리며 틈을 찾는다`,
  (t) => `${josa(t, '이/가')} 중원에서 점유를 이어간다`,
  () => '양 팀이 중원에서 치열하게 공을 다툰다',
  (t) => `${t}의 측면 전개가 시작된다`,
  (t) => `${josa(t, '이/가')} 라인을 끌어올린다`,
];

const LANES: readonly Lane[] = ['L', 'C', 'R'];
/** 2.4.0 ballTrack 상한 (온보딩_UX 4.6) */
const BALL_TRACK_MAX = 300;
/** 최빈값 인덱스. 동률이면 order 앞쪽 */
const mode = (counts: readonly number[], order: readonly number[]): number =>
  order.reduce((best, i) => (counts[i]! > counts[best]! ? i : best), order[0]!);

export function buildReplay(result: MatchResult, names: ReplayNames = {}): MatchReplay {
  const homeId = result.home.clubId;
  const awayId = result.away.clubId;
  const club = (id: ClubId) => names.clubs?.[id] ?? id;
  const player = (id: string) => names.players?.[id] ?? id;
  const teamOf = (id: ClubId): PitchCue['team'] => (id === homeId ? 'HOME' : 'AWAY');
  const score: [number, number] = [0, 0];
  const lines: CommentaryLine[] = [];
  /** 현재 처리 중인 이벤트의 추가시간 분 (1.3.0 CommentaryLine.addedMinute) */
  let added = 0;
  const push = (minute: number, kind: CommentaryLine['kind'], text: string, clubId?: ClubId, event?: MatchEvent['type'], pitch?: PitchCue) =>
    lines.push({
      minute,
      ...(added ? { addedMinute: added } : {}),
      kind,
      text,
      score: [score[0], score[1]],
      ...(clubId ? { clubId } : {}),
      ...(event ? { event } : {}),
      ...(pitch ? { pitch } : {}),
    });

  // 세그먼트별 필러 (결정 로그에서 그 구간 점유가 많은 팀 기준, 무작위 없이 해시로 문장 선택)
  const segPoss: [number, number][] = Array.from({ length: 18 }, () => [0, 0]);
  const zoneCounts: [number, number, number][] = Array.from({ length: 18 }, () => [0, 0, 0]);
  // 2.4.0 (2D, 로그 복사만): 분|팀 별 DP5 순서 = 같은 분|팀 SHOT 이벤트 순서(shoot() 가 DP5 1개 → SHOT 1개)
  const shotCues = new Map<string, { zone: Zone; lane: Lane }[]>();
  /** 분|팀 별 마지막 결정 레인 (오프사이드·롱볼·역습 줄) */
  const lastLane = new Map<string, Lane>();
  /** 진행 중인 공격 시퀀스의 레인 (DP3·DP4 가 정함, DP1·DP2·DP6·DP7 에서 지움) — side 없는 DP5(코너·프리킥·역습) 용 */
  const seqLane = new Map<ClubId, Lane>();
  /** 세그먼트 × 팀(0 홈·1 원정) 구역·레인 빈도 (필러 줄) */
  const segZone = Array.from({ length: 18 }, () => [[0, 0, 0], [0, 0, 0]] as number[][]);
  const segLane = Array.from({ length: 18 }, () => [[0, 0, 0], [0, 0, 0]] as number[][]);
  const track: [number, 0 | 1, Zone, 0 | 1 | 2][] = [];
  for (const L of result.log) {
    const seg = Math.min(17, Math.max(0, Math.floor((L.minute - 1) / 5)));
    const isHome = L.actor === homeId;
    const ti = isHome ? 0 : 1;
    const key = `${L.minute}|${L.actor}`;
    if (L.dp === 'DP1' || L.dp === 'DP2' || L.dp === 'DP6' || L.dp === 'DP7') seqLane.delete(L.actor);
    if (L.side) {
      lastLane.set(key, L.side);
      if (L.dp === 'DP3' || L.dp === 'DP4') seqLane.set(L.actor, L.side);
    }
    if (L.dp === 'DP5') {
      const q = shotCues.get(key) ?? [];
      q.push({ zone: L.zone ?? 2, lane: L.side ?? seqLane.get(L.actor) ?? 'C' });
      shotCues.set(key, q);
    }
    const z: Zone | undefined = L.dp === 'DP1' ? 0 : L.dp === 'DP2' ? 1 : L.dp === 'DP3' || L.dp === 'DP4' ? 2 : undefined;
    const laneIdx = LANES.indexOf(L.side ?? 'C') as 0 | 1 | 2;
    if (z !== undefined) {
      segZone[seg]![ti]![z]! += 1;
      segLane[seg]![ti]![laneIdx]! += 1;
    }
    // 공 경로: DP1~DP4 + 턴오버 성공(DP6, zone 은 잃은 팀 기준이라 뒤집음)
    const tz = z ?? (L.kind === 'BINARY' && L.dp === 'DP6' && L.success && L.zone !== undefined ? ((2 - L.zone) as Zone) : undefined);
    if (tz !== undefined) track.push([L.minute, ti, tz, laneIdx]);

    if (L.kind === 'BINARY' && (L.dp === 'DP1' || L.dp === 'DP2' || L.dp === 'DP4')) segPoss[seg]![ti] += 1;
    if (!isHome) continue;
    if (L.kind === 'CHOICE') zoneCounts[seg]![2] += 1;
    else if (L.dp === 'DP1') zoneCounts[seg]![0] += 1;
    else if (L.dp === 'DP2') zoneCounts[seg]![1] += 1;
  }
  const laneAt = (minute: number, id: ClubId): Lane => lastLane.get(`${minute}|${id}`) ?? 'C';
  const shotSeen = new Map<string, number>();
  let lastShotCue: PitchCue | undefined;

  const events: MatchEvent[] = result.events;
  let nextFillerSeg = 0;
  const flushFillers = (upToMinute: number) => {
    while (nextFillerSeg < 18 && nextFillerSeg * 5 + 3 <= upToMinute) {
      const [h, a] = segPoss[nextFillerSeg]!;
      const team = h >= a ? homeId : awayId;
      const ti = team === homeId ? 0 : 1;
      const idx = hashString(`${result.matchId}|${nextFillerSeg}`) % FILLER.length;
      const pitch: PitchCue = {
        team: teamOf(team),
        zone: mode(segZone[nextFillerSeg]![ti]!, [1, 0, 2]) as Zone,
        lane: LANES[mode(segLane[nextFillerSeg]![ti]!, [1, 0, 2])]!,
      };
      push(nextFillerSeg * 5 + 3, 'NEUTRAL', FILLER[idx]!(club(team)), team, undefined, pitch);
      nextFillerSeg += 1;
    }
  };

  for (const e of events) {
    added = 0;
    flushFillers(e.minute - 1);
    added = e.addedMinute ?? 0;
    switch (e.type) {
      case 'KICK_OFF':
        push(0, 'PERIOD', `킥오프! ${club(homeId)} vs ${club(awayId)}`, undefined, e.type, { team: 'HOME', zone: 1, lane: 'C' });
        break;
      case 'HALF_TIME':
        push(45, 'PERIOD', `전반 종료 ${score[0]} : ${score[1]}`, undefined, e.type);
        break;
      case 'FULL_TIME':
        break;
      case 'SHOT': {
        const key = `${e.minute}|${e.clubId}`;
        const n = shotSeen.get(key) ?? 0;
        shotSeen.set(key, n + 1);
        const at = shotCues.get(key)?.[n] ?? { zone: 2 as Zone, lane: 'C' as Lane };
        lastShotCue = {
          team: teamOf(e.clubId),
          zone: at.zone,
          lane: at.lane,
          // 슈터를 못 고른 경우 엔진은 playerId 에 clubId 를 넣는다
          ...(e.playerId !== e.clubId ? { playerId: e.playerId } : {}),
          chance: e.chance,
          ...(e.onTarget !== undefined ? { onTarget: e.onTarget } : {}),
        };
        if (!e.goal) {
          const big = e.xg >= 0.2;
          push(e.minute, 'CHANCE', `${club(e.clubId)} ${player(e.playerId)}의 ${chanceLabel(e.chance)} 슈팅${big ? ' — 결정적 기회였지만' : ''} 골문을 벗어난다 (xG ${e.xg.toFixed(2)})`, e.clubId, e.type, lastShotCue);
        }
        break;
      }
      case 'GOAL':
        if (e.clubId === homeId) score[0] += 1;
        else score[1] += 1;
        push(e.minute, 'GOAL', `골! ${club(e.clubId)} ${player(e.playerId)} (${chanceLabel(e.chance)}) — ${score[0]} : ${score[1]}`, e.clubId, e.type, lastShotCue && { ...lastShotCue, onTarget: true });
        break;
      case 'OFFSIDE':
        push(e.minute, 'TACTIC', `오프사이드! ${club(e.clubId)}의 침투가 한발 빨랐다`, e.clubId, e.type, {
          team: teamOf(e.clubId),
          zone: 2,
          lane: laneAt(e.minute, e.clubId),
          ...(e.playerId ? { playerId: e.playerId } : {}),
        });
        break;
      case 'LONG_BALL_ADVANCE':
        if (hashString(`${result.matchId}|lb|${e.minute}`) % 3 === 0)
          push(e.minute, 'TACTIC', `${club(e.clubId)}의 롱볼이 압박을 뛰어넘는다`, e.clubId, e.type, { team: teamOf(e.clubId), zone: 1, lane: laneAt(e.minute, e.clubId) });
        break;
      case 'COUNTER_ATTACK':
        push(e.minute, 'TACTIC', `${club(e.clubId)} 역습 전개!`, e.clubId, e.type, { team: teamOf(e.clubId), zone: 1, lane: laneAt(e.minute, e.clubId) });
        break;
      case 'TRIGGER_FIRED':
        push(e.minute, 'TACTIC', `${club(e.clubId)} 조건부 지시 발동: ${e.description}`, e.clubId, e.type);
        break;
      case 'SUBSTITUTION':
        push(e.minute, 'SUB', `${club(e.clubId)} 교체: ${player(e.out)} OUT, ${player(e.in)} IN${e.reason === 'INJURY' ? ' (부상)' : ''}`, e.clubId, e.type);
        break;
      case 'INJURY':
        push(e.minute, 'CARD', `${club(e.clubId)} ${player(e.playerId)} 부상으로 쓰러진다 (${e.days}일)`, e.clubId, e.type);
        break;
      case 'RED_CARD':
        push(e.minute, 'CARD', `레드카드! ${club(e.clubId)} ${player(e.playerId)} 퇴장`, e.clubId, e.type);
        break;
      case 'YELLOW_CARD':
        // UI(MatchCenterScreen isYellow)가 아직 '경고' 접두어로 판정한다 — event 로 옮길 때까지 접두어 유지
        push(e.minute, 'CARD', `경고! ${club(e.clubId)} ${player(e.playerId)}`, e.clubId, e.type);
        break;
      case 'CONDITION_DROP':
        break;
    }
  }
  added = 0;
  flushFillers(90);
  push(90, 'PERIOD', `경기 종료 ${score[0]} : ${score[1]}`, undefined, 'FULL_TIME');
  lines.sort((a, b) => a.minute - b.minute);

  const zoneBars = zoneCounts.map(([a, b, c]) => {
    const t = a + b + c;
    return t > 0 ? ([round3(a / t), round3(b / t), round3(c / t)] as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
  });
  const ballTrack =
    track.length <= BALL_TRACK_MAX ? track : Array.from({ length: BALL_TRACK_MAX }, (_, i) => track[Math.floor((i * track.length) / BALL_TRACK_MAX)]!);
  return {
    matchId: result.matchId,
    homeId,
    awayId,
    lines,
    momentum: [...result.momentum],
    zoneBars,
    formations: { home: result.home.formationStart, away: result.away.formationStart },
    ballTrack,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
