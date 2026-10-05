/** 이름 뒤 조사 붙이기 (도메인 문구·UI 공용 — UI 는 services 경유. 온보딩_UX 3.4). josa('슬롯 2', '을/를') → '슬롯 2를' */
type Pair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로';

// 숫자·영문은 읽는 소리 기준: 받침 있음 = 0·1·3·6·7·8, L·M·N·R (L은 ㄹ)
const DIGIT_BATCHIM = '013678';
const RIEUL = '178LR'; // ㄹ받침: 일·칠·팔·엘·알 → '로'

function tail(word: string): { has: boolean; rieul: boolean } {
  const ch = word.trim().slice(-1).toUpperCase();
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) {
    const jong = code % 28;
    return { has: jong !== 0, rieul: jong === 8 };
  }
  if (/[0-9]/.test(ch)) return { has: DIGIT_BATCHIM.includes(ch), rieul: RIEUL.includes(ch) };
  if (/[A-Z]/.test(ch)) return { has: 'LMNR'.includes(ch), rieul: RIEUL.includes(ch) };
  return { has: false, rieul: false };
}

export function josa(word: string, pair: Pair): string {
  const { has, rieul } = tail(word);
  const [withB, withoutB] = pair.split('/') as [string, string];
  if (pair === '으로/로') return word + (has && !rieul ? '으로' : '로');
  return word + (has ? withB : withoutB);
}
