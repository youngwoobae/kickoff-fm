/**
 * 8.1 보정 목표 배치 검증 CLI (소유: A).
 *   npm run sim:batch -- --n 2000 --cap 0.35 --seed 42 [--scenario BASELINE,OVR_DIFF_10] [--json sim-out/report.json] [--strict]
 * --strict: 목표 하나라도 실패하면 exit 1 (CI 게이트용).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { runCalibration } from '../src/domain';
import type { ScenarioId, TacticCap } from '../src/types';

const { values } = parseArgs({
  options: {
    n: { type: 'string', default: '1000' },
    cap: { type: 'string', default: '0.35' },
    seed: { type: 'string', default: '20260926' },
    scenario: { type: 'string' },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
  },
});

const cap = Number(values.cap);
if (cap !== 0.25 && cap !== 0.35 && cap !== 0.5) {
  console.error(`--cap 은 0.25 / 0.35 / 0.5 중 하나여야 합니다 (입력: ${values.cap})`);
  process.exit(2);
}

const scenarios = values.scenario ? (values.scenario.split(',') as ScenarioId[]) : undefined;

const report = runCalibration(
  {
    matchesPerScenario: Number(values.n),
    tacCap: cap as TacticCap,
    seed: Number(values.seed),
    ...(scenarios ? { scenarios } : {}),
  },
  (p) => {
    if (p.done % 500 === 0 || p.done === p.total) process.stdout.write(`\r${p.scenario} ${p.done}/${p.total}   `);
  },
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
console.log(
  `engine ${report.engineVersion} | cap ${report.tacCap} | n=${report.matchesPerScenario}/scenario | ${report.durationMs}ms | ${report.allPass ? 'ALL PASS' : 'FAIL'}`,
);

if (values.json) {
  mkdirSync(dirname(values.json), { recursive: true });
  writeFileSync(values.json, JSON.stringify(report, null, 2));
}
if (values.strict && !report.allPass) process.exit(1);
