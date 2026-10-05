/**
 * M7.2 성능 실측 (Node, 결정적 시드). 결과 표는 docs/성능_측정.md.
 *   node --expose-gc --import tsx scripts/perf-bench.ts [--seed 1] [--seasons 10] [--json sim-out/perf.json]
 * 서비스 경로(createGameService + 메모리 슬롯)로 하루씩 진행하며 advanceDay(동기) 와 저장(flush = actionLog·본문 JSON.stringify) 을 따로 잰다.
 * 마지막 줄 HASH 는 시즌별 세이브 본문 sha256 — 성능 수정 전후 결과 불변 확인용.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { createGameService, createMemorySlotStorage } from '../src/services';
import { packBody } from '../src/services/idbStorage';
import { runCalibration } from '../src/domain';
import { makeTeam, play } from '../tests/helpers';
import type { GameState } from '../src/types';

const { values } = parseArgs({ options: { seed: { type: 'string', default: '1' }, seasons: { type: 'string', default: '10' }, json: { type: 'string' } } });
const seed = Number(values.seed);
const seasons = Number(values.seasons);
const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
const clock = { nowIso: () => '2026-10-04T00:00:00.000Z' };
const now = () => performance.now();
const MB = (b: number) => b / 1024 / 1024;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]! : NaN;
};
const stat = (xs: number[]) => ({ n: xs.length, p50: q(xs, 0.5), p95: q(xs, 0.95), max: Math.max(...xs) });
const timeIt = (fn: () => unknown, reps = 5) => {
  const t: number[] = [];
  for (let i = 0; i < reps; i++) {
    const a = now();
    fn();
    t.push(now() - a);
  }
  return q(t, 0.5);
};

// ── 1) 하루씩 진행 (UI 의 "다음 날" 버튼 경로) ──
const slots = createMemorySlotStorage();
type Svc = ReturnType<typeof createGameService> & { flush(): Promise<void> };
const svc = createGameService({ slots, clock }) as Svc;
gc();
const heap0 = process.memoryUsage().heapUsed;
let t = now();
svc.newGame({ seed, slotId: 1 });
const newGameMs = now() - t;
t = now();
await svc.flush();
const newGameSaveMs = now() - t;

type Day = { season: number; day: number; phase: string; match: boolean; window: boolean; ms: number; saveMs: number };
const days: Day[] = [];
const boundaries: { season: number; ms: number; saveMs: number }[] = [];
const saves: { season: number; bodyMB: number; logMB: number; gzipMB: number; gzipMs: number; stringifyMs: number; parseMs: number; heapMB: number }[] = [];
const heap: { season: number; heapMB: number }[] = [];
const hashes: string[] = [];

for (let season = 1; season <= seasons; season++) {
  for (let s = svc.getSnapshot()!; s.phase !== 'SEASON_OVER'; s = svc.getSnapshot()!) {
    const window = !!s.transferMarket;
    t = now();
    const r = svc.advanceDay();
    const ms = now() - t;
    t = now();
    await svc.flush();
    days.push({ season, day: r.from.day, phase: s.phase, match: !!r.userMatchId, window, ms, saveMs: now() - t });
  }
  const st = svc.getSnapshot() as GameState;
  const body = slots.data.get([...slots.data.keys()].find((k) => k.endsWith('/1'))!) ?? '';
  const log = slots.data.get([...slots.data.keys()].find((k) => k.endsWith('/1/log'))!) ?? '';
  hashes.push(createHash('sha256').update(body).digest('hex').slice(0, 16));
  gc();
  const heapMB = MB(process.memoryUsage().heapUsed);
  heap.push({ season, heapMB });
  if ([1, 3, 5, 10].includes(season) || season === seasons) {
    const { actionLog: _l, ...rest } = st;
    t = now();
    const packed = await packBody(body);
    const gzipMs = now() - t;
    saves.push({
      gzipMB: MB(packed.length),
      gzipMs,
      season,
      bodyMB: MB(Buffer.byteLength(body)),
      logMB: MB(Buffer.byteLength(log)),
      stringifyMs: timeIt(() => JSON.stringify(rest)),
      parseMs: timeIt(() => JSON.parse(body)),
      heapMB,
    });
  }
  if (season < seasons) {
    t = now();
    svc.startNewSeason();
    const ms = now() - t;
    t = now();
    await svc.flush();
    boundaries.push({ season: season + 1, ms, saveMs: now() - t });
  }
}

// ── 2) advanceToSeasonEnd (한 번에 시즌 끝까지) — 같은 시드 별도 인스턴스 ──
const svc2 = createGameService({ slots: createMemorySlotStorage(), clock }) as Svc;
svc2.newGame({ seed, slotId: 1 });
await svc2.flush();
const toEnd: { season: number; ms: number; saveMs: number }[] = [];
for (let season = 1; season <= seasons; season++) {
  t = now();
  svc2.advanceToSeasonEnd();
  const ms = now() - t;
  t = now();
  await svc2.flush();
  toEnd.push({ season, ms, saveMs: now() - t });
  if (season < seasons) svc2.startNewSeason();
}
const sameResult = JSON.stringify(svc2.getSnapshot()!.leagues) === JSON.stringify(svc.getSnapshot()!.leagues);

// ── 3) 엔진 1경기, 캘리브레이션 1,000경기 ──
const home = makeTeam(11, 'h', 70).input;
const away = makeTeam(12, 'a', 68, 'BALANCED', undefined, false).input;
for (let i = 0; i < 20; i++) play(i, home, away); // JIT 예열
const engine: number[] = [];
for (let i = 0; i < 300; i++) {
  t = now();
  play(1000 + i, home, away);
  engine.push(now() - t);
}
t = now();
runCalibration({ matchesPerScenario: 1000, tacCap: 0.35, seed: 20260926, scenarios: ['BASELINE'] });
const calibMs = now() - t;

// ── 출력 ──
const groups: [string, (d: Day) => boolean][] = [
  ['전체', () => true],
  ['경기일(D1~26)', (d) => d.phase === 'MATCHDAY'],
  ['경기일 + 이적창 열림', (d) => d.phase === 'MATCHDAY' && d.window],
  ['경기일 + 창 닫힘', (d) => d.phase === 'MATCHDAY' && !d.window],
  ['비경기일(D27·28)', (d) => d.phase !== 'MATCHDAY'],
  ['Day 27 (상금)', (d) => d.day === 27],
  ['Day 28 (정산·이월)', (d) => d.day === 28],
];
const f = (x: number) => x.toFixed(1);
console.log(`PERF seed=${seed} seasons=${seasons} node=${process.version}`);
console.log(`newGame ${f(newGameMs)}ms (+save ${f(newGameSaveMs)}ms)`);
console.log('구분 | n | advanceDay p50/p95/max | 저장 p50/p95/max');
for (const [name, pred] of groups) {
  const xs = days.filter(pred);
  const a = stat(xs.map((d) => d.ms));
  const b = stat(xs.map((d) => d.saveMs));
  console.log(`${name} | ${a.n} | ${f(a.p50)}/${f(a.p95)}/${f(a.max)} | ${f(b.p50)}/${f(b.p95)}/${f(b.max)}`);
}
for (let s = 1; s <= seasons; s++) {
  const a = stat(days.filter((d) => d.season === s).map((d) => d.ms));
  console.log(`시즌 ${s} 하루 p50/p95/max ${f(a.p50)}/${f(a.p95)}/${f(a.max)}`);
}
const top = [...days].sort((a, b) => b.ms - a.ms).slice(0, 8);
console.log('느린 날 Top8: ' + top.map((d) => `S${d.season}D${d.day}${d.window ? 'W' : ''}=${f(d.ms)}`).join(' '));
console.log('시즌 경계(startNewSeason): ' + boundaries.map((b) => `S${b.season}=${f(b.ms)}+${f(b.saveMs)}`).join(' '));
console.log('advanceToSeasonEnd: ' + toEnd.map((b) => `S${b.season}=${f(b.ms)}+${f(b.saveMs)}`).join(' '));
console.log('세이브: ' + saves.map((s) => `S${s.season} body ${s.bodyMB.toFixed(2)}MB log ${s.logMB.toFixed(2)}MB gzip ${s.gzipMB.toFixed(2)}MB/${f(s.gzipMs)}ms stringify ${f(s.stringifyMs)}ms parse ${f(s.parseMs)}ms`).join(' | '));
console.log(`heapUsed: start ${MB(heap0).toFixed(1)}MB → ` + heap.map((h) => `S${h.season} ${h.heapMB.toFixed(1)}`).join(' '));
const e = stat(engine);
console.log(`엔진 1경기 p50/p95/max ${f(e.p50)}/${f(e.p95)}/${f(e.max)}ms, 캘리브레이션 1,000경기 ${(calibMs / 1000).toFixed(2)}s`);
console.log(`하루씩 vs advanceToSeasonEnd 리그 결과 동일: ${sameResult}`);
console.log(`HASH ${hashes.join(' ')}`);

if (values.json) {
  mkdirSync(dirname(values.json), { recursive: true });
  writeFileSync(values.json, JSON.stringify({ seed, seasons, newGameMs, newGameSaveMs, days, boundaries, toEnd, saves, heap0: MB(heap0), heap, engine: e, calibMs, sameResult, hashes }, null, 2));
}
