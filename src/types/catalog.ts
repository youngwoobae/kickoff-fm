/** UI 가 엔진 데이터 파일을 직접 import 하지 않도록 services 가 노출하는 정적 카탈로그 */
import type { AttrKey } from './player';
import type { FormationDef, PresetDef, RoleDef } from './tactics';
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
}

export interface Catalog {
  formations: FormationDef[];
  roles: RoleDef[];
  presets: PresetDef[];
  attributes: AttrDef[];
  rules: RuleDef[];
}
