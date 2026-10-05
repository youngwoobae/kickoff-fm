/** S01 타이틀/슬롯 화면: 슬롯 3개 이어하기·새 게임·가져오기·내보내기·삭제 (소유: B, 계약 2.0.0) */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SAVE_SLOT_IDS, isGameError } from '../../services';
import type { GamePhase, SaveSlotId, SaveSlotMeta, Tier } from '../../types';
import { Badge, Card, Segmented } from '../components/kit';
import { useToast } from '../components/Toast';
import { TIER_NAME, downloadText } from '../format';
import { useAsyncAction, useService, useServiceCtx } from '../service/ServiceContext';
import { DEV_TOOLS } from '../service/serviceHost';
import { IosInstallHint } from '../pwa/UpdateBanner';
import { tourHint } from '../tutorial/Tour';
import { SettingsButton } from './SettingsSheet';

/**
 * 게임 안에서 열린 슬롯을 지우면 deleteSlot 이 게임을 먼저 닫아(통지) 타이틀이 삭제 전 목록을 읽는다.
 * 그런 작업을 여기 등록하면 타이틀은 끝난 뒤에 목록을 읽는다.
 */
let pendingSlotOp: Promise<unknown> = Promise.resolve();
export function trackSlotOp<T>(p: Promise<T>): Promise<T> {
  pendingSlotOp = p.catch(() => undefined);
  return p;
}

const MAX_IMPORT_BYTES = 32e6;

const PHASE_LABEL: Record<GamePhase, string> = { MATCHDAY: '시즌 중', OFFSEASON: '오프시즌', SEASON_OVER: '시즌 종료' };

function lastPlayed(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function TitleScreen() {
  const service = useService();
  const { mode, reportFatal } = useServiceCtx();
  const act = useAsyncAction();
  const toast = useToast();
  const [metas, setMetas] = useState<SaveSlotMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [corrupt, setCorrupt] = useState<Partial<Record<SaveSlotId, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [formSlot, setFormSlot] = useState<SaveSlotId | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importSlot = useRef<SaveSlotId | null>(null);

  const reload = useCallback(() => {
    setMetas(null);
    setLoadError(null);
    pendingSlotOp.then(() => service.listSlots?.() ?? []).then(setMetas, (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [service]);
  useEffect(reload, [reload]);

  /** 진행 표시와 함께 실행. 성공해 게임이 열리면 이 화면은 사라진다 */
  const withBusy = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const open = (id: SaveSlotId) =>
    withBusy('세이브를 불러오는 중…', async () => {
      try {
        await service.openSlot?.(id);
      } catch (e) {
        if (isGameError(e) && e.code === 'SAVE_INCOMPATIBLE') return setCorrupt((c) => ({ ...c, [id]: e.message }));
        if (isGameError(e) && e.code === 'NOT_FOUND') return reload();
        reportFatal(e);
      }
    });

  const remove = (id: SaveSlotId, name: string) => {
    if (!confirm(`슬롯 ${id} (${name}) 세이브를 삭제할까요? 되돌릴 수 없어요.`)) return;
    void withBusy('삭제하는 중…', async () => {
      await act((s) => s.deleteSlot?.(id), `슬롯 ${id} 세이브를 지웠어요`);
      setCorrupt((c) => ({ ...c, [id]: undefined }));
      reload();
    });
  };

  const exportSlot = (id: SaveSlotId) =>
    void act((s) => s.exportSlot?.(id)).then((json) => {
      if (json) downloadText(`kickoff-slot${id}-${new Date().toLocaleDateString('sv-SE')}.json`, json);
    });

  const pickImport = (id: SaveSlotId) => {
    importSlot.current = id;
    fileRef.current?.click();
  };

  const onImportFile = async (file: File | undefined) => {
    const id = importSlot.current;
    if (fileRef.current) fileRef.current.value = '';
    if (!file || id === null) return;
    // 10시즌 세이브 JSON ≈ 4MB. 엉뚱한 큰 파일을 통째로 읽어 탭이 멈추지 않게 (최종 리뷰 F-m)
    if (file.size > MAX_IMPORT_BYTES) return toast.show(`세이브 파일이 아니에요 (${Math.round(file.size / 1e6)}MB, 최대 ${MAX_IMPORT_BYTES / 1e6}MB)`, 'error');
    const filled = metas?.some((m) => m.slotId === id) || corrupt[id];
    if (filled && !confirm(`슬롯 ${id} 세이브를 가져온 파일로 덮어쓸까요?`)) return;
    const json = await file.text();
    await withBusy('세이브를 가져오는 중…', () => act((s) => s.importSave(json, id), '세이브를 불러왔어요'));
  };

  if (loadError) {
    return (
      <div className="fallback">
        <h1>세이브 목록을 읽지 못했어요</h1>
        <p>
          오류: <code>{loadError}</code>
        </p>
        <button type="button" className="btn btn-primary btn-block" onClick={reload}>
          다시 시도
        </button>
      </div>
    );
  }
  if (!metas) return <div className="boot">세이브 목록을 불러오는 중…</div>;

  return (
    <div className="app-shell">
      <main className="app-main onboarding">
        <div className="title-settings">
          <SettingsButton inGame={false} />
        </div>
        <h1 className="hero">킥오프 FM</h1>
        <p className="muted">
          매일 경기 플랜을 제출하고 하루씩 진행하는 축구 구단 운영 게임이에요. 진행은 매일 자동 저장돼요.
          {mode === 'fake' && ' (가짜 서비스 모드)'}
        </p>
        <IosInstallHint />
        {SAVE_SLOT_IDS.map((id) => {
          const meta = metas.find((m) => m.slotId === id);
          const bad = corrupt[id];
          return (
            <Card
              key={id}
              title={`슬롯 ${id}`}
              extra={bad ? <Badge tone="bad">⚠ 손상됨</Badge> : meta ? <Badge tone="accent">{PHASE_LABEL[meta.phase]}</Badge> : <Badge>빈 슬롯</Badge>}
            >
              {meta && (
                <div className="slot-meta">
                  <strong>{meta.clubName}</strong>
                  <span className="small muted">
                    {meta.tier} · 시즌 {meta.season} · Day {meta.day}
                  </span>
                  <span className="small muted">마지막 플레이 {lastPlayed(meta.savedAt)}</span>
                </div>
              )}
              {bad && (
                <p className="slot-warn" role="alert">
                  이 세이브를 열 수 없어요({bad}). 파일로 내보내 보관하거나 삭제한 뒤 새로 시작해 주세요.
                </p>
              )}
              {formSlot === id ? (
                <NewGameForm slotId={id} overwrite={!!meta || !!bad} onCancel={() => setFormSlot(null)} run={withBusy} />
              ) : (
                <>
                  {meta && !bad && (
                    <button type="button" className="btn btn-primary btn-block" disabled={!!busy} onClick={() => void open(id)}>
                      이어하기
                    </button>
                  )}
                  <div className="btn-row slot-actions">
                    <button type="button" className={meta ? 'btn btn-secondary' : 'btn btn-primary'} disabled={!!busy} onClick={() => setFormSlot(id)}>
                      새 게임
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => pickImport(id)}>
                      가져오기
                    </button>
                    {meta && (
                      <>
                        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => exportSlot(id)}>
                          내보내기
                        </button>
                        <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => remove(id, meta.clubName)}>
                          삭제
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </Card>
          );
        })}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onImportFile(e.target.files?.[0])} />
      </main>
      {busy && (
        <div className="busy-overlay" role="status" aria-live="polite">
          {busy}
        </div>
      )}
    </div>
  );
}

function NewGameForm({ slotId, overwrite, onCancel, run }: { slotId: SaveSlotId; overwrite: boolean; onCancel(): void; run(label: string, fn: () => Promise<unknown>): Promise<void> }) {
  const act = useAsyncAction();
  const [clubName, setClubName] = useState('성수 유나이티드');
  const [seed, setSeed] = useState('');
  const [startTier, setStartTier] = useState<Tier>('T5');

  const start = () => {
    if (overwrite && !confirm(`슬롯 ${slotId}의 기존 세이브를 지우고 새 게임을 시작할까요?`)) return;
    const n = Number(seed);
    tourHint.newGame = true;
    void run('새 게임을 만드는 중…', () =>
      act((s) => s.newGame({ clubName: clubName.trim() || undefined, seed: seed && Number.isFinite(n) ? n : undefined, devMode: DEV_TOOLS, slotId, startTier }), '창단했어요. 첫 시즌을 시작해요'),
    );
  };

  return (
    <div className="slot-form">
      {overwrite && <p className="slot-warn">⚠ 이 슬롯의 기존 세이브를 덮어써요.</p>}
      <label className="field">
        <span>구단 이름</span>
        <input value={clubName} maxLength={16} onChange={(e) => setClubName(e.target.value)} />
      </label>
      <div className="field">
        <span>시작 리그</span>
        <Segmented
          label="시작 리그"
          value={startTier}
          onChange={setStartTier}
          options={[
            { value: 'T5', label: `T5 ${TIER_NAME.T5} (기본)` },
            { value: 'T3', label: `T3 ${TIER_NAME.T3} (도전)` },
          ]}
        />
        <small className="muted">{startTier === 'T5' ? '가장 아래 리그에서 차근차근 올라가요.' : '중간 리그에서 시작해요. 첫 시즌부터 강등 위험이 있어요.'}</small>
      </div>
      {DEV_TOOLS && (
        <label className="field">
          <span>시드 (비우면 무작위)</span>
          <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} placeholder="예: 42" />
        </label>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn btn-primary" onClick={start}>
          창단하고 시작
        </button>
      </div>
    </div>
  );
}
