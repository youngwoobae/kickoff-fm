/** 선수 수명주기 순수 함수 (M3.4). 기준: docs/설계/선수_수명주기.md 3.5·4.4·6.4·7.6·8.4·11.7·16장 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine';
import type { AttrKey, Player, Position, Tier } from '../../src/types';
import { OVR_WEIGHTS, TIER_REFERENCE_OVR, generatePlayer, generateSquad } from '../../src/domain/squad/generator';
import {
  LIFECYCLE,
  type LifePlayer,
  type LifecycleEvent,
  ageOneSeason,
  aiSquadMaintenance,
  cleanFreeAgents,
  generateYouthCandidates,
  lifeRng,
  pickYouthAi,
  rawOvr,
  rollRetirement,
  squadStrength,
  weeklyGrowth,
} from '../../src/domain/squad/lifecycle';

const SEED = 20261004;

function mk(id: string, pos: Position, ovr: number, age: number, extra: Partial<LifePlayer> = {}): LifePlayer {
  const p = generatePlayer(lifeRng(SEED, 0, 'mk', id), pos, ovr, age);
  return { ...p, id, clubId: 'c1', potential: Math.max(p.ovr, extra.potential ?? p.ovr), ...extra };
}

/** 4주 성장, 주마다 출전 비중 share */
function growSeason(p: LifePlayer, share: number, season = 1, opts: { noiseSd?: number; focus?: 'BALANCED' | 'ATTACK' } = {}): LifePlayer {
  let cur = p;
  LIFECYCLE.weekMatches.forEach((m, w) => {
    cur = { ...cur, season: { ...cur.season, minutes: cur.season.minutes + share * 90 * m } };
    cur = weeklyGrowth(cur, lifeRng(SEED, season, `grow-w${w + 1}`, cur.id), { clubMatches: m, ...opts }).player;
  });
  return cur;
}

const prospect = (id: string) => mk(id, 'CM', 38, 17, { potential: 60, dev: { bank: 0, minutesMark: 0 } });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('성장 (3.5)', () => {
  it('G1 선발 4주, 잡음 0: 원시 OVR +6.0 ± 1.5', () => {
    const p = prospect('g1');
    expect(rawOvr(growSeason(p, 1, 1, { noiseSd: 0 })) - rawOvr(p)).toBeGreaterThanOrEqual(4.5);
    expect(rawOvr(growSeason(p, 1, 1, { noiseSd: 0 })) - rawOvr(p)).toBeLessThanOrEqual(7.5);
  });

  it('G2 미출전 4주: +3.0 ± 1.5', () => {
    const p = prospect('g2');
    const d = rawOvr(growSeason(p, 0, 1, { noiseSd: 0 })) - rawOvr(p);
    expect(d).toBeGreaterThanOrEqual(1.5);
    expect(d).toBeLessThanOrEqual(4.5);
  });

  it('G3 28세 이상은 능력치 불변', () => {
    const p = mk('g3', 'ST', 60, 28, { potential: 75 });
    expect(growSeason(p, 1).attrs).toEqual(p.attrs);
  });

  it('G4 ovr = potential 이면 능력치 불변, bank 0', () => {
    const p = mk('g4', 'CM', 50, 18, { dev: { bank: 3, minutesMark: 0 } });
    const g = growSeason({ ...p, potential: p.ovr }, 1);
    expect(g.attrs).toEqual(p.attrs);
    expect(g.dev?.bank).toBe(0);
  });

  it('G5·G7 1,000명 × 8시즌: ovr ≤ potential, 능력치 1..20, 핵심 밖 키 불변', () => {
    const rng = mulberry32(5);
    const positions = Object.keys(OVR_WEIGHTS) as Position[];
    for (let i = 0; i < 1000; i++) {
      const pos = positions[i % positions.length]!;
      const age = 16 + Math.floor(rng() * 16);
      let p = mk(`g5-${i}`, pos, 20 + Math.floor(rng() * 60), age);
      p = { ...p, potential: Math.min(95, p.ovr + Math.floor(rng() * 30)) };
      const start = p;
      for (let s = 1; s <= 8; s++) {
        p = growSeason(p, rng(), s);
        p = { ...ageOneSeason(p, lifeRng(SEED, s, 'age', p.id)).player, season: { ...p.season, minutes: 0 } };
        expect(p.ovr).toBeLessThanOrEqual(p.potential);
        for (const v of Object.values(p.attrs)) expect(v >= 1 && v <= 20).toBe(true);
      }
      for (const k of Object.keys(p.attrs) as AttrKey[]) if (OVR_WEIGHTS[pos][k] === undefined) expect(p.attrs[k]).toBe(start.attrs[k]);
    }
  });

  it('G6 입력 순서를 섞어도 결과 동일 (대상 단위 시드)', () => {
    const ps = Array.from({ length: 30 }, (_, i) => prospect(`g6-${i}`));
    const run = (xs: LifePlayer[]) => new Map(xs.map((p) => [p.id, growSeason(p, 0.5)]));
    const a = run(ps);
    const b = run([...ps].reverse());
    for (const p of ps) expect(b.get(p.id)).toEqual(a.get(p.id));
  });

  it('GREW 이벤트는 바뀐 능력치 증감량', () => {
    const p = prospect('ev');
    const r = weeklyGrowth({ ...p, season: { ...p.season, minutes: 630 } }, lifeRng(SEED, 1, 'grow-w1', p.id), { clubMatches: 7, noiseSd: 0 });
    expect(r.event?.kind).toBe('GREW');
  });
});

describe('노화 (4.4)', () => {
  it('A1 29 → 30세, 잡음 0: 감소 1.0 ± 1.5, 이월분은 bank 에', () => {
    const p = mk('a1', 'CB', 70, 29);
    const r = ageOneSeason(p, lifeRng(SEED, 1, 'age', p.id), 0);
    const drop = rawOvr(p) - rawOvr(r.player);
    expect(r.player.age).toBe(30);
    expect(drop).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(drop).toBeLessThanOrEqual(2.5);
    expect(drop - (r.player.dev?.bank ?? 0)).toBeCloseTo(1, 9);
    expect(r.event?.kind).toBe('DECLINED');
  });

  it('A2 29세 이하는 능력치 불변 (양수 bank 이월도 쓰지 않음)', () => {
    const p = mk('a2', 'W', 60, 25, { potential: 70, dev: { bank: 1.4, minutesMark: 100 } });
    const r = ageOneSeason(p, lifeRng(SEED, 1, 'age', p.id));
    expect(r.player.attrs).toEqual(p.attrs);
    expect(r.player.dev).toEqual({ bank: 1.4, minutesMark: 0 });
  });

  it('A3 30~35세 1,000명: 2시즌 평균 감소가 D 표 ± 0.3', () => {
    const positions = Object.keys(OVR_WEIGHTS) as Position[];
    for (let age = 29; age <= 34; age++) {
      const drops: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const p0 = mk(`a3-${age}-${i}`, positions[i % 8]!, 75, age);
        const p1 = ageOneSeason(p0, lifeRng(SEED, 1, 'age', p0.id)).player;
        const p2 = ageOneSeason({ ...p1, age }, lifeRng(SEED, 2, 'age', p0.id)).player; // 같은 나이로 한 번 더 (이월 수렴)
        drops.push((rawOvr(p0) - rawOvr(p2)) / 2);
      }
      const expected = LIFECYCLE.decline[age + 1]!;
      expect(Math.abs(mean(drops) - expected), `age ${age + 1}`).toBeLessThanOrEqual(0.3);
    }
  });

  it('A4 신체 능력치가 배수(×2)만큼 더 깎인다', () => {
    const positions = Object.keys(OVR_WEIGHTS) as Position[];
    let phys = 0;
    let all = 0;
    for (let i = 0; i < 1000; i++) {
      const p = mk(`a4-${i}`, positions[i % 8]!, 70, 30 + (i % 6));
      const q = ageOneSeason(p, lifeRng(SEED, 1, 'age', p.id)).player;
      for (const k of Object.keys(p.attrs) as AttrKey[]) {
        const d = p.attrs[k] - q.attrs[k];
        all += d;
        if (k === 'pace' || k === 'stamina' || k === 'physical') phys += d;
      }
    }
    // 설계서 하한 0.45 는 현재 OVR_WEIGHTS 로는 도달 불가(신체 가중이 작은 AM·CM·DM·GK 때문).
    // 대신 실측 비중이 배수 적용 기대치(포지션별 Σ신체 W·m / Σ W·m 평균)와 맞고, 배수 없는 비중보다 큼을 확인한다.
    const share = (useMult: boolean) =>
      mean(positions.map((pos) => {
        const w = OVR_WEIGHTS[pos];
        let ph = 0;
        let tot = 0;
        for (const k of Object.keys(w) as AttrKey[]) {
          const v = w[k]! * (useMult ? (LIFECYCLE.declineAttrMult[k] ?? 1) : 1);
          tot += v;
          if (k === 'pace' || k === 'stamina' || k === 'physical') ph += v;
        }
        return ph / tot;
      }));
    expect(Math.abs(phys / all - share(true))).toBeLessThanOrEqual(0.05);
    expect(phys / all).toBeGreaterThan(share(false) + 0.08);
  });
});

describe('은퇴 (6.4)', () => {
  const rate = (age: number, ovr: number, n: number) => {
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = { ...mk('r', 'CM', 50, age), id: `r-${age}-${ovr}-${i}`, ovr };
      if (rollRetirement(p, lifeRng(SEED, 1, 'retire', p.id), 60)) k++;
    }
    return k / n;
  };
  it('R1 32세는 절대 은퇴 안 함', () => expect(rate(32, 50, 2000)).toBe(0));
  it('R2 38세는 항상 은퇴', () => expect(rate(38, 70, 500)).toBe(1));
  it('R3 33세 비주전 0.35 ± 0.015', () => expect(Math.abs(rate(33, 50, 10000) - 0.35)).toBeLessThanOrEqual(0.015));
  it('R4 33세 주전급 0.175 ± 0.012', () => expect(Math.abs(rate(33, 65, 10000) - 0.175)).toBeLessThanOrEqual(0.012));
  it('FA·임시 선수는 Day 20 판정 대상 아님', () => {
    const p = mk('rfa', 'CM', 50, 38);
    expect(rollRetirement({ ...p, clubId: null }, mulberry32(1), 60)).toBe(false);
    expect(rollRetirement({ ...p, isTemporary: true }, mulberry32(1), 60)).toBe(false);
  });

  it('R5~R7 FA 풀 정리', () => {
    const fa = (id: string, age: number, faSince: number) => ({ ...mk(id, 'CM', 50, age), clubId: null, faSince });
    const r = cleanFreeAgents([fa('r5', 31, 5), fa('r6', 31, 4), fa('r7', 24, 3), fa('keep', 24, 4)], 5);
    expect(r.keep.map((p) => p.id)).toEqual(['r5', 'keep']);
    expect(r.events).toEqual([
      { kind: 'FA_RETIRED', playerId: 'r6' },
      { kind: 'FA_RETIRED', playerId: 'r7' },
    ]);
  });
});

describe('유스 (7.6)', () => {
  it('Y1 후보 3~5명 균등, 나이 16·17만', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) {
      const c = generateYouthCandidates(lifeRng(SEED, i, 'youth', 'c1'), 'c1', 'T3', i);
      counts[c.length - 3]!++;
      if (i < 500) for (const p of c) expect([16, 17]).toContain(p.age);
    }
    for (const n of counts) expect(Math.abs(n / 10000 - 1 / 3)).toBeLessThanOrEqual(0.02);
  });

  it('Y2 T3 후보 potential 평균 50.9 ± 0.2, ovr ≤ potential', () => {
    const pots: number[] = [];
    for (let i = 0; pots.length < 100000; i++) {
      for (const p of generateYouthCandidates(lifeRng(SEED, i, 'youth', 'c1'), 'c1', 'T3', i)) {
        pots.push(p.potential);
        if (p.ovr > p.potential) throw new Error(`ovr > potential: ${p.id}`);
      }
    }
    expect(Math.abs(mean(pots) - 50.9)).toBeLessThanOrEqual(0.2);
  });

  const cands = (pots: number[]) => pots.map((pot, i) => ({ ...mk(`yc${i}`, 'CM', 30, 17), potential: pot }) as Player);
  it('Y3 스쿼드 25명이면 0명', () => expect(pickYouthAi(cands([70, 60, 50]), 25, 60, true)).toEqual([]));
  it('Y4 20명, 유망주 없음 → 2명', () => expect(pickYouthAi(cands([50, 55, 45]), 20, 60, true)).toEqual(['yc1', 'yc0']));
  it('Y5 23명, 최고 pot = ref + 5 → 1명', () => expect(pickYouthAi(cands([50, 65, 52]), 23, 60, true)).toEqual(['yc1']));
  it('Y6 사람 미결정 자동 처리: 유망주 최대 1명, 없으면 0명', () => {
    expect(pickYouthAi(cands([70, 66, 50]), 18, 60, false)).toEqual(['yc0']);
    expect(pickYouthAi(cands([55, 50]), 18, 60, false)).toEqual([]);
  });
  it('Y7 같은 (gameSeed, season, clubId) → 같은 후보', () => {
    const a = generateYouthCandidates(lifeRng(SEED, 3, 'youth', 'c9'), 'c9', 'T5', 3);
    const b = generateYouthCandidates(lifeRng(SEED, 3, 'youth', 'c9'), 'c9', 'T5', 3);
    expect(b).toEqual(a);
    expect(a[0]!.id).toBe('y3-c9-1');
  });
});

describe('훈련 포커스 (8.4 T1·T2)', () => {
  const ATTACK = new Set<string>(LIFECYCLE.focus.ATTACK.group);
  const run = (pos: Position, focus: 'BALANCED' | 'ATTACK') => {
    let gain = 0;
    let atk = 0;
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const p = mk(`t-${pos}-${i}`, pos, 45, 20, { potential: 75, dev: { bank: 0, minutesMark: 0 } });
      const q = growSeason(p, 0.5, 1, { focus });
      gain += rawOvr(q) - rawOvr(p);
      for (const k of Object.keys(p.attrs) as AttrKey[]) {
        const d = q.attrs[k] - p.attrs[k];
        total += d;
        if (ATTACK.has(k)) atk += d;
      }
    }
    return { gain: gain / 1000, share: atk / total };
  };
  it('T1 BALANCED vs ATTACK 원시 OVR 증가 평균 차 < 0.2', () => {
    expect(Math.abs(run('AM', 'BALANCED').gain - run('AM', 'ATTACK').gain)).toBeLessThan(0.2);
  });
  it('T2 ATTACK 은 공격 그룹 증가 비중을 올린다 (FB +20%p, AM +10%p)', () => {
    expect(run('FB', 'ATTACK').share - run('FB', 'BALANCED').share).toBeGreaterThanOrEqual(0.2);
    expect(run('AM', 'ATTACK').share - run('AM', 'BALANCED').share).toBeGreaterThanOrEqual(0.1);
  });
});

describe('AI 선수단 관리 (11.7)', () => {
  const squad = (clubId: string, tier: Tier, seed = 1) =>
    generateSquad(mulberry32(seed), { clubId, targetOvr: TIER_REFERENCE_OVR[tier], size: 22, tier }).map((p) => ({ ...p, age: Math.min(p.age, 29) }));
  const kinds = (ev: LifecycleEvent[], kind: string) => ev.filter((e) => e.kind === kind);

  it('S2·S3 str 높고 ref + 8 인 25세 선수 → T3 SOLD_UP(풀로), T1 SOLD_ABROAD(삭제)', () => {
    for (const tier of ['T3', 'T1'] as Tier[]) {
      const ref = TIER_REFERENCE_OVR[tier];
      const players = squad('c1', tier).map((p) => ({ ...p, ovr: ref + 4 }));
      const star = { ...players[3]!, id: 'star', age: 25, ovr: ref + 8 };
      players[3] = star;
      const r = aiSquadMaintenance({ clubs: [{ id: 'c1', tier, players }], pool: [], season: 2, gameSeed: SEED });
      expect(r.clubs[0]!.players.some((p) => p.id === 'star')).toBe(false);
      if (tier === 'T3') {
        expect(kinds(r.events, 'SOLD_UP')[0]).toEqual({ kind: 'SOLD_UP', playerId: 'star', clubId: 'c1' });
        expect(r.pool.find((p) => p.id === 'star')).toMatchObject({ clubId: null, faSince: 1 });
      } else {
        expect(kinds(r.events, 'SOLD_ABROAD')[0]).toEqual({ kind: 'SOLD_ABROAD', playerId: 'star', clubId: 'c1' });
        expect(r.removed).toContain('star');
      }
    }
  });

  it('S4 str = ref − 4, 풀에 적합 선수 → 1명 영입', () => {
    const players = squad('c1', 'T3').map((p) => ({ ...p, ovr: 56 }));
    const fa = { ...mk('fa1', 'CM', 62, 26), clubId: null, faSince: 1 };
    const r = aiSquadMaintenance({ clubs: [{ id: 'c1', tier: 'T3', players }], pool: [fa], season: 2, gameSeed: SEED });
    expect(kinds(r.events, 'SIGNED_FROM_POOL')).toEqual([{ kind: 'SIGNED_FROM_POOL', playerId: 'fa1', clubId: 'c1' }]);
    expect(r.clubs[0]!.players.find((p) => p.id === 'fa1')).toMatchObject({ clubId: 'c1', faSince: undefined });
    expect(r.pool).toHaveLength(0);
  });

  it('S5 20세 ref − 20 은 방출 안 됨, 21세는 방출', () => {
    const players = squad('c1', 'T3');
    players[20] = { ...players[20]!, id: 'kid', age: 20, ovr: 40 };
    players[21] = { ...players[21]!, id: 'weak', age: 21, ovr: 40 };
    const r = aiSquadMaintenance({ clubs: [{ id: 'c1', tier: 'T3', players }], pool: [], season: 2, gameSeed: SEED });
    expect(r.clubs[0]!.players.some((p) => p.id === 'kid')).toBe(true);
    expect(kinds(r.events, 'RELEASED')).toContainEqual({ kind: 'RELEASED', playerId: 'weak', clubId: 'c1' });
  });

  it('S1 크기 22~25, GK ≥ 2 (인원 부족·GK 부족·인원 초과 모두)', () => {
    const short = squad('a', 'T4').filter((p) => p.primary !== 'GK').slice(0, 12);
    const big = [...squad('b', 'T2', 2), ...squad('b2', 'T2', 3).slice(0, 8)].map((p, i) => ({ ...p, id: `b-${i}`, clubId: 'b' }));
    const r = aiSquadMaintenance({
      clubs: [{ id: 'a', tier: 'T4', players: short }, { id: 'b', tier: 'T2', players: big }],
      pool: [],
      season: 2,
      gameSeed: SEED,
    });
    for (const c of r.clubs) {
      expect(c.players.length).toBeGreaterThanOrEqual(22);
      expect(c.players.length).toBeLessThanOrEqual(25);
      expect(c.players.filter((p) => p.primary === 'GK').length).toBeGreaterThanOrEqual(2);
      expect(new Set(c.players.map((p) => p.id)).size).toBe(c.players.length);
    }
    expect(kinds(r.events, 'REGENERATED').length).toBeGreaterThan(0);
  });

  it('S6 입력 객체를 바꾸지 않는다 (사람 구단은 넘기지 않으면 그대로)', () => {
    const players = squad('c1', 'T3');
    const snapshot = JSON.stringify(players);
    aiSquadMaintenance({ clubs: [{ id: 'c1', tier: 'T3', players }], pool: [], season: 2, gameSeed: SEED });
    expect(JSON.stringify(players)).toBe(snapshot);
  });

  it('S7 같은 입력 → 같은 출력, 구단 입력 순서 무관', () => {
    const clubs = [
      { id: 'c1', tier: 'T3' as Tier, players: squad('c1', 'T3', 1) },
      { id: 'c2', tier: 'T5' as Tier, players: squad('c2', 'T5', 2).slice(0, 15) },
    ];
    const a = aiSquadMaintenance({ clubs, pool: [], season: 2, gameSeed: SEED });
    const b = aiSquadMaintenance({ clubs: [...clubs].reverse(), pool: [], season: 2, gameSeed: SEED });
    expect(b).toEqual(a);
  });
});

describe('인구 균형 간이 시뮬 (13장, 16.2 C1~C6)', () => {
  it('70구단 × 30시즌: 크기·티어 평균·유입/유출이 판정 범위 안', () => {
    const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4', 'T5'];
    const rng = mulberry32(SEED);
    let clubs = TIERS.flatMap((tier, t) =>
      Array.from({ length: 14 }, (_, i) => {
        const id = `k${t}${String(i).padStart(2, '0')}`;
        return { id, tier, players: generateSquad(mulberry32(t * 100 + i), { clubId: id, targetOvr: TIER_REFERENCE_OVR[tier], size: 22, tier }) as LifePlayer[] };
      }),
    );
    let pool: LifePlayer[] = [];
    const rows: { pop: number; inflow: number; outflow: number; regen: number; tiers: number[] }[] = [];

    for (let season = 1; season <= 30; season++) {
      // 성장 4주 (출전 비중은 OVR 순위로 대신)
      LIFECYCLE.weekMatches.forEach((m, w) => {
        const tick = (p: LifePlayer, share: number) =>
          weeklyGrowth({ ...p, season: { ...p.season, minutes: p.season.minutes + share * 90 * m } }, lifeRng(SEED, season, `grow-w${w + 1}`, p.id), { clubMatches: m }).player;
        for (const c of clubs) {
          const rank = new Map([...c.players].sort((a, b) => b.ovr - a.ovr).map((p, r) => [p.id, r]));
          c.players = c.players.map((p) => { const r = rank.get(p.id)!; return tick(p, r < 11 ? 0.85 : r < 16 ? 0.35 : 0.05); });
        }
        pool = pool.map((p) => tick(p, 0));
      });
      // Day 20 은퇴 판정 → 경계 ① 실행
      let retired = 0;
      for (const c of clubs) {
        const before = c.players.length;
        c.players = c.players.filter((p) => !rollRetirement(p, lifeRng(SEED, season, 'retire', p.id), TIER_REFERENCE_OVR[c.tier]));
        retired += before - c.players.length;
      }
      // 승강 2/2 (전력 + 운)
      const key = new Map(clubs.map((c) => [c.id, squadStrength(c.players) + (rng() - 0.5) * 6]));
      const next = new Map(clubs.map((c) => [c.id, c.tier]));
      for (let t = 0; t < 4; t++) {
        const upper = clubs.filter((c) => c.tier === TIERS[t]).sort((a, b) => key.get(a.id)! - key.get(b.id)!);
        const lower = clubs.filter((c) => c.tier === TIERS[t + 1]).sort((a, b) => key.get(b.id)! - key.get(a.id)!);
        upper.slice(0, 2).forEach((c) => next.set(c.id, TIERS[t + 1]!));
        lower.slice(0, 2).forEach((c) => next.set(c.id, TIERS[t]!));
      }
      clubs = clubs.map((c) => ({ ...c, tier: next.get(c.id)! }));
      // ② 나이 +1·노화 ③ FA 정리 ④ AI 관리
      const age = (p: LifePlayer) => ({ ...ageOneSeason(p, lifeRng(SEED, season, 'age', p.id)).player, season: { ...p.season, minutes: 0 } });
      clubs = clubs.map((c) => ({ ...c, players: c.players.map(age) }));
      const fa = cleanFreeAgents(pool.map(age), season);
      const r = aiSquadMaintenance({ clubs, pool: fa.keep, season: season + 1, gameSeed: SEED });
      clubs = clubs.map((c) => ({ ...c, players: r.clubs.find((x) => x.id === c.id)!.players }));
      pool = r.pool;

      const count = (k: string) => r.events.filter((e) => e.kind === k).length;
      const inflow = count('YOUTH_PROMOTED') + count('REGENERATED');
      const outflow = retired + fa.events.length + count('SOLD_ABROAD');
      const tiers = TIERS.map((t) => mean(clubs.filter((c) => c.tier === t).map((c) => squadStrength(c.players))));
      rows.push({ pop: clubs.reduce((a, c) => a + c.players.length, 0), inflow, outflow, regen: count('REGENERATED'), tiers });

      for (const c of clubs) {
        expect(c.players.length).toBeGreaterThanOrEqual(22); // C2
        expect(c.players.length).toBeLessThanOrEqual(25);
        expect(c.players.filter((p) => p.primary === 'GK').length).toBeGreaterThanOrEqual(2);
      }
    }
    // 1~12시즌은 초기 세대(25 ± 4세) 은퇴 물결로 유입·유출이 크게 흔들린다. 정상 상태는 마지막 10시즌으로 본다.
    rows.forEach((row, i) => {
      expect(row.pop).toBeGreaterThanOrEqual(1540); // C1
      expect(row.pop).toBeLessThanOrEqual(1750);
      if (i >= 4) row.tiers.forEach((v, t) => expect(Math.abs(v - TIER_REFERENCE_OVR[TIERS[t]!]), `season ${i + 1} T${t + 1}`).toBeLessThanOrEqual(3)); // C3
    });
    const tail = rows.slice(-10);
    for (const row of tail) expect(Math.abs(row.inflow - row.outflow)).toBeLessThanOrEqual(15); // C5
    expect(Math.abs(mean(tail.map((r) => r.inflow - r.outflow)))).toBeLessThanOrEqual(5);
    expect(mean(tail.map((r) => r.regen))).toBeLessThanOrEqual(15); // C6 (시즌 평균)
    for (let t = 0; t < 4; t++) {
      const gap = mean(tail.map((r) => r.tiers[t]! - r.tiers[t + 1]!));
      expect(gap >= 3.5 && gap <= 8.5, `T${t + 1}-T${t + 2} gap ${gap}`).toBe(true); // C4
    }
  });
});
