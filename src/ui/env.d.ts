/// <reference types="vite/client" />
/** 소유: B. UI 가 읽는 Vite 환경 변수 */
interface ImportMetaEnv {
  /** '1' 이면 가짜 서비스(src/ui/dev/fakeService.ts)로 실행 */
  readonly VITE_FAKE_SERVICE?: string;
  /** '1' 이면 프로덕션 빌드에도 개발 도구(개발자 패널·fake 전환)를 넣는다 */
  readonly VITE_DEV_TOOLS?: string;
}

/** 앱 버전 (vite.config.ts define, package.json version) */
declare const __APP_VERSION__: string;
