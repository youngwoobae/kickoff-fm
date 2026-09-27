/**
 * 세이브 스키마 마이그레이션. 소유: A.
 * 1 → 2 (엔진 0.4.0, 2026-09-27):
 *  - Club.botStyle(레거시 5종) → Club.style(8종). 'WIDE' → 'WING_PLAY'. botStyle 필드는 지운다
 *  - 3·5백 포메이션 FB 슬롯의 FB_OVERLAPPING → WB_WINGBACK (3·5백 FB 허용 역할이 수비형·윙백으로 바뀜)
 * 구조를 모르는 값은 건드리지 않는다(검증은 서비스의 saveProblem 이 한다).
 */
import { FORMATIONS } from '../../engine';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function migrate1to2(x: Record<string, unknown>): Record<string, unknown> {
  const clubs = isObj(x.clubs) ? x.clubs : {};
  const nextClubs: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(clubs)) {
    if (!isObj(c)) {
      nextClubs[id] = c;
      continue;
    }
    const { botStyle, ...rest } = c;
    const club: Record<string, unknown> = { ...rest };
    if (typeof botStyle === 'string' && club.style === undefined) club.style = botStyle === 'WIDE' ? 'WING_PLAY' : botStyle;
    if (isObj(c.tactics)) {
      const tactics: Record<string, unknown> = {};
      for (const [k, sl] of Object.entries(c.tactics)) {
        const def = isObj(sl) ? FORMATIONS[sl.formation as keyof typeof FORMATIONS] : undefined;
        if (!isObj(sl) || !def || !Array.isArray(sl.roles) || def.backLine === 4) {
          tactics[k] = sl;
          continue;
        }
        const roles = (sl.roles as unknown[]).map((r, i) => (def.slots[i]?.position === 'FB' && r === 'FB_OVERLAPPING' ? 'WB_WINGBACK' : r));
        tactics[k] = { ...sl, roles };
      }
      club.tactics = tactics;
    }
    nextClubs[id] = club;
  }
  return { ...x, clubs: nextClubs, schemaVersion: 2 };
}

/** 알려진 이전 스키마를 현재 스키마로 올린다. 모르는 버전·객체가 아닌 값은 그대로 돌려준다 */
export function migrateSave(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  let x = raw;
  if (x.schemaVersion === 1) x = migrate1to2(x);
  return x;
}
