/**
 * CAREER_SIM 배치 (로드맵 M3.6, 오프라인_경제 11장 + 선수_수명주기 16.2).
 *   npm run sim:career -- [--seeds 20] [--seasons 10] [--seed-base 1] [--tier T5] [--json sim-out/career.json] [--strict]
 * --strict: 하드 게이트 하나라도 FAIL 이면 exit 1. 경고(WARN)는 출력만.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { runCareerSim } from '../src/domain';
import type { Tier } from '../src/types';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    seasons: { type: 'string', default: '10' },
    'seed-base': { type: 'string', default: '1' },
    tier: { type: 'string', default: 'T5' },
    json: { type: 'string' },
    strict: { type: 'boolean', default: false },
  },
});
const seeds = Number(values.seeds);
const seasons = Number(values.seasons);
if (!(seeds >= 1) || !(seasons >= 2) || !['T1', 'T2', 'T3', 'T4', 'T5'].includes(values.tier!)) {
  console.error('--seeds ≥ 1, --seasons ≥ 2, --tier T1~T5');
  process.exit(2);
}

const r = runCareerSim(
  {
    seeds,
    seasons,
    seedBase: Number(values['seed-base']),
    startTier: values.tier as Tier,
    onProgress: (i, s) => process.stdout.write(`\rseed ${i + 1}/${seeds} season ${s}/${seasons}   `),
  },
  () => Date.now(),
);
process.stdout.write('\n');

console.log(`CAREER_SIM seeds=${seeds} seasons=${seasons} start=${r.startTier} agent=AUTO`);
for (const g of r.gates) {
  const tag = g.pass === null ? (g.kind === 'INFO' ? 'INFO' : 'N/A ') : g.pass ? 'PASS' : g.kind === 'HARD' ? 'FAIL' : 'WARN';
  console.log(`[${g.id}] ${tag} ${g.label}: ${g.value} (${g.threshold})`);
}
console.log(`RESULT ${r.allPass ? 'PASS' : 'FAIL'} (hard ${r.hardPass}/${r.hardTotal}, warn ${r.warnings}) ${(r.ms / 1000).toFixed(1)}s`);

if (values.json) {
  mkdirSync(dirname(values.json), { recursive: true });
  const { runs, ...summary } = r;
  writeFileSync(values.json, JSON.stringify({ ...summary, runs: runs.map((x) => ({ seed: x.seed, error: x.error, xi: x.starts.map((s) => s.xi), humanSize: x.starts.map((s) => s.humanSize), fa: x.starts.map((s) => s.fa), movements: x.ends.map((e) => e.movements), t1Champion: x.ends.map((e) => e.t1Champion) })) }, null, 2));
  console.log(`JSON → ${values.json}`);
}
if (values.strict && !r.allPass) process.exit(1);
