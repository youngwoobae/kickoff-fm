/** UI 가 엔진 데이터 파일을 직접 import 하지 않도록 services 가 노출하는 정적 카탈로그 */
import type { AttrKey } from './player';
import type { FormationDef, PresetDef, RoleDef, StyleDef } from './tactics';
import type { RuleId } from './engine';

export interface AttrDef {
  key: AttrKey;
  label: string;
  group: 'TECHNICAL' | 'MENTAL' | 'PHYSICAL' | 'GOALKEEPING';
}

export interface RuleDef {
  id: RuleId;
  label: string;
  counter: string;
  /** 1.2.0: 실제 축구 논리 한 줄 */
  why?: string;
}

export interface Catalog {
  formations: FormationDef[];
  roles: RoleDef[];
  presets: PresetDef[];
  attributes: AttrDef[];
  rules: RuleDef[];
  /** 1.2.0: 실제 전술 스타일 9종 (로컬 서비스는 항상 채운다. 선택 필드는 목 서비스 호환용) */
  styles?: StyleDef[];
}
