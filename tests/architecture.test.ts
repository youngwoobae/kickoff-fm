/**
 * 모듈 경계 강제 테스트 (아키텍처 문서 3장).
 * 의존 방향: types ← engine ← domain ← services ← ui
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');
type Layer = 'types' | 'engine' | 'domain' | 'services' | 'ui' | 'root';

const ALLOWED: Record<Layer, Layer[]> = {
  types: ['types'],
  engine: ['types', 'engine'],
  domain: ['types', 'engine', 'domain'],
  services: ['types', 'engine', 'domain', 'services'],
  ui: ['types', 'services', 'ui'],
  root: ['ui', 'types', 'services'],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

function layerOf(file: string): Layer {
  const top = relative(SRC, file).split(sep)[0] ?? '';
  return (['types', 'engine', 'domain', 'services', 'ui'] as const).find((l) => l === top) ?? 'root';
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? '');
}

const files = walk(SRC);

describe('모듈 의존 방향', () => {
  it.each(files.map((f) => [relative(SRC, f), f]))('%s', (_rel, file) => {
    const from = layerOf(file);
    for (const spec of importsOf(file)) {
      if (!spec.startsWith('.')) {
        // 외부 패키지: engine/domain/types 는 금지, services 는 node 전용 모듈 금지
        if (from === 'engine' || from === 'domain' || from === 'types') {
          expect.soft(spec, `${from} 레이어는 외부 패키지를 import 할 수 없다`).toBe('(none)');
        }
        continue;
      }
      const target = layerOf(resolve(join(file, '..'), spec));
      expect.soft(ALLOWED[from], `${relative(SRC, file)} → ${spec}`).toContain(target);
    }
  });

  it('ui 는 services 의 index 만 import 한다', () => {
    for (const file of files.filter((f) => layerOf(f) === 'ui')) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) continue;
        const abs = resolve(join(file, '..'), spec);
        if (layerOf(abs) === 'services') {
          expect.soft(relative(SRC, abs).split(sep).join('/'), relative(SRC, file)).toMatch(/^services(\/index)?$/);
        }
      }
    }
  });

  it('types 레이어에는 런타임 코드가 없다', () => {
    for (const file of files.filter((f) => layerOf(f) === 'types')) {
      const src = readFileSync(file, 'utf8');
      expect.soft(src, relative(SRC, file)).not.toMatch(/^\s*export\s+(const|let|function|class|enum)\s/m);
    }
  });
});

describe('엔진 결정성', () => {
  it('engine/domain 은 Math.random, Date, performance 를 쓰지 않는다', () => {
    for (const file of files.filter((f) => ['engine', 'domain'].includes(layerOf(f)))) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect.soft(code, relative(SRC, file)).not.toMatch(/Math\.random|new Date\(|Date\.now|performance\.now/);
    }
  });
});
