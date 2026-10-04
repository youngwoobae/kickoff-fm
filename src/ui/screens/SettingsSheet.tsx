/**
 * 설정 시트 (소유: B, M6.3 · 명세 docs/설계/온보딩_UX.md 2장). 상단 바·타이틀의 ⚙ 에서 연다.
 * 변경 즉시 prefs(`kickoff-fm/ui/prefs`)에 저장. 타이틀에서 열면 게임 관련 그룹(진행·데이터)은 숨긴다.
 */
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, Segmented, Sheet, Toggle } from '../components/kit';
import { useToast } from '../components/Toast';
import { downloadText } from '../format';
import { useNav } from '../app/nav';
import { prefsPersistable, resetPrefs, setPrefs, usePrefs, type FontScale, type MotionPref, type ReplaySpeed, type ThemePref } from '../prefs';
import { useAsyncAction, useService } from '../service/ServiceContext';
import { restartTour } from '../tutorial/Tour';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '–';

/** 계약에 아직 없는 선택 메서드 (2.3 백엔드 요청). 있으면 버전 줄에 덧붙인다 */
type BuildInfo = { engineVersion: string; contractVersion: string; saveSchema: number };

export function SettingsSheet({ open, onClose, inGame }: { open: boolean; onClose: () => void; inGame: boolean }) {
  const prefs = usePrefs();
  const service = useService();
  const act = useAsyncAction();
  const toast = useToast();
  const { go } = useNav();
  const build = (service as { getBuildInfo?: () => BuildInfo }).getBuildInfo?.();
  const slot = inGame ? (service.getActiveSlot?.() ?? null) : null;

  const replayTour = () => {
    restartTour();
    onClose();
    if (inGame) go({ tab: 'home' });
    else toast.show('게임을 열면 튜토리얼이 시작돼요');
  };

  return (
    <Sheet open={open} title="설정" onClose={onClose}>
      {!prefsPersistable && <p className="warn-line">이 브라우저에서는 설정이 저장되지 않아요. 앱을 닫으면 처음 값으로 돌아가요.</p>}

      <Card title="화면">
        <div className="field">
          <span>테마</span>
          <Segmented<ThemePref>
            label="테마"
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: 'system', label: '시스템' },
              { value: 'light', label: '라이트' },
              { value: 'dark', label: '다크' },
            ]}
          />
        </div>
        <div className="field">
          <span>글자 크기</span>
          <Segmented<`${FontScale}`>
            label="글자 크기"
            value={`${prefs.fontScale}`}
            onChange={(v) => setPrefs({ fontScale: Number(v) as FontScale })}
            options={[
              { value: '1', label: '기본' },
              { value: '1.125', label: '크게' },
              { value: '1.25', label: '아주 크게' },
            ]}
          />
          <small className="muted">아주 크게에서는 선발 화면이 목록 보기로 열려요.</small>
        </div>
        <div className="field">
          <span>모션 줄이기</span>
          <Segmented<MotionPref>
            label="모션 줄이기"
            value={prefs.motion}
            onChange={(motion) => setPrefs({ motion })}
            options={[
              { value: 'system', label: '기기 설정' },
              { value: 'reduce', label: '켬' },
              { value: 'full', label: '끔' },
            ]}
          />
          <small className="muted">켜면 화면 전환 효과가 꺼지고 중계가 바로 끝까지 표시돼요.</small>
        </div>
      </Card>

      <Card title="중계">
        <div className="field">
          <span>기본 재생 속도</span>
          <Segmented<ReplaySpeed>
            label="기본 재생 속도"
            value={prefs.replaySpeed}
            onChange={(replaySpeed) => setPrefs({ replaySpeed })}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
              { value: 'instant', label: '즉시' },
            ]}
          />
        </div>
      </Card>

      {inGame && (
        <Card title="진행">
          <Toggle
            label="여러 날 진행 전 확인"
            hint="여러 날을 한 번에 넘길 때 건너뛸 경기 수를 먼저 알려 줘요"
            checked={prefs.confirmMultiDay}
            onChange={(confirmMultiDay) => setPrefs({ confirmMultiDay })}
          />
          <Toggle
            label="플랜 미확정으로 넘길 때 확인"
            hint="끄면 확정하지 않은 날은 기본 플랜으로 경기해요(권장)"
            checked={prefs.confirmUnsubmitted}
            onChange={(confirmUnsubmitted) => setPrefs({ confirmUnsubmitted })}
          />
        </Card>
      )}

      <Card title="도움말">
        <button type="button" className="btn btn-secondary btn-block" onClick={replayTour}>
          튜토리얼 다시 보기
        </button>
      </Card>

      {inGame && (
        <Card title="데이터">
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={async () => {
              onClose();
              await act((s) => s.closeSlot?.());
            }}
          >
            저장하고 세이브 관리로
          </button>
          <small className="muted">타이틀 화면에서 슬롯 이어하기·내보내기·삭제를 할 수 있어요.</small>
          {slot !== null && service.exportSlot && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() =>
                  void act(async (s) => {
                    await s.flush?.();
                    return s.exportSlot?.(slot);
                  }).then((json) => json && downloadText(`kickoff-slot${slot}-${new Date().toLocaleDateString('sv-SE')}.json`, json))
                }
              >
                이 세이브 내보내기
              </button>
              <small className="muted">파일로 백업해 두면 기기를 바꿔도 이어서 할 수 있어요.</small>
            </>
          )}
        </Card>
      )}

      <Card title="정보">
        <p className="small">
          앱 {APP_VERSION}
          {build && ` · 엔진 ${build.engineVersion} · 계약 ${build.contractVersion} · 세이브 형식 ${build.saveSchema}`}
        </p>
        <p className="small muted">킥오프 FM은 인터넷 없이 동작하고, 모든 기록은 이 기기에만 저장돼요.</p>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={() => {
            resetPrefs();
            toast.show('기기 설정을 처음으로 돌렸어요');
          }}
        >
          기기 설정 초기화
        </button>
        <small className="muted">이 화면의 설정만 처음으로 돌려요. 세이브는 지워지지 않아요.</small>
      </Card>
    </Sheet>
  );
}

/** ⚙ 설정 (테마 토글은 설정 시트로 옮김) */
export function SettingsButton({ inGame }: { inGame: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="설정" title="설정" onClick={() => setOpen(true)}>
        ⚙
      </button>
      {/* 상단 바(sticky, z-index)의 쌓임 맥락을 벗어나도록 body 로 포털 */}
      {open && createPortal(<SettingsSheet open onClose={close} inGame={inGame} />, document.body)}
    </>
  );
}
