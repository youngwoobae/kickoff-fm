/// <reference types="vite/client" />
/** 소유: B. UI 가 읽는 Vite 환경 변수 */
interface ImportMetaEnv {
  /** '1' 이면 가짜 서비스(src/ui/dev/fakeService.ts)로 실행 */
  readonly VITE_FAKE_SERVICE?: string;
}
