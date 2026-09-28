/** 8.8 리포트 블록 1·2·3·4·5·6·8 조립. 소유: A. */
import type {
  ClubId,
  FactorCard,
  LuckIndicator,
  MatchExplanation,
  MatchReport,
  MatchResult,
  MatchSummary,
  RuleId,
  Suggestion,
  TeamInstructions,
  TimelineItem,
  ZoneFlowRow,
} from '../../types';
import { RULE_DEFS } from '../../engine';

export interface LeagueAverages {
  /** Z0, Z1, Z2 통과율 */
  zonePass: [number, number, number];
  /** 팀·경기당 평균 발동 수 */
  ruleFiresPerMatch: Partial<Record<RuleId, number>>;
}

/** 요약이 없을 때 쓰는 기본 리그 평균 (엔진 0.2.0 BASELINE 배치 측정값 근사) */
export const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = { zonePass: [0.76, 0.37, 0.3], ruleFiresPerMatch: {} };

export const LUCK_THRESHOLD = 1.0;

export function computeLeagueAverages(summaries: readonly MatchSummary[]): LeagueAverages {
  if (summaries.length === 0) return DEFAULT_LEAGUE_AVERAGES;
  const zs = [
    [0, 0],
    [0, 0],
    [0, 0],
  ] as [number, number][];
  const fires: Partial<Record<RuleId, number>> = {};
  let teams = 0;
  for (const s of summaries) {
    for (const t of [s.home, s.away]) {
      teams += 1;
      const z = [t.zonePass.z0, t.zonePass.z1, t.zonePass.z2];
      z.forEach((zp, i) => {
        zs[i]![0] += zp.attempts;
        zs[i]![1] += zp.successes;
      });
      for (const k of Object.keys(t.ruleFires) as RuleId[]) fires[k] = (fires[k] ?? 0) + (t.ruleFires[k] ?? 0);
    }
  }
  const rate = (i: number) => (zs[i]![0] > 0 ? zs[i]![1] / zs[i]![0] : 0);
  const per: Partial<Record<RuleId, number>> = {};
  for (const k of Object.keys(fires) as RuleId[]) per[k] = round2((fires[k] ?? 0) / teams);
  return { zonePass: [round3(rate(0)), round3(rate(1)), round3(rate(2))], ruleFiresPerMatch: per };
}

/** 규칙별 카드 문장 (수혜 측 관점) */
const FACTOR_TEXT: Record<RuleId, { us: string; them: string }> = {
  R1: { us: '우리 전방 압박이 상대 빌드업을 끊어냈다', them: '상대 압박에 우리 빌드업이 막혔다' },
  R2: { us: '롱볼·침투로 상대 압박과 높은 라인을 우회했다', them: '상대 롱볼 전진이 우리 높은 라인을 공략했다' },
  R3: { us: '낮은 블록이 상대 점유 축구를 질식시켰다', them: '상대 낮은 블록에 우리 점유 공격이 막혔다' },
  R4: { us: '넓은 폭으로 상대 좁은 수비를 흔들었다', them: '상대가 폭을 넓혀 우리 좁은 수비를 흔들었다' },
  R5: { us: '상대의 공격 과잉을 역습으로 처벌했다', them: '공격 성향이 높아 상대 역습에 노출됐다' },
  R6: { us: '오프사이드 트랩이 상대 침투를 잡아냈다', them: '상대 오프사이드 트랩에 침투가 자주 걸렸다' },
  R7: { us: '중원 수적 우위로 전진이 수월했다', them: '중원 수적 열세로 전진이 막혔다' },
  R9: { us: '집중 마크가 상대 핵심 선수를 묶었다', them: '상대 집중 마크에 우리 핵심 선수가 묶였다' },
  R10: { us: '공략 측면 선택이 적중했다', them: '공략 측면 선택이 빗나갔다' },
  R11: { us: '하프스페이스에 선수를 더 세워 상대 수비 사이를 파고들었다', them: '상대가 하프스페이스를 과부하해 수비 사이가 뚫렸다' },
  R12: { us: '윙어가 상대 윙백 뒤 공간에서 1:1 을 이겼다', them: '측면 수비수가 올라간 뒤 공간을 상대 윙어에게 내줬다' },
  R13: { us: '타깃맨 롱볼과 세컨드볼로 상대 압박을 건너뛰었다', them: '상대 타깃맨 롱볼과 세컨드볼 싸움에서 밀렸다' },
  TEMPO: { us: '템포 조절로 점유를 안정시켰다', them: '빠른 템포로 턴오버가 늘었다' },
  LINE_FIT: { us: '상대의 느린 수비 라인 뒷공간을 공략했다', them: '느린 수비수로 높은 라인을 유지하다 뒷공간을 내줬다' },
};

/** 8 다음 경기 제안: 우리에게 불리했던 규칙의 파훼법 */
const COUNTER_ADVICE: Record<RuleId, { text: string; patch?: Partial<TeamInstructions> }> = {
  R1: { text: '상대 압박에 빌드업이 막혔습니다. 패스 방식을 "길게"로 바꾸거나 볼플레잉 CB 를 검토하세요', patch: { directness: 2 } },
  R2: { text: '상대 롱볼이 높은 라인을 공략했습니다. 수비 라인을 내리거나 스위퍼 키퍼를 검토하세요', patch: { line: 0 } },
  R3: { text: '상대 낮은 블록에 막혔습니다. 폭을 넓히고 타깃맨을 활용해 보세요', patch: { width: 2 } },
  R4: { text: '측면을 자주 내줬습니다. 폭을 넓히거나 5백·수비형 풀백을 검토하세요', patch: { width: 1 } },
  R5: { text: '공격 성향이 높아 역습을 허용했습니다. 공격 성향을 0 으로 낮추거나 앵커 DM 을 두세요', patch: { mentality: 0 } },
  R6: { text: '오프사이드 트랩에 자주 걸렸습니다. 가짜 9번을 쓰거나 템포를 낮춰 보세요', patch: { tempo: -1 } },
  R7: { text: '중원 숫자에서 밀렸습니다. 중앙 MF 가 많은 포메이션(4-3-3, 4-4-2 다이아몬드)을 검토하세요' },
  R9: { text: '핵심 선수가 집중 마크에 묶였습니다. 그 선수의 역할을 바꾸거나 측면 공격을 늘려 보세요' },
  R10: { text: '공략 측면 선택이 불리했습니다. 상대 측면 수비가 약한 쪽을 다시 고르거나 지정을 해제하세요' },
  R11: { text: '하프스페이스를 자주 내줬습니다. 앵커·볼 위닝 MF 를 두거나 3백·5백을 검토하세요' },
  R12: { text: '측면 수비수가 올라간 뒤 공간을 내줬습니다. 수비형 풀백으로 바꾸거나 공격 성향을 낮추세요', patch: { mentality: -1 } },
  R13: { text: '상대 타깃맨 롱볼에 밀렸습니다. 공중전에 강한 스토퍼 CB 를 두거나 압박을 낮추세요', patch: { press: 0 } },
  TEMPO: { text: '빠른 템포에서 턴오버가 늘었습니다. 템포를 한 단계 낮춰 보세요', patch: { tempo: -1 } },
  LINE_FIT: { text: '느린 수비 라인이 높게 서 뒷공간을 내줬습니다. 라인을 한 단계 내리세요', patch: { line: 1 } },
};

function luckOf(delta: number, gf: number, ga: number, xgf: number, xga: number): LuckIndicator {
  if (delta <= -LUCK_THRESHOLD) {
    const text = xgf > xga && gf <= ga ? 'xG 우세에도 결과가 따르지 않은 경기 (결정력·운 부족)' : '기회 대비 득실이 불운했던 경기';
    return { level: 'UNLUCKY', delta: round2(delta), text };
  }
  if (delta >= LUCK_THRESHOLD) {
    const text = xgf < xga && gf >= ga ? 'xG 열세에도 결과를 가져간 경기 (결정력·운이 따름)' : '기회 대비 득실에서 운이 따른 경기';
    return { level: 'LUCKY', delta: round2(delta), text };
  }
  return { level: 'NEUTRAL', delta: round2(delta), text: '결과가 경기 내용(xG)과 대체로 일치했다' };
}

export function buildReport(
  result: MatchResult,
  explanation: MatchExplanation,
  perspective: ClubId,
  league: LeagueAverages,
  seasonSoFar: readonly MatchSummary[],
  names: Readonly<Record<string, string>> = {},
): MatchReport {
  const isHome = result.home.clubId === perspective;
  const us = isHome ? result.home : result.away;
  const them = isHome ? result.away : result.home;
  const ex = isHome ? explanation.home : explanation.away;
  const nm = (id: string) => names[id] ?? id;

  const summary = {
    goalsFor: us.goals,
    goalsAgainst: them.goals,
    xgFor: round2(us.xg),
    xgAgainst: round2(them.xg),
    possession: round3(us.possession),
    shotsFor: us.shots,
    shotsAgainst: them.shots,
    isHome,
    // 1.3.0: 엔진 1.2.0 통계 (구 엔진 결과에는 없음)
    ...(us.shotsOnTarget !== undefined && them.shotsOnTarget !== undefined ? { shotsOnTargetFor: us.shotsOnTarget, shotsOnTargetAgainst: them.shotsOnTarget } : {}),
    ...(us.corners !== undefined && them.corners !== undefined ? { cornersFor: us.corners, cornersAgainst: them.corners } : {}),
    ...(us.yellowCards !== undefined && them.yellowCards !== undefined ? { yellowCardsFor: us.yellowCards, yellowCardsAgainst: them.yellowCards } : {}),
    ...(us.possessionTime !== undefined ? { possessionTime: round3(us.possessionTime) } : {}),
  };

  // 블록 3: 승부 요인 Top 3
  const eventCount = (rule: RuleId, beneficiaryIsUs: boolean): number | null => {
    const ben = beneficiaryIsUs ? us : them;
    const vic = beneficiaryIsUs ? them : us;
    if (rule === 'R6') return vic.offsides;
    if (rule === 'R2') return ben.longBallAdvances;
    if (rule === 'R5') return ben.counters;
    return null;
  };
  const keyFactors: FactorCard[] = ex.rules
    .filter((r) => Math.abs(r.xg) >= 0.01)
    .slice(0, 3)
    .map((r) => {
      const mine = r.xg > 0;
      const ben = mine ? us : them;
      const fires = ben.ruleFires[r.ruleId] ?? (mine ? r.firesFor : r.firesAgainst);
      const ev = eventCount(r.ruleId, mine);
      const count = ev ?? fires;
      const avg = league.ruleFiresPerMatch[r.ruleId] ?? 0;
      const evLabel = r.ruleId === 'R6' ? '오프사이드' : r.ruleId === 'R2' ? '롱볼 전진' : r.ruleId === 'R5' ? '역습 전환' : '발동';
      const base = mine ? FACTOR_TEXT[r.ruleId].us : FACTOR_TEXT[r.ruleId].them;
      const text = `${base} (${RULE_DEFS[r.ruleId].label}): ${evLabel} ${count}회${ev === null ? ` (리그 평균 ${avg.toFixed(1)}회)` : ''}, 기여 xG ${signed(r.xg)}`;
      return { ruleId: r.ruleId, beneficiary: mine ? 'US' : 'THEM', count, leagueAvgCount: avg, xg: round3(r.xg), text };
    });

  // 블록 5: 구역 흐름
  const rate = (zp: { attempts: number; successes: number }) => (zp.attempts > 0 ? round3(zp.successes / zp.attempts) : 0);
  const zoneFlow: ZoneFlowRow[] = [
    { zone: 0, label: '빌드업 (Z0→Z1)', passRate: rate(us.zonePass.z0), leagueAvg: league.zonePass[0] },
    { zone: 1, label: '전진 (Z1→Z2)', passRate: rate(us.zonePass.z1), leagueAvg: league.zonePass[1] },
    { zone: 2, label: '찬스메이킹 (Z2→슈팅)', passRate: rate(us.zonePass.z2), leagueAvg: league.zonePass[2] },
  ];

  // 블록 6: 타임라인
  const timeline: TimelineItem[] = [];
  const push = (e: { minute: number; addedMinute?: number }, item: Omit<TimelineItem, 'minute' | 'addedMinute'>) =>
    timeline.push({ minute: e.minute, ...(e.addedMinute ? { addedMinute: e.addedMinute } : {}), ...item });
  for (const e of result.events) {
    switch (e.type) {
      case 'GOAL':
        push(e, { kind: 'GOAL', clubId: e.clubId, text: `골! ${nm(e.playerId)} (${chanceLabel(e.chance)}, xG ${e.xg.toFixed(2)})` });
        break;
      case 'TRIGGER_FIRED':
        push(e, { kind: 'TRIGGER', clubId: e.clubId, text: `조건부 지시 발동: ${e.description}` });
        break;
      case 'SUBSTITUTION':
        push(e, { kind: 'SUB', clubId: e.clubId, text: `교체: ${nm(e.out)} → ${nm(e.in)}${e.reason === 'INJURY' ? ' (부상)' : ' (컨디션)'}` });
        break;
      case 'CONDITION_DROP':
        push(e, { kind: 'CONDITION', clubId: e.clubId, text: `${nm(e.playerId)} 컨디션 ${e.condition} (효율 저하)` });
        break;
      case 'INJURY':
        push(e, { kind: 'INJURY', clubId: e.clubId, text: `${nm(e.playerId)} 부상 (${e.days}일)` });
        break;
      case 'RED_CARD':
        push(e, { kind: 'RED_CARD', clubId: e.clubId, text: `${nm(e.playerId)} 퇴장` });
        break;
      case 'YELLOW_CARD':
        push(e, { kind: 'YELLOW_CARD', clubId: e.clubId, text: `${nm(e.playerId)} 경고` });
        break;
      default:
        break;
    }
  }

  // 블록 8: 다음 경기 제안 (가장 큰 음의 기여 1~2개)
  const suggestions: Suggestion[] = ex.rules
    .filter((r) => r.xg <= -0.02)
    .sort((a, b) => a.xg - b.xg)
    .slice(0, 2)
    .map((r) => {
      const adv = COUNTER_ADVICE[r.ruleId];
      return { ruleId: r.ruleId, text: adv.text, ...(adv.patch ? { instructionPatch: adv.patch } : {}) };
    });

  // 시즌 기대 승점 vs 실제 승점
  let expected = 0;
  let actual = 0;
  for (const s of seasonSoFar) {
    const me = s.home.clubId === perspective ? s.home : s.away.clubId === perspective ? s.away : null;
    if (!me) continue;
    const op = me === s.home ? s.away : s.home;
    expected += me.xPts;
    actual += me.goals > op.goals ? 3 : me.goals === op.goals ? 1 : 0;
  }

  const ruleXg: Partial<Record<RuleId, number>> = {};
  for (const r of ex.rules) ruleXg[r.ruleId] = round3(r.xg);

  return {
    matchId: result.matchId,
    clubId: perspective,
    opponentId: them.clubId,
    summary,
    luck: luckOf(ex.bars.luck, us.goals, them.goals, us.xg, them.xg),
    keyFactors,
    factorBars: {
      strength: round3(ex.bars.strength),
      prep: round3(ex.bars.prep),
      tactics: round3(ex.bars.tactics),
      luck: round3(ex.bars.luck),
      ...(ex.bars.state !== undefined ? { state: round3(ex.bars.state) } : {}),
    },
    zoneFlow,
    timeline,
    suggestions,
    seasonPoints: { expected: round2(expected), actual },
    debug: { ruleXg, conservationError: ex.conservationError },
  };
}

export function chanceLabel(c: string): string {
  const m: Record<string, string> = {
    CROSS: '크로스 헤더',
    THROUGH: '스루패스 1대1',
    CUTBACK: '컷백',
    LONG: '중거리',
    SOLO: '개인 돌파',
    COUNTER: '역습',
    CORNER: '코너킥',
    FK: '직접 프리킥',
    PK: '페널티킥',
  };
  return m[c] ?? c;
}

function signed(x: number): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
