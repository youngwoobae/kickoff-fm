/**
 * CAREER_SIM (로드맵 M3.6): 새 게임(T5) → 사람 구단 자동 운영(플랜 미설정 = 감독 AI) → N시즌 × 시드 M.
 * 판정표: 오프라인_경제 11장(M3.6 열) + 선수_수명주기 16.2. scripts/sim-career.ts 와 Vitest 축약 게이트가 공유한다. 소유: A.
 * "S10"은 마지막 시즌(seasons), "S2"는 2시즌. 시즌 시작 = Day 1(경계 처리 뒤), 시즌 말 = SEASON_OVER(Day 28 정산 뒤).
 */
import type { ClubMovement, GameState, Tier } from '../../types';
import { advanceDayState, clubPlayers, createInitialState } from '../day/advanceDay';
import { startNewSeasonState } from '../career/seasonTransition';
import { TIERS, leagueTable, leaguesOf } from '../league/pyramid';
import { TIER_ECONOMY, startingBalance } from '../economy/economy';
import { TIER_REFERENCE_OVR } from '../squad/generator';
import { LIFECYCLE, generateYouthCandidates, lifeRng, squadStrength } from '../squad/lifecycle';

export interface CareerSimOptions {
  seeds: number;
  seasons: number;
  seedBase?: number;
  startTier?: Tier;
  onProgress?: (seedIndex: number, season: number) => void;
}

export interface CareerGate {
  id: string;
  group: 'ECON' | 'LIFE' | 'KNOWN';
  kind: 'HARD' | 'WARN' | 'INFO';
  label: string;
  value: string;
  threshold: string;
  /** null = 측정 불가(이 단계에서 해당 없음·표본 없음) */
  pass: boolean | null;
}

interface SeasonEnd {
  money: Map<string, { balance: number; tob: number; tier: Tier }>;
  movements: ClubMovement[];
  t1Champion: string;
}

interface SeasonStart {
  xi: Record<Tier, number>;
  salary: Map<string, number>;
  ids: Set<string>;
  onClubs: number;
  aiSizes: number[];
  humanSize: number;
  allSizesOk: boolean;
  structureOk: boolean;
  fa: number;
  ages: number[];
  maxOvr: number;
  regen: number;
}

export interface SeedRun {
  seed: number;
  error?: string;
  starts: SeasonStart[];
  ends: SeasonEnd[];
  negClubDays: number;
  clubDays: number;
  negStreaks: number;
  /** 사람 구단 유스 후보 중 유망주(pot ≥ ref + 4) 가 있던 경계 수 / 경계 수 */
  youthProspect: [number, number];
}

export interface CareerSimReport {
  seeds: number;
  seasons: number;
  startTier: Tier;
  gates: CareerGate[];
  runs: SeedRun[];
  hardPass: number;
  hardTotal: number;
  warnings: number;
  allPass: boolean;
  ms: number;
}

const HUMAN = 'c01';
const MAX_ITER_PER_SEASON = 60;

function measureStart(s: GameState): SeasonStart {
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  const leagues = leaguesOf(s);
  for (const l of leagues) tiers[l.tier] = mean(l.clubIds.map((id) => squadStrength(clubPlayers(s, id))));
  const salary = new Map(Object.keys(s.clubs).map((id) => [id, clubPlayers(s, id).reduce((a, p) => a + p.contract.salary, 0)]));
  const sizes = Object.values(s.clubs).map((c) => ({ human: c.isHuman, n: clubPlayers(s, c.id).filter((p) => !p.isTemporary).length }));
  const ps = Object.values(s.players);
  const members = ps.filter((p) => p.clubId !== null && !p.isTemporary);
  return {
    xi: tiers,
    salary,
    ids: new Set(Object.keys(s.players)),
    onClubs: members.length,
    aiSizes: sizes.filter((x) => !x.human).map((x) => x.n),
    humanSize: sizes.find((x) => x.human)?.n ?? 0,
    allSizesOk: sizes.every((x) => x.n >= 18 && x.n <= 25),
    structureOk: Object.keys(s.clubs).length === 70 && leagues.length === 5 && leagues.every((l) => l.clubIds.length === 14),
    fa: ps.filter((p) => p.clubId === null).length,
    ages: members.map((p) => p.age),
    maxOvr: Math.max(...ps.map((p) => p.ovr)),
    regen: Object.keys(s.players).filter((id) => id.startsWith(`r${s.time.season}-`)).length,
  };
}

function measureEnd(s: GameState): SeasonEnd {
  const money = new Map<string, { balance: number; tob: number; tier: Tier }>();
  const t1 = leaguesOf(s).find((l) => l.tier === 'T1')!;
  for (const l of leaguesOf(s)) for (const id of l.clubIds) money.set(id, { balance: s.finances[id]!.balance, tob: s.finances[id]!.transferOnlyBudget, tier: l.tier });
  return { money, movements: s.pendingOutcome?.movements ?? [], t1Champion: leagueTable(s, t1)[0]!.clubId };
}

export function runCareerSeed(seed: number, seasons: number, startTier: Tier, onSeason?: (season: number) => void): SeedRun {
  const run: SeedRun = { seed, starts: [], ends: [], negClubDays: 0, clubDays: 0, negStreaks: 0, youthProspect: [0, 0] };
  const streak = new Map<string, number>();
  try {
    let s = createInitialState(seed, { clubName: 'AUTO', tier: startTier, devMode: false }, '2026-10-04T00:00:00.000Z');
    for (let season = 1; season <= seasons; season++) {
      if (season > 1) {
        s = startNewSeasonState(s, 'now');
        const tier = s.settings.tier;
        const cands = generateYouthCandidates(lifeRng(s.gameSeed, season, 'youth', HUMAN), HUMAN, tier, season);
        run.youthProspect[1]++;
        if (cands.some((p) => p.potential >= TIER_REFERENCE_OVR[tier] + LIFECYCLE.youth.prospectOver)) run.youthProspect[0]++;
      }
      run.starts.push(measureStart(s));
      onSeason?.(season);
      for (let i = 0; s.phase !== 'SEASON_OVER'; i++) {
        if (i >= MAX_ITER_PER_SEASON) throw new Error(`교착: 시즌 ${season} ${MAX_ITER_PER_SEASON}회 진행에도 끝나지 않음`);
        const before = `${s.time.season}/${s.time.day}/${s.phase}`;
        s = advanceDayState(s, 'now').state;
        if (`${s.time.season}/${s.time.day}/${s.phase}` === before) throw new Error(`교착: ${before} 에서 진전 없음`);
        for (const [id, f] of Object.entries(s.finances)) {
          run.clubDays++;
          const n = f.balance < 0 ? (streak.get(id) ?? 0) + 1 : 0;
          if (n > 0) run.negClubDays++;
          if (n === 4) run.negStreaks++; // 3일 넘게(4일째) 이어진 구간 1건
          streak.set(id, n);
        }
      }
      run.ends.push(measureEnd(s));
    }
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
  }
  return run;
}

// ── 통계

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}
/** 선형 보간 분위수 (R type 7) */
export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (h - lo);
}
export function gini(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  if (n === 0 || total <= 0) return 0;
  return s.reduce((a, x, i) => a + (2 * (i + 1) - n - 1) * x, 0) / (n * total);
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
const within = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? x >= lo && x <= hi : null);

// ── 판정

export function judgeCareer(runs: readonly SeedRun[], seasons: number): CareerGate[] {
  const ok = runs.filter((r) => !r.error && r.starts.length === seasons && r.ends.length === seasons);
  const last = seasons - 1;
  const gates: CareerGate[] = [];
  const g = (id: string, group: CareerGate['group'], kind: CareerGate['kind'], label: string, value: string, threshold: string, pass: boolean | null) =>
    gates.push({ id, group, kind, label, value, threshold, pass });
  const starts = ok.flatMap((r) => r.starts);
  const ends = ok.flatMap((r) => r.ends);
  const tierPairs = TIERS.slice(1).map((t, i) => [TIERS[i]!, t] as const);

  // ─ 오프라인_경제 11.1 하드 게이트 (M3.6 열)
  const errs = runs.filter((r) => r.error);
  g('C1', 'ECON', 'HARD', '예외·교착', `exceptions=${errs.length}${errs.length ? ` (${errs.map((r) => `seed ${r.seed}: ${r.error}`).join('; ')})` : ''}`, '0', errs.length === 0);
  const struct = runs.flatMap((r) => r.starts);
  g('C2', 'ECON', 'HARD', '구단 구성 70·티어별 14', `ok=${struct.filter((x) => x.structureOk).length}/${struct.length}`, '100%', struct.every((x) => x.structureOk));
  g('C3', 'ECON', 'HARD', '선수단 18~25명', `ok=${struct.filter((x) => x.allSizesOk).length}/${struct.length}`, '100%', struct.every((x) => x.allSizesOk));
  const streaks = runs.reduce((a, r) => a + r.negStreaks, 0);
  g('C4', 'ECON', 'HARD', '음수 잔액 3일 초과 지속', `cases=${streaks}`, '0', streaks === 0);
  const negRate = runs.reduce((a, r) => a + r.negClubDays, 0) / Math.max(1, runs.reduce((a, r) => a + r.clubDays, 0));
  g('C5', 'ECON', 'HARD', '음수 잔액 구단-일 비율', `neg_rate=${pct(negRate)}`, '<= 0.5%', negRate <= 0.005);

  const p1dev = starts.flatMap((x) => TIERS.map((t) => x.xi[t] - TIER_REFERENCE_OVR[t]));
  const p1lo = Math.min(...p1dev);
  const p1hi = Math.max(...p1dev);
  g('P1', 'ECON', 'HARD', '티어 평균 XI − REF (모든 시드·시즌·티어)', `min=${f2(p1lo)} max=${f2(p1hi)}`, '[-1.5, +2.5]', p1dev.length ? p1lo >= -1.5 && p1hi <= 2.5 : null);
  const p2 = ok.map((r) => Math.max(...TIERS.map((t) => Math.abs(r.starts[last]!.xi[t] - r.starts[0]!.xi[t]))));
  g('P2', 'ECON', 'HARD', `전력 드리프트 |XI(S${seasons}) − XI(S1)| 시드별 최대`, `p95=${f2(quantile(p2, 0.95))}`, '<= 2.0', within(quantile(p2, 0.95), 0, 2.0));
  const p3 = ok.map((r) => Math.max(...r.starts.slice(1).flatMap((x, i) => TIERS.map((t) => Math.abs(x.xi[t] - r.starts[i]!.xi[t])))));
  g('P3', 'ECON', 'HARD', '시즌 간 전력 변화 시드별 최대', `p95=${f2(quantile(p3, 0.95))}`, '<= 1.5', seasons > 1 ? within(quantile(p3, 0.95), 0, 1.5) : null);
  const p4 = ok.map((r) => Math.min(...tierPairs.map(([a, b]) => r.starts[last]!.xi[a] - r.starts[last]!.xi[b])));
  g('P4', 'ECON', 'HARD', `S${seasons} 인접 티어 XI 간격 최소`, `p5=${f2(quantile(p4, 0.05))}`, '>= 4.0', within(quantile(p4, 0.05), 4.0, Infinity));

  // E1 (측정만): 발생주의 순유입 = (Δ잔액 + 시즌 말 한정 예산 + 연봉) / 연봉. 이월금(전 시즌 말 잔액)은 제외
  const e1: Record<Tier, number[]> = { T1: [], T2: [], T3: [], T4: [], T5: [] };
  for (const r of ok) {
    r.ends.forEach((e, s) => {
      for (const [id, m] of e.money) {
        const prev = s === 0 ? startingBalance(TIER_ECONOMY[m.tier]) : r.ends[s - 1]!.money.get(id)!.balance;
        const sal = r.starts[s]!.salary.get(id)!;
        if (sal > 0) e1[m.tier].push((m.balance + m.tob - prev + sal) / sal);
      }
    });
  }
  g('E1', 'ECON', 'HARD', '순유입 비율 티어 중앙값 (M3.6 측정만)', TIERS.map((t) => `${t} ${f2(median(e1[t]))}`).join(' '), '— (M4.8 [0.95, 1.20])', null);
  const tierMed = (e: SeasonEnd, t: Tier, f: (m: { balance: number; tob: number }) => number) =>
    median([...e.money.values()].filter((m) => m.tier === t).map((m) => f(m) / TIER_ECONOMY[t].seasonBudget));
  const e2 = ok.map((r) => Math.max(...TIERS.map((t) => Math.abs(tierMed(r.ends[last]!, t, (m) => m.balance) - tierMed(r.ends[1]!, t, (m) => m.balance)))));
  g('E2', 'ECON', 'HARD', `잔액 안정 |S${seasons} − S2| (잔액/배정금 티어 중앙값)`, `p95=${f2(quantile(e2, 0.95))}`, '<= 0.20', seasons >= 2 ? within(quantile(e2, 0.95), 0, 0.2) : null);
  const e3 = ends.flatMap((e) => TIERS.map((t) => tierMed(e, t, (m) => m.balance + m.tob)));
  g('E3', 'ECON', 'HARD', '잔액 수준 (잔액+한정 예산)/배정금 티어 중앙값, 모든 시즌', `max=${f2(Math.max(...e3))}`, '<= 0.90', e3.length ? Math.max(...e3) <= 0.9 : null);

  // B1/B2: 시즌 s 말 승격(강등) → 시즌 s+1 말 강등(승격)
  let b1n = 0, b1k = 0, b2n = 0, b2k = 0;
  for (const r of ok) {
    for (let s = 0; s + 1 < seasons; s++) {
      const next = new Map(r.ends[s + 1]!.movements.map((m) => [m.clubId, m.kind]));
      for (const m of r.ends[s]!.movements) {
        if (m.kind === 'PROMOTED') (b1n++, next.get(m.clubId) === 'RELEGATED' && b1k++);
        else (b2n++, next.get(m.clubId) === 'PROMOTED' && b2k++);
      }
    }
  }
  g('B1', 'ECON', 'HARD', '승격 직후 강등률', `promoted_relegated=${pct(b1k / b1n)} n=${b1n}`, '<= 45%', b1n ? b1k / b1n <= 0.45 : null);
  g('B2', 'ECON', 'HARD', '강등팀 즉시 재승격률', `relegated_promoted=${pct(b2k / b2n)} n=${b2n}`, '<= 45%', b2n ? b2k / b2n <= 0.45 : null);
  const b3 = ok.filter((r) => {
    const c = new Map<string, number>();
    for (const e of r.ends) c.set(e.t1Champion, (c.get(e.t1Champion) ?? 0) + 1);
    return Math.max(...c.values()) >= 5;
  }).length;
  g('B3', 'ECON', 'HARD', 'T1 한 구단 5회 이상 우승 시드 비율', `${pct(b3 / ok.length)} (${b3}/${ok.length})`, '<= 10%', ok.length ? b3 / ok.length <= 0.1 : null);
  const u1 = ok.filter((r) => !r.ends.some((e) => e.movements.some((m) => m.clubId === HUMAN && m.kind === 'PROMOTED'))).length;
  g('U1', 'ECON', 'HARD', '사람 구단(AUTO) 무승격 시드 비율', `${pct(u1 / ok.length)} (${u1}/${ok.length})`, '<= 50%', ok.length ? u1 / ok.length <= 0.5 : null);

  // ─ 11.2 경고
  const e4 = TIERS.map((t) => median(ends.flatMap((e) => [...e.money.values()].filter((m) => m.tier === t).map((m) => m.tob / TIER_ECONOMY[t].seasonBudget))));
  g('E4', 'ECON', 'WARN', 'LP 전환/배정금 티어 중앙값', TIERS.map((t, i) => `${t} ${f2(e4[i]!)}`).join(' '), '<= 0.30 (M4.8)', e4.every((x) => x <= 0.3));
  g('E5', 'ECON', 'WARN', '낙찰가/V', '이적 없음', '[1.00, 1.20]', null);
  g('E6', 'ECON', 'WARN', '캡 산입액/ΣS(OVR)', '계약 없음', '>= 0.85', null);
  const fa = starts.filter((_, i) => i % seasons !== 0).map((x) => x.fa);
  g('E7', 'ECON', 'WARN', 'FA 풀 크기 (S2~, 시즌 시작)', `min=${Math.min(...fa)} max=${Math.max(...fa)}`, '[40, 250]', fa.length ? Math.min(...fa) >= 40 && Math.max(...fa) <= 250 : null);
  const e8 = ok.map((r) => Math.max(...TIERS.map((t) => gini([...r.ends[last]!.money.values()].filter((m) => m.tier === t).map((m) => m.balance + m.tob)))));
  g('E8', 'ECON', 'WARN', `S${seasons} 티어 내 잔액 지니 (티어 최대)`, `p95=${f2(quantile(e8, 0.95))}`, '<= 0.30', within(quantile(e8, 0.95), 0, 0.3));
  g('E9', 'ECON', 'WARN', '싱크 참여율', '이적 없음', '>= 40%', null);
  let e10n = 0, e10k = 0;
  for (const r of ok) for (let s = 1; s < seasons; s++) (e10n++, r.ends[s]!.t1Champion === r.ends[s - 1]!.t1Champion && e10k++);
  g('E10', 'ECON', 'WARN', 'T1 연속 우승률', `${pct(e10k / e10n)} n=${e10n}`, '<= 30%', e10n ? e10k / e10n <= 0.3 : null);
  g('U2', 'ECON', 'WARN', 'AGGR 에이전트 T1 도달', '에이전트 없음 (M4)', '보고만', null);

  // ─ 선수_수명주기 16.2
  const s5 = ok.flatMap((r) => r.starts.slice(4));
  g('L-C1', 'LIFE', 'HARD', '소속 선수 수 (임시 제외)', `min=${Math.min(...starts.map((x) => x.onClubs))} max=${Math.max(...starts.map((x) => x.onClubs))}`, '[1540, 1750]', starts.every((x) => x.onClubs >= 1540 && x.onClubs <= 1750));
  const ai = starts.flatMap((x) => x.aiSizes);
  g('L-C2', 'LIFE', 'HARD', 'AI 구단 인원', `min=${Math.min(...ai)} max=${Math.max(...ai)}`, '[22, 25]', ai.every((n) => n >= 22 && n <= 25));
  const lc3 = s5.flatMap((x) => TIERS.map((t) => Math.abs(x.xi[t] - TIER_REFERENCE_OVR[t])));
  g('L-C3', 'LIFE', 'HARD', '시즌 ≥ 5 티어 평균 str − ref 최대 |편차|', lc3.length ? f2(Math.max(...lc3)) : 'n/a', '<= 3', lc3.length ? Math.max(...lc3) <= 3 : null);
  const lc4 = s5.flatMap((x) => tierPairs.map(([a, b]) => x.xi[a] - x.xi[b]));
  g('L-C4', 'LIFE', 'HARD', '시즌 ≥ 5 인접 티어 str 차', lc4.length ? `min=${f2(Math.min(...lc4))} max=${f2(Math.max(...lc4))}` : 'n/a', '[3.5, 8.5]', lc4.length ? Math.min(...lc4) >= 3.5 && Math.max(...lc4) <= 8.5 : null);
  // 세계(소속 + FA) 선수 ID 집합의 경계 전후 차. 모델(13.2)처럼 시드별 경계 평균으로 판정 — 초반엔 빈 FA 풀이 차오르며 +가 크다
  const netBySeed: number[] = [];
  const netFirst: number[] = [];
  const flowIn: number[] = [];
  const flowOut: number[] = [];
  for (const r of ok) {
    const net: number[] = [];
    for (let s = 1; s < seasons; s++) {
      const a = r.starts[s - 1]!.ids;
      const b = r.starts[s]!.ids;
      const inn = [...b].filter((id) => !a.has(id)).length;
      const out = [...a].filter((id) => !b.has(id)).length;
      flowIn.push(inn), flowOut.push(out), net.push(inn - out);
    }
    netBySeed.push(mean(net)), netFirst.push(net[0]!);
  }
  g(
    'L-C5',
    'LIFE',
    'HARD',
    '시즌당 유입 − 유출 (시드별 경계 평균)',
    netBySeed.length ? `min=${f2(Math.min(...netBySeed))} max=${f2(Math.max(...netBySeed))} (첫 경계 평균 ${mean(netFirst).toFixed(1)}, 유입 평균 ${mean(flowIn).toFixed(1)}, 유출 평균 ${mean(flowOut).toFixed(1)})` : 'n/a',
    '±15',
    netBySeed.length ? netBySeed.every((x) => Math.abs(x) <= 15) : null,
  );
  // 재생성은 바닥 장치라 경계마다 출렁인다. lifecycle.test(13장 간이 시뮬)와 같이 시즌 평균으로 판정하고 단일 경계 최대는 참고로 출력
  const regenAll = ok.flatMap((r) => r.starts.slice(1).map((x) => x.regen));
  const regen = ok.map((r) => mean(r.starts.slice(1).map((x) => x.regen)));
  g('L-C6', 'LIFE', 'HARD', '시즌당 재생성 수 (시드별 평균)', regen.length ? `max=${f2(Math.max(...regen))} mean=${f2(mean(regen))} (단일 경계 최대 ${Math.max(...regenAll)})` : 'n/a', '<= 15', regen.length && seasons > 1 ? Math.max(...regen) <= 15 : null);
  const ageM = s5.map((x) => mean(x.ages));
  const young = s5.map((x) => x.ages.filter((a) => a <= 19).length / x.ages.length);
  const old = s5.map((x) => x.ages.filter((a) => a >= 33).length / x.ages.length);
  g(
    'L-C7',
    'LIFE',
    'HARD',
    '시즌 ≥ 5 평균 나이 / 16~19세 / 33세+',
    s5.length ? `${f2(Math.min(...ageM))}~${f2(Math.max(...ageM))} / max ${pct(Math.max(...young))} / ${pct(Math.min(...old))}~${pct(Math.max(...old))}` : 'n/a',
    '23.5~26.5 / <= 28% / 4~12%',
    s5.length ? Math.min(...ageM) >= 23.5 && Math.max(...ageM) <= 26.5 && Math.max(...young) <= 0.28 && Math.min(...old) >= 0.04 && Math.max(...old) <= 0.12 : null,
  );
  const faAll = starts.map((x) => x.fa);
  g('L-C8', 'LIFE', 'HARD', 'FA 풀 크기', `max=${Math.max(...faAll)}`, '<= 200', faAll.every((n) => n <= 200));
  g('L-C9', 'LIFE', 'INFO', `세계 최고 OVR (${seasons}시즌, 판정은 30시즌)`, `max=${Math.max(...starts.map((x) => x.maxOvr))}`, '[85, 95] @30시즌', null);
  g('L-C10', 'LIFE', 'INFO', '부상 / 경고 누적 정지', '엔진 측정 필요 (경량 리그 미집계)', '1.5~4.5 / 2~6', null);
  const [yk, yn] = ok.reduce(([a, b], r) => [a + r.youthProspect[0], b + r.youthProspect[1]], [0, 0]);
  g('L-C11', 'LIFE', 'HARD', '사람 구단 유스 유망주 제안 시즌 비율', `${pct(yk / yn)} n=${yn}`, '[15%, 40%]', yn ? within(yk / yn, 0.15, 0.4) : null);

  // ─ 알려진 문제: 사람 구단은 AI 보충(11장)이 없어 이적 없이 인원이 줄어든다 (M4 이적·M5 유스 UI 로 해소)
  const hs = starts.map((x) => x.humanSize);
  const below = starts.filter((x) => x.humanSize < 22).length;
  g('H1', 'KNOWN', 'WARN', '사람 구단 인원 22명 미만 (이적 없음)', `min=${Math.min(...hs)} 22명 미만 시즌 ${pct(below / starts.length)}`, '>= 22', below === 0);
  return gates;
}

export function runCareerSim(opts: CareerSimOptions, now: () => number = () => 0): CareerSimReport {
  const t0 = now();
  const startTier = opts.startTier ?? 'T5';
  const base = opts.seedBase ?? 1;
  const runs = Array.from({ length: opts.seeds }, (_, i) => runCareerSeed(base + i, opts.seasons, startTier, (season) => opts.onProgress?.(i, season)));
  const gates = judgeCareer(runs, opts.seasons);
  const hard = gates.filter((x) => x.kind === 'HARD' && x.pass !== null);
  const hardPass = hard.filter((x) => x.pass).length;
  return {
    seeds: opts.seeds,
    seasons: opts.seasons,
    startTier,
    gates,
    runs,
    hardPass,
    hardTotal: hard.length,
    warnings: gates.filter((x) => x.kind === 'WARN' && x.pass === false).length,
    allPass: hardPass === hard.length,
    ms: now() - t0,
  };
}
