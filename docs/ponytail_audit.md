# Ponytail 감사 — 과잉 설계·복잡도 (HEAD 392cca6)

범위: `src/**`, `scripts/**`, `tests/**`, `vite.config.ts`, `vitest.config.ts`, `package.json`. 정확성·보안·성능은 다루지 않음.
큰 절감 순. 형식: `<태그> <잘라낼 것>. <대체>. [경로]` — (추정 절감 / 위험도)

## 항목

1. `delete:` 가짜 서비스 전체(2,700줄. 경기 시뮬·경제·승강·이적·재계약·유스·훈련·코치 제안·PIN 해시를 근사치로 다시 구현)와 그 배선(fakeData, serviceHost의 fake 분기, Fallbacks의 fake 안내, DevPanel의 FAKE 배지와 전환 버튼, App 헤더 배지, `VITE_FAKE_SERVICE`). 대체: UI만 볼 때도 실제 서비스를 메모리 저장소로 띄우는 `createGameService({ slots: createMemorySlotStorage(), clock: systemClock })` 한 줄(`?mem=1`). [src/ui/dev/fakeService.ts, src/ui/dev/fakeData.ts, src/ui/service/serviceHost.ts, src/ui/app/Fallbacks.tsx, src/ui/screens/DevPanel.tsx, src/ui/app/App.tsx, src/ui/env.d.ts] — (~-2,860줄 / 중간)
   - 의도: A(백엔드)와 B(UI)가 병렬로 개발할 때 백엔드가 없어서 만든 대역이다(아키텍처.md 552행). 제거 조건: 실제 서비스가 계약을 모두 구현한 지금 이미 충족됐다. fake는 이미 `getBuildInfo`·`remapLineup`이 없어 실제와 어긋나 있다. 남은 조건은 브라우저 검증·UI 작업 흐름이 `?fake=1`에 기대지 않는 것뿐이다.
2. `shrink:` api.ts 머리 주석의 계약 버전 변경 이력(2.0.0~2.5.0, 약 70줄). docs/아키텍처.md 16장과 git log에 이미 있으므로 `CONTRACT_VERSION` 옆에 "이력: 아키텍처 16장" 한 줄만 남긴다. [src/services/api.ts:77-145] — (~-65줄 / 낮음)
3. `delete:` domain 배럴의 re-export 276개 중 services·scripts·tests 어디에서도 쓰지 않는 107개(`makeMatchId`, `parseMatchId`, `clubLeagueMap`, `assignSalaries`, `fixtureFor`, `runCareerSeed`, `judgeCareer`, `ContractLedgerEntry`, `LEGACY_LEAGUE_TIER`, `placeAiBids`, `settleMarket` 등). engine 배럴의 9개(`sigmoid`, `ruleEnabled`, `ALLOWED_ROLES`, `WINGBACK_FB_ROLES`, `DEFAULT_ROLE`, `ROLE_UNIT_WEIGHTS`, `BOT_STYLE_IDS` 등)와 services 배럴의 6개(`createLocalStorageAdapter`, `localStorageKv`, `SLOT_KEY_PREFIX`, `LegacyStoragePort`, `GameServiceDeps`, `SubmitPlanOptions`)도 같다. 대체: 없음. 공개 표면은 실제로 쓰는 것만 둔다. [src/domain/index.ts, src/engine/index.ts, src/services/index.ts] — (~-75줄 / 낮음)
4. `delete:` 1.x 단일 세이브 경로(`loadGame`, `resetGame`, `LegacyStoragePort`, `createLocalStorageAdapter`, `createMemoryStorage`, `GameServiceDeps.storage`, `saveLegacy`, logEvent의 레거시 저장 분기). UI는 호출하지 않고 테스트 14개 파일만 쓴다. 대체: 테스트를 `createMemorySlotStorage()`와 `openSlot`으로 옮긴다. 1.x 세이브 이전용 `SAVE_KEY`와 `migrateLocalSaves`는 사용자 데이터라 남긴다. [src/services/api.ts:235-238, src/services/gameService.ts:212-216,488,508,527-547,790-809,1917-1925, src/services/ports.ts:48-90, tests/services/*.test.ts] — (~-90줄 / 중간)
   - 의도: 계약 호환용이다(api.ts에 "M2.3 뒤 제거"라고 예고돼 있다). 제거 조건: 계약 3.0.0(메이저)으로 올리는 것. 예고한 M2.3은 이미 지났다.
5. `delete:` 레거시 봇 태그 경로(`OpponentScout.botStyle`, `BotStyleTag`, `legacyBotTag`, `BOT_STYLE_LABEL`, `FOLD_TAG`, HomeScreen의 `scout.botStyle` 폴백). scout.ts:61의 `club.botStyle` 분기는 죽은 코드다. 세이브 스키마 2 migrate가 그 필드를 먼저 지우기 때문이다. 대체: `style`(BotStyle 8종)만 쓴다. migrate.ts는 원시 JSON에서 `botStyle`을 계속 읽으므로 그대로 둔다. [src/engine/data/presets.ts:227-240, src/domain/league/scout.ts:57-61,98, src/ui/format.ts:96-98, src/ui/dev/fakeData.ts:83-87, src/ui/screens/HomeScreen.tsx:115, src/types/tactics.ts:158-164, src/types/league.ts:65-68] — (~-35줄 / 중간, 계약 필드 제거)
6. `delete:` 튜닝 잔재와 죽은 함수: `formationParityMatch`(gitignore된 `sim-out/fpw.ts`만 참조), `assignSalaries`(@deprecated Phase 0, 참조 0), `hasRole`, `fixtureFor`, `clubLeagueMap`, `BOT_STYLE_IDS`(모두 정의만 있고 호출 0). `matrixPlay` 주석의 "sim-out 튜닝 스크립트" 언급도 지운다. 대체: 없음. [src/domain/calibration/runCalibration.ts:323,343-353, src/domain/squad/generator.ts:183-193, src/engine/rules.ts:56-58, src/domain/day/advanceDay.ts:125-127, src/domain/league/pyramid.ts:72-77, src/engine/data/presets.ts:225] — (~-37줄 / 낮음)
7. `shrink:` 테스트 13개 파일이 같은 `const clock = { nowIso: () => '…' }`와 `svc()` 팩토리를 따로 정의하고, `CONTRACT_VERSION === '2.5.0'` 검사가 4개 파일에 중복돼 있다(contract13의 테스트 제목은 아직 "2.0.0"이다). 대체: tests/helpers.ts에 `clock`·`svc(slots?)` 하나를 두고 버전 검사는 한 곳에만 남긴다. [tests/services/*.test.ts, tests/helpers.ts] — (~-35줄 / 낮음)
8. `yagni:` GameService의 선택 메서드 44개(`foo?()`). 구현은 실제 서비스 하나뿐인데(fake는 1번에서 제거), 그 대가로 UI에 `?.(`·`!(` 가드가 63개, 테스트 10개 파일에 `Required<Pick<GameService,…>>` 캐스트가 있다. UI의 기능 감지 분기(App.tsx:215 `!!service.getYouthIntake`, PlanEditor.tsx:55 `&& service.remapLineup`, SettingsSheet.tsx:24)도 같은 이유로 있다. 대체: 3.0.0에서 필수 메서드로 바꾼다. [src/services/api.ts, src/ui/**, tests/services/*.test.ts] — (~-25줄, 가드 63개 제거 / 낮음, 타입 검사가 잡아 줌)
   - 의도: 병렬 개발 중 "기존 UI·fake가 수정 없이 컴파일"되게 하려는 장치였다(아키텍처.md 690행). 제거 조건: 1번 또는 4번과 같은 메이저 버전 상승.
9. `delete:` deprecated 원장 별칭 `PromotionLedgerKind`, `TransferLedgerKind`, `ContractLedgerEntry`. 모두 2.1.1과 2.2.1에서 `LedgerKind`·`LedgerEntry`로 합쳐졌다. 대체: `LedgerKind`. `LEDGER_LABEL`도 `Record<LedgerKind, string>` 하나로 줄이고, 옛 주석("M4.4가 합칠 때까지")을 지운다. [src/types/economy.ts:42-57, src/domain/contract/contract.ts:28-29, src/domain/transfer/market.ts:16,48, src/ui/format.ts:21-23,114-115] — (~-22줄 / 낮음)
10. `delete:` `src/ui/josa.ts`. `src/domain/josa.ts`와 주석 한 줄만 다르고 내용이 같다. 대체: services/index.ts에서 `export { josa } from '../domain/josa'`(ui → services index → domain은 허용 방향). [src/ui/josa.ts, src/domain/josa.ts] — (~-24줄 / 낮음)
    - 의도: UI는 domain을 import하지 못하는 경계 때문에 생긴 사본이다. services 계약에 문구 유틸을 넣고 싶지 않으면 사본을 유지하고, 두 파일 사이에 "같이 고쳐라" 주석만 남긴다.
11. `shrink:` `DomainError`와 `GameError`는 필드·생성자·가드가 같은 클래스 두 개이고, 그 사이에 변환 함수가 있다. 대체: services에서 `export { DomainError as GameError, isDomainError as isGameError }`, 그리고 변환을 제거한다. [src/domain/errors.ts, src/services/errors.ts, src/services/gameService.ts:255] — (~-20줄 / 중간, `e.name` 값이 바뀜)
    - 의도: 레이어 경계(domain은 services를 모른다) 때문이다. UI가 `e.name`을 보지 않는다면 지금 바로 합쳐도 된다.
12. `delete:` `NewGameOptions.tier`(@deprecated 2.1.0, `startTier`가 우선). 테스트 1곳만 쓴다. 대체: `startTier`. [src/services/api.ts:164-168, src/services/gameService.ts:769, tests/services/pyramid21.test.ts] — (~-5줄 / 낮음, 계약 변경이므로 4번과 함께)
13. `shrink:` types23.ts의 타입 재수출 줄(`export type { TrainingFocus, YouthCandidate, YouthIntake } from '../types'`). 위임만 하는 래퍼다. 대체: 3개 파일이 `../types`에서 바로 import한다. 접근자(`trainingOf`·`yellowAccumOf`)는 구 세이브 기본값이라 남긴다. [src/ui/types23.ts:7] — (~-2줄 / 낮음)
14. `yagni:` (줄 절감 0) 자기 파일 안에서만 쓰는데 `export`된 심볼 약 100개(`managerAi`의 `slotScore`, `lifecycle`의 `growthK`, `advanceDay`의 `MATCH_DAYS`, `flow`의 `settleMarket` 등). 대체: `export` 키워드만 지워 공개 표면을 줄인다(3번과 함께). [src/domain/**, src/engine/**] — (0줄 / 낮음)

## 의도적으로 둔 것 (보고만, 자르지 않음)

- `src/ui/format.ts`의 `fitOf`, `isAvailable`, `canPropose`, `ROLE_NAME`: domain 규칙의 UI 사본이다(UI → domain import 금지). 제거 조건: 서비스가 이 값을 DTO에 실어 보내는 것.
- `domain/save/migrate.ts`, `prefs.ts`의 `OLD_THEME_KEY`, `SAVE_KEY`·`migrateLocalSaves`, `unpackBody`의 문자열 본문 허용: 사용자 세이브·설정 호환용이다. 지우면 데이터를 잃는다.
- `idbStorage.ts`의 CompressionStream 미지원 폴백과 localStorage 슬롯 폴백: 플랫폼 공백(구 사파리, IDB 불가)을 메운다.
- `slotGuard.ts`의 `SlotChannel` 인터페이스: BroadcastChannel을 테스트에서 끼워 넣는 지점이다(테스트 5곳).
- 캘리브레이션 하네스(runCalibration 1,488줄, careerSim, worker): 개발자 패널과 `sim:*` 스크립트가 쓰는 실제 기능이다.

## 이미 잘 된 것

- 런타임 의존성이 react·react-dom뿐이다. IndexedDB, CompressionStream, BroadcastChannel을 네이티브로 쓰고, workbox 없이 31줄짜리 sw.js와 작은 Vite 플러그인으로 PWA를 처리한다.
- global.css의 클래스 312개가 모두 참조된다(동적 `pos-${}`·`tone-${}` 포함).
- devDependencies 8개는 모두 쓰인다. `tsx`는 디렉터리 import(`../src/domain`) 때문에 Node 네이티브 타입 스트리핑으로 바꿀 수 없다.

net: -3,295 lines, -0 deps possible.
