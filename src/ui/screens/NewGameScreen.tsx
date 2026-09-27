/** S01 간이: 새 게임 / 세이브 가져오기 (소유: B) */
import { useState } from 'react';
import { Card } from '../components/kit';
import { useAction, useServiceCtx } from '../service/ServiceContext';

export function NewGameScreen() {
  const run = useAction();
  const { mode } = useServiceCtx();
  const [clubName, setClubName] = useState('성수 유나이티드');
  const [seed, setSeed] = useState('');
  const [json, setJson] = useState('');

  const start = () => {
    const n = Number(seed);
    run((s) => s.newGame({ clubName: clubName.trim() || undefined, seed: seed && Number.isFinite(n) ? n : undefined, devMode: true }), '새 시즌을 시작합니다!');
  };

  return (
    <div className="app-shell">
      <main className="app-main onboarding">
        <h1 className="hero">킥오프 FM</h1>
        <p className="muted">
          매일 경기 플랜을 제출하고, "다음 날로 넘기기"로 하루를 진행하는 축구 구단 운영 프로토타입입니다.
          {mode === 'fake' && ' (가짜 서비스 모드)'}
        </p>
        <Card title="새 게임">
          <label className="field">
            <span>구단 이름</span>
            <input value={clubName} maxLength={16} onChange={(e) => setClubName(e.target.value)} />
          </label>
          <label className="field">
            <span>시드 (비우면 무작위)</span>
            <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} placeholder="예: 42" />
          </label>
          <button type="button" className="btn btn-primary btn-block" onClick={start}>
            구단 창단하고 시작
          </button>
        </Card>
        <Card title="세이브 가져오기">
          <label className="field">
            <span>파일</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setJson(await f.text());
              }}
            />
          </label>
          <label className="field">
            <span>또는 JSON 붙여넣기</span>
            <textarea rows={3} value={json} onChange={(e) => setJson(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary btn-block" disabled={!json.trim()} onClick={() => run((s) => s.importSave(json), '세이브를 불러왔어요')}>
            가져오기
          </button>
        </Card>
      </main>
    </div>
  );
}
