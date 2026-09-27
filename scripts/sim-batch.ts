/**
 * 8.1 보정 목표 배치 검증 CLI (소유: A).
 *   npm run sim:batch -- --n 2000 --cap 0.5 --seed 42 [--scenario BASELINE,OVR_DIFF_10] [--json sim-out/report.json] [--strict]
 *   npm run sim:batch -- --build-values [--n 20000]   (VALUE 테이블 생성 → engine/data/valueTable.ts 에 반영)
 * --strict: 목표 하나라도 실패하면 exit 1 (CI 게이트용).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { buildValueTable, PACKAGES, runCalibrationDetailed } from '../src/domain';
import type { ScenarioId, TacticCap } from '../src/types';

const { values } = parseArgs({
  options: {
    n: { type: 'string', default: '1000' },
    cap: { type: 'string', default: '0.5' },
    seed: { type: 'string', default: '20260926' },
    scenario: { type: 'string' },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
    'build-values': { type: 'boolean', default: false },
  },
});

const cap = Number(values.cap);
if (cap !== 0.25 && cap !== 0.35 && cap !== 0.5) {
  console.error(`--cap 은 0.25 / 0.35 / 0.5 중 하나여야 합니다 (입력: ${values.cap})`);
  process.exit(2);
}

if (values['build-values']) {
  const t = Date.now();
  const table = buildValueTable(Number(values.n), Number(values.seed), cap as TacticCap);
  console.log(JSON.stringify(table, null, 2));
  console.log(`VALUE 테이블 생성: ${values.n}경기, ${Date.now() - t}ms`);
  process.exit(0);
}

const scenarios = values.scenario ? (values.scenario.split(',') as ScenarioId[]) : undefined;
const started = Date.now();
const { report, details } = runCalibrationDetailed(
  {
    matchesPerScenario: Number(values.n),
    tacCap: cap as TacticCap,
    seed: Number(values.seed),
    ...(scenarios ? { scenarios } : {}),
  },
  (p) => {
    if (p.done % 500 === 0 || p.done === p.total) process.stdout.write(`\r${p.scenario} ${p.done}/${p.total}          `);
  },
  () => Date.now(),
);
process.stdout.write('\n');

console.table(
  report.targets.map((t) => ({
    scenario: t.scenario,
    target: t.label,
    range: `${t.min ?? '-'} ~ ${t.max ?? '-'} ${t.unit}`,
    actual: Number(t.actual.toFixed(3)),
    result: t.pass ? 'PASS' : 'FAIL',
  })),
);

const f1 = (x: number) => x.toFixed(1);
if (details.baseline) {
  const b = details.baseline;
  console.log(`\n[BASELINE] n=${b.n} 평균 득점 ${b.goals.toFixed(3)} | 팀당 슈팅 ${f1(b.shotsPerTeam)} | 승/무/패 ${f1(b.w)}/${f1(b.d)}/${f1(b.l)}%`);
}
if (details.counterMatrix) {
  const us = [...new Set(details.counterMatrix.map((c) => c.us))];
  const them = [...new Set(details.counterMatrix.map((c) => c.them))];
  console.log('\n[COUNTER_SPREAD] 동일 전력(OVR 60) 승률 % (행 = 우리 프리셋, 열 = 상대 프리셋, 중립 경기장)');
  const rows = us.map((u) => {
    const row: Record<string, string> = { 우리: PACKAGES[u].label };
    for (const t of them) {
      const c = details.counterMatrix!.find((x) => x.us === u && x.them === t)!;
      row[PACKAGES[t].label] = `${f1(c.winPct)} / ${f1(c.drawPct)} / ${f1(c.lossPct)}`;
    }
    return row;
  });
  console.table(rows);
  console.log(`  단순 최대−최소 평균 ${f1(details.counterRawSpread ?? 0)}%p / 교차검증 평균 ${f1(details.counterCvSpread ?? 0)}%p`);
  for (const [s, b] of Object.entries(details.counterBest ?? {})) {
    console.log(`  vs ${PACKAGES[s as keyof typeof PACKAGES].label}: 최선 ${PACKAGES[b.best].label}, 최악 ${PACKAGES[b.worst].label}, 교차검증 승률 차 ${f1(b.spread)}%p, 유리측 무승부 제외 ${f1(b.favNonDraw)}%`);
  }
}
if (details.ovr10) console.log(`\n[OVR_DIFF_10] 65 vs 55 강팀 승 ${f1(details.ovr10.strongWin)}% 무 ${f1(details.ovr10.draw)}% 약팀 승 ${f1(details.ovr10.weakWin)}%`);
if (details.ovr10Counter) {
  const c = details.ovr10Counter;
  console.log(`[OVR_DIFF_10_COUNTER] 약팀 ${PACKAGES[c.weakPackage].label}: 강팀 승 ${f1(c.strongWin)}% 무 ${f1(c.draw)}% 약팀 승 ${f1(c.weakWin)}%`);
  if (details.noTactics) console.log(`  (같은 대진, 전술 효과 끔 tacticsEnabled=false: 강팀 승 ${f1(details.noTactics.strongWin)}% 약팀 승 ${f1(details.noTactics.weakWin)}%)`);
}
if (details.ovr25) console.log(`[OVR_DIFF_25] 72.5 vs 47.5 강팀 승 ${f1(details.ovr25.strongWin)}% 무 ${f1(details.ovr25.draw)}% 약팀 승 ${f1(details.ovr25.weakWin)}%`);
if (details.tempo) console.log(`[TEMPO_VARIANCE] 약팀 승률 템포+2 ${f1(details.tempo.weakWinFast)}% / 템포−2 ${f1(details.tempo.weakWinSlow)}% (Δ ${f1(details.tempo.diff)}%p)`);
if (details.ruleIsolation) {
  console.log('\n[RULE_ISOLATION] 규칙 단독(onlyRules) 경기별 |규칙 xG| P95 / 평균');
  for (const r of details.ruleIsolation) console.log(`  ${r.rule.padEnd(8)} P95 ${r.p95.toFixed(3)}  평균 ${r.mean.toFixed(3)}  (n=${r.n})`);
  console.log(`  모든 규칙 합 P95 ${details.ruleTotalP95?.toFixed(3)}`);
}
console.log(
  `\nengine ${report.engineVersion} | cap ${report.tacCap} | n=${report.matchesPerScenario}/scenario | ${Date.now() - started}ms | ${report.allPass ? 'ALL PASS' : 'FAIL'}`,
);

if (values.json) {
  mkdirSync(dirname(values.json), { recursive: true });
  writeFileSync(values.json, JSON.stringify({ report, details }, null, 2));
}
if (values.strict && !report.allPass) process.exit(1);
