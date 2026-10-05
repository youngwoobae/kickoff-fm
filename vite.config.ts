import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';

/**
 * 빌드 때만 dist/sw.js 를 만든다: 번들 산출물(해시 파일명) + public 파일을 프리캐시 목록으로 주입.
 * 캐시 이름은 목록·내용 해시라 산출물이 바뀌면 새 서비스 워커가 된다. 소스: src/ui/pwa/sw.js
 */
function serviceWorker(): Plugin {
  return {
    name: 'kickoff-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const pub = readdirSync('public');
      const files = [...new Set(['index.html', ...Object.keys(bundle), ...pub])].filter((f) => !f.endsWith('.map') && f !== 'sw.js').sort();
      const body = readFileSync('src/ui/pwa/sw.js', 'utf8');
      const h = createHash('sha256').update(body);
      for (const f of files) {
        const b = bundle[f];
        h.update(f).update(b ? (b.type === 'chunk' ? b.code : b.source) : pub.includes(f) ? readFileSync(`public/${f}`) : '');
      }
      const head = `const VERSION = ${JSON.stringify(`${version}-${h.digest('hex').slice(0, 10)}`)};\nconst PRECACHE = ${JSON.stringify(files)};\n`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: head + body });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // 자주 안 바뀌는 React 와 엔진·도메인·서비스를 UI 와 다른 청크로: 단일 청크 500 kB 경고 해소 + 화면만 바뀐 업데이트의 재다운로드 축소
        manualChunks(id) {
          const f = id.replace(/\\/g, '/');
          if (f.includes('/node_modules/react') || f.includes('/node_modules/scheduler/')) return 'vendor';
          if (/\/src\/(engine|domain|services|types)\//.test(f)) return 'game';
          return undefined;
        },
      },
    },
  },
});
