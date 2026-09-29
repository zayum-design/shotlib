// Copyright 2026 zayum-design
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * data.ts — 角色数据聚合导出
 *
 * 仅做重新导出以保持向后兼容；新代码建议直接从 characterData 导入。
 * 场景相关数据（属性向导选项 / 预制提示词）已迁至后端
 * backend/src/assets/presets/drama/instant/scene-presets.json，
 * 通过 /api/creator/scene-preset 接口读取。
 */
export {
  CHARACTER_STEP_OPTIONS,
  PERSONALITY_BY_GENDER_AGE,
  APPEARANCE_BY_GENDER_AGE,
  OCCUPATION_BY_GENDER_AGE,
  PRESET_CHARACTER_NAMES,
} from './characterData';
