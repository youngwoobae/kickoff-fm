/**
 * 로컬 프로필 (2.5.0): 한 기기 핫시트 멤버 규칙. 순수 함수 — 영속화·권한 체크는 services. 소유: A.
 * 멤버 = Membership (memberId = userId). 구단주 1 + 코치 최대 5 (기획 5.0.1).
 */
import { hashString } from '../../engine';
import type { ClubMember, Membership, RoleLabel } from '../../types';
import { DomainError } from '../errors';

export const MAX_COACHES = 5;
export const MAX_NAME_LENGTH = 12;
export const ROLE_LABELS: readonly RoleLabel[] = ['TAC', 'SCT', 'SQD', 'ANL', 'FIN'];
export const ROLE_NAMES: Record<RoleLabel, string> = { TAC: '전술 코치', SCT: '스카우트', SQD: '선수단 코치', ANL: '분석관', FIN: '재정 코치' };
/** 코치 기본 이모지 (추가 순서대로 돌려 쓴다). 구단주 기본은 👑 */
export const MEMBER_EMOJIS = ['🟦', '🟩', '🟥', '🟪', '🟧', '🟫'] as const;
export const OWNER_EMOJI = '👑';

/** 표시 필드를 채운 멤버 (이전 세이브 호환: name·emoji 없으면 기본값) */
export function toClubMember(m: Membership, index = 0): ClubMember {
  const name = m.name ?? (m.seat === 'OWNER' ? '구단주' : m.roleLabel ? ROLE_NAMES[m.roleLabel] : '코치');
  const emoji = m.emoji ?? (m.seat === 'OWNER' ? OWNER_EMOJI : MEMBER_EMOJIS[index % MEMBER_EMOJIS.length]!);
  return { ...m, name, emoji };
}

export function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n.length < 1 || [...n].length > MAX_NAME_LENGTH) throw new DomainError('INVALID_MEMBER', `이름은 1~${MAX_NAME_LENGTH}자여야 해요`);
  return n;
}

export function cleanEmoji(emoji: unknown): string {
  const e = typeof emoji === 'string' ? emoji.trim() : '';
  if (e.length < 1 || e.length > 8) throw new DomainError('INVALID_MEMBER', '식별 이모지는 1글자여야 해요');
  return e;
}

export function checkRoles(role: unknown, subRole: unknown): void {
  if (!ROLE_LABELS.includes(role as RoleLabel)) throw new DomainError('INVALID_MEMBER', `알 수 없는 역할: ${String(role)}`);
  if (subRole !== undefined && (!ROLE_LABELS.includes(subRole as RoleLabel) || subRole === role)) throw new DomainError('INVALID_MEMBER', '보조 역할은 주 역할과 다른 역할 1개만 고를 수 있어요');
}

/** 새 멤버 id: 기존과 겹치지 않는 u-m{n} */
export function nextMemberId(members: readonly Membership[]): string {
  const ids = new Set(members.map((m) => m.userId));
  let n = members.length;
  while (ids.has(`u-m${n}`)) n++;
  return `u-m${n}`;
}

export const PIN_RE = /^\d{4}$/;

/**
 * 구단주 PIN 솔트 해시 (평문 저장 금지). 같은 PIN·솔트면 같은 값.
 * ponytail: 4자리 PIN 은 세이브 파일만 있으면 1만 번 대입으로 풀린다 — 기기 공유 시 "옆 사람 전환 방지"용이지 보안 경계가 아니다.
 * 서버 이관 시 서버 계정 인증으로 대체한다.
 */
export function hashPin(pin: string, salt: string): string {
  let a = hashString(`${salt}|${pin}|a`);
  let b = hashString(`${salt}|${pin}|b`);
  for (let i = 0; i < 2000; i++) {
    a = hashString(`${a}|${pin}|${salt}`);
    b = hashString(`${b}|${salt}|${pin}`);
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
