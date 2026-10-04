/** 표시 전용 포맷터·라벨 (소유: B). 게임 규칙 계산은 하지 않는다. */
import type {
  AttrKey,
  BotStyleTag,
  MatchupPreview,
  MatchupRuleHint,
  StyleDef,
  StyleFit,
  GameErrorCode,
  InboxKind,
  ListingKind,
  Membership,
  ConditionalOrder,
  FitLevel,
  FormationDef,
  Kc,
  LedgerKind,
  PromotionLabel,
  PromotionLedgerKind,
  Tier,
  TransferLedgerKind,
  WindowKind,
  PlanAdjustmentKind,
  PlanSource,
  Player,
  Position,
  ProposalStatus,
  Step,
  TeamInstructions,
} from '../types';

export function formatKc(v: Kc, signed = false): string {
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 100_000_000 ? 0 : 2)}M`;
  if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(0)}K`;
  return `${sign}${a}`;
}

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const signed = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

export const POS_LABEL: Record<Position, string> = {
  GK: 'GK', CB: 'CB', FB: 'FB', DM: 'DM', CM: 'CM', AM: 'AM', W: 'W', ST: 'ST',
};
export const POS_NAME: Record<Position, string> = {
  GK: '골키퍼', CB: '센터백', FB: '풀백', DM: '수비형 미드', CM: '중앙 미드', AM: '공격형 미드', W: '윙', ST: '스트라이커',
};
export const POS_ORDER: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];

export const FIT_SYMBOL: Record<FitLevel, string> = { NATURAL: '◎', ACCOMPLISHED: '○', CAPABLE: '△', UNSUITED: '✕' };
export const FIT_LABEL: Record<FitLevel, string> = { NATURAL: '주 포지션', ACCOMPLISHED: '숙련', CAPABLE: '가능', UNSUITED: '부적합' };

/** 선수의 포지션 적합도 (Player.positions 조회만. 누락 = UNSUITED 는 계약 주석) */
export function fitOf(p: Player, pos: Position): FitLevel {
  if (p.primary === pos) return 'NATURAL';
  return p.positions[pos] ?? 'UNSUITED';
}

export function isAvailable(p: Player): boolean {
  return p.availability.injuryDays <= 0 && p.availability.suspendedMatches <= 0;
}

export function conditionTone(c: number): 'good' | 'warn' | 'bad' {
  return c >= 80 ? 'good' : c >= 65 ? 'warn' : 'bad';
}

export const MORALE_LABEL: Record<Step, string> = { [-2]: '▼▼ 매우 나쁨', [-1]: '▼ 나쁨', 0: '– 보통', 1: '▲ 좋음', 2: '▲▲ 매우 좋음' } as Record<Step, string>;
export const MORALE_SHORT: Record<Step, string> = { [-2]: '▼▼', [-1]: '▼', 0: '–', 1: '▲', 2: '▲▲' } as Record<Step, string>;

export type SliderKey = 'mentality' | 'press' | 'line' | 'width' | 'tempo' | 'directness';
export const SLIDERS: { key: SliderKey; label: string; low: string; high: string }[] = [
  { key: 'mentality', label: '공격 성향', low: '매우 수비적', high: '매우 공격적' },
  { key: 'line', label: '수비 라인 높이', low: '매우 낮음', high: '매우 높음' },
  { key: 'press', label: '압박 강도', low: '기다림', high: '전방 압박' },
  { key: 'tempo', label: '공격 템포', low: '느림', high: '빠름' },
  { key: 'width', label: '경기 폭', low: '좁게', high: '넓게' },
  { key: 'directness', label: '패스 방식', low: '짧게', high: '길게' },
];
export const INSTR_LABEL: Record<keyof TeamInstructions, string> = {
  mentality: '공격 성향', press: '압박 강도', line: '수비 라인', width: '경기 폭', tempo: '템포', directness: '패스 방식',
  counter: '역습', offsideTrap: '오프사이드 트랩',
};
export function stepText(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}
export function instructionsSummary(i: TeamInstructions): string {
  const parts = SLIDERS.filter((s) => i[s.key] !== 0).map((s) => `${INSTR_LABEL[s.key]} ${stepText(i[s.key])}`);
  if (i.counter) parts.push('역습');
  if (i.offsideTrap) parts.push('트랩');
  return parts.length ? parts.join(' · ') : '모두 보통';
}

export const BOT_STYLE_LABEL: Record<BotStyleTag, string> = {
  POSSESSION: '점유형', COUNTER: '역습형', HIGH_PRESS: '전방압박형', LOW_BLOCK: '잠그기형', WIDE: '측면형',
};

export const PLAN_SOURCE_LABEL: Record<PlanSource, string> = {
  CONFIRMED: '확정 제출한 플랜',
  DEFAULT: '기본 플랜',
  LAST_USED: '직전 경기 플랜',
  SYSTEM: '감독 AI 기본 편성',
};
export const ADJ_LABEL: Record<PlanAdjustmentKind, string> = {
  OPP_ORDERS_CLEARED: '맞춤 지시 제거',
  UNAVAILABLE_REPLACED: '출전 불가 대체',
  AUTO_ROTATION: '자동 로테이션',
  VALIDITY_FIX: '유효성 보정',
  CONDITIONAL_DISABLED: '조건부 지시 비활성',
};

/** 2.2.0: TransferLedgerKind 는 M4.4 가 LedgerKind 에 합칠 때까지 별도 유니온 (라벨은 미리 둔다) */
export const LEDGER_LABEL: Record<LedgerKind | PromotionLedgerKind | TransferLedgerKind, string> = {
  SEASON_BUDGET: '시즌 배정금',
  SALARY: '연봉',
  MATCH_WIN: '승리 수당',
  MATCH_DRAW: '무승부 수당',
  MATCH_LOSS: '패배 수당',
  PRIZE: '순위 상금',
  CHAMPION_BONUS: '우승 수당',
  CARRY_EXCESS_SPLIT: '이월 초과분 분리',
  TRANSFER_BUDGET_EXPIRED: '한정 예산 소멸',
  PROMOTION_BONUS: '승격 보너스',
  PARACHUTE: '강등 완충금',
  TRANSFER_FEE_PAID: '이적료 지급',
  TRANSFER_FEE_RECEIVED: '이적료 수입',
  TRANSFER_TAX: '이적세',
  SIGNING_BONUS: '계약금',
  RENEWAL_BONUS: '재계약 보너스',
  RELEASE_PENALTY: '방출 위약금',
  FORCED_SALE: '강제 매각 수입',
};

/** 2.2.0 이적·편지함 표시 라벨 */
export const WINDOW_KIND_LABEL: Record<WindowKind, string> = { MID: '시즌 중간 이적 창', REGULAR: '정규 이적 창' };
export const LISTING_KIND_LABEL: Record<ListingKind, string> = { NPC: '신규', FA: 'FA', CLUB: '구단 명단' };
export const INBOX_ICON: Record<InboxKind, string> = {
  WINDOW_OPENED: '🔔', BID_WON: '✅', BID_LOST: '✕', PLAYER_SOLD: '💰', LISTING_UNSOLD: '–',
  RENEWAL_OPEN: '✍', CONTRACT_EXPIRED: '⌛', PLAYER_RELEASED: '↩', NEGATIVE_BALANCE: '⚠', FORCED_SALE: '⚠',
  RETIREMENT_NOTICE: '👋', YOUTH_INTAKE: '🌱', YOUTH_AUTO_DECIDED: '🌱', DISCIPLINE_WARNING: '🟨', SUSPENDED: '🟥', GENERAL: '✉',
};
/** 이적·계약 오류 코드 → 해요체 안내 (문구 가이드 3.5: 무엇이 + 이유 + 할 수 있는 행동) */
export const TRANSFER_ERROR_TEXT: Partial<Record<GameErrorCode, string>> = {
  WINDOW_CLOSED: '이적 창이 닫혀 있어요. 창이 열리면 받은 편지함으로 알려 드려요.',
  BID_OUT_OF_RANGE: '금액이나 기간이 허용 범위를 벗어났어요. 표시된 범위 안으로 고쳐 주세요.',
  INSUFFICIENT_FUNDS: '지출 가능액이 모자라요. 다른 입찰을 철회하거나 금액을 낮춰 보세요.',
  CAP_EXCEEDED: '연봉 캡을 넘게 돼요. 연봉을 낮추거나 선수를 정리한 뒤 다시 해 보세요.',
  SQUAD_FULL: '선수단이 25명으로 꽉 찼어요. 선수를 판매하거나 방출한 뒤 입찰해 주세요.',
  SIGNING_LIMIT: '이번 시즌 영입 한도(8명)에 닿았어요. 다음 시즌에 다시 해 보세요.',
  NEGATIVE_BALANCE_LOCK: '잔액이 마이너스라 입찰·재계약 인상이 막혀 있어요. 잔액을 먼저 회복해 주세요.',
  RENEWAL_NOT_OPEN: '재계약은 계약이 1시즌 남은 선수만 Day 20~27에 할 수 있어요.',
  PERMISSION_DENIED: '구단주만 할 수 있어요.',
  NOT_FOUND: '대상을 찾지 못했어요. 이미 정리된 매물이나 선수일 수 있어요.',
  INVALID_PHASE: '지금은 할 수 없어요. 시즌 진행 중에 다시 해 보세요.',
};

/** M 단위 입력값 ↔ KC (1,000 KC = 0.001M 단위) */
export const kcToM = (v: number) => Math.round(v / 1000) / 1000;
export const mToKc = (m: number) => Math.round((m * 1_000_000) / 1000) * 1000;

/** 2.1.0 피라미드 (기획서 6.1). 표시용 이름만, 규칙은 서비스(LeagueInfo)가 정한다 */
export const TIER_NAME: Record<Tier, string> = { T1: '프리미어 디비전', T2: '디비전 1', T3: '디비전 2', T4: '디비전 3', T5: '루키 리그' };
export const tierText = (t: Tier) => `${t} ${TIER_NAME[t]}`;
/** 색과 함께 쓰는 기호·문구 (색만으로 구분하지 않는다) */
export const LABEL_TEXT: Record<PromotionLabel, string> = { PROMOTED: '▲ 승격', RELEGATED: '▼ 강등', STAYED: '– 잔류' };
export const LABEL_TONE: Record<PromotionLabel, 'good' | 'bad' | 'neutral'> = { PROMOTED: 'good', RELEGATED: 'bad', STAYED: 'neutral' };

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  OPEN: '대기', APPROVED: '승인됨', REJECTED: '거절됨', EXPIRED: '만료', SUPERSEDED: '대체됨', STALE: '무효(재검증 실패)',
};

export function conditionalText(c: ConditionalOrder): string {
  const conds = c.conditions.map((k) => {
    if (k.kind === 'TIME') return k.after === 'HT' ? '하프타임에' : `${k.after}분 이후`;
    const st = k.state === 'LEAD' ? '이기고 있으면' : k.state === 'DRAW' ? '비기고 있으면' : '지고 있으면';
    return k.minDiff && k.state !== 'DRAW' ? `${k.minDiff}골 차 이상 ${st}` : st;
  });
  const a = c.action;
  const act =
    a.kind === 'SWITCH_SLOT'
      ? `전술 슬롯 ${a.slot}로 전환`
      : a.kind === 'MENTALITY_DELTA'
        ? `공격 성향 ${stepText(a.delta)}만큼`
        : `${a.target === 'tempo' ? '템포' : '압박'} ${stepText(a.delta)} (하프타임 조정)`;
  return `${conds.join(' 그리고 ')} → ${act}`;
}

/** 피치 표시용 행 배치: 포지션 → 세로 줄. 3백이면 FB 를 미드필드 줄로 올린다 */
export function pitchRows(f: FormationDef): number[][] {
  const rowOf = (pos: Position): number => {
    switch (pos) {
      case 'GK': return 0;
      case 'CB': return 1;
      case 'FB': return f.backLine === 3 ? 3 : 1;
      case 'DM': return 2;
      case 'CM': return 3;
      case 'AM': return 4;
      case 'W': return f.slots.some((s) => s.position === 'CM') && !f.slots.some((s) => s.position === 'DM') ? 3 : 4;
      case 'ST': return 5;
    }
  };
  const laneOrder = { L: 0, C: 1, R: 2 } as const;
  const rows: number[][] = [[], [], [], [], [], []];
  for (const s of f.slots) rows[rowOf(s.position)]?.push(s.index);
  for (const r of rows) {
    r.sort((a, b) => {
      const sa = f.slots[a];
      const sb = f.slots[b];
      if (!sa || !sb) return 0;
      const pa = sa.position === 'FB' || sa.position === 'W' ? (sa.lane === 'L' ? -1 : 3) : laneOrder[sa.lane];
      const pb = sb.position === 'FB' || sb.position === 'W' ? (sb.lane === 'L' ? -1 : 3) : laneOrder[sb.lane];
      return pa - pb || a - b;
    });
  }
  return rows.filter((r) => r.length > 0).reverse();
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 사용자 ID → 역할 이름 (멤버십 조회) */
export function seatLabel(memberships: readonly Membership[], userId: string): string {
  const m = memberships.find((x) => x.userId === userId);
  if (!m) return userId;
  return m.seat === 'OWNER' ? '구단주' : m.seat === 'COACH' ? '코치' : '관전 코치';
}

/** 경기 분 표기: 추가시간이면 "90+3′" */
export function minuteText(minute: number, addedMinute?: number): string {
  return addedMinute ? `${minute}+${addedMinute}′` : `${minute}′`;
}

/** 역할 적합 ★ (1~5): 역할 keyAttrs 평균(1~20)을 4점 단위로. 계약 16장 권장 계산 */
export function roleFit(p: Pick<Player, 'attrs'>, keyAttrs: readonly AttrKey[]): { avg: number; stars: number } {
  const vals = keyAttrs.map((k) => p.attrs[k] ?? 0);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return { avg, stars: Math.max(1, Math.min(5, Math.round(avg / 4))) };
}
export function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export const FIT_LEVEL_LABEL: Record<StyleFit['level'], string> = { GOOD: '잘 맞음', OK: '보통', POOR: '부족' };
export const FIT_LEVEL_TONE: Record<StyleFit['level'], 'good' | 'warn' | 'bad'> = { GOOD: 'good', OK: 'warn', POOR: 'bad' };
export const SIZE_LABEL: Record<MatchupRuleHint['size'], string> = { S: '작음', M: '중간', L: '큼' };
export const EDGE_LABEL: Record<MatchupPreview['styleEdge'], string> = { [-2]: '크게 불리', [-1]: '불리', 0: '팽팽', 1: '유리', 2: '크게 유리' } as Record<MatchupPreview['styleEdge'], string>;

/** 지시값이 가장 가까운 스타일 (L1 거리, 토글은 1점). 정확히 같으면 exact */
export function nearestStyle(styles: readonly StyleDef[], i: TeamInstructions): { style: StyleDef; exact: boolean } | undefined {
  let best: StyleDef | undefined;
  let bestD = Infinity;
  for (const s of styles) {
    const d =
      SLIDERS.reduce((a, k) => a + Math.abs(s.instructions[k.key] - i[k.key]), 0) +
      Number(s.instructions.counter !== i.counter) +
      Number(s.instructions.offsideTrap !== i.offsideTrap);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best && { style: best, exact: bestD === 0 };
}
