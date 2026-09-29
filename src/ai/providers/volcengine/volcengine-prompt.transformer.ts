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
 * 火山引擎提示词转换器
 *
 * 将统一占位符(如 [ref:face:1])一次性转换为火山格式([图1]),
 * 并为视频提示词追加质量后缀。
 */
export class VolcenginePromptTransformer {
  /** 视频提示词后缀 */
  private readonly VIDEO_SUFFIX =
    '禁止出现任何字幕或文字;禁止面部特征雷同,两人必须是独一无二的个体且严格遵守参考图长相;禁止动作僵硬,确保真人电影级写实质感。';

  /** 统一占位符替换规则(所有火山引擎模型) */
  private readonly VIDEO_REPLACEMENTS: Array<{ from: string; to: string }> = [
    { from: '[ref:face:{i}]', to: '[图{i}]' },
    { from: '[ref:costume:{i}]', to: '[图{i}]' },
    { from: '[ref:audio:{i}]', to: '[音频{i}]' },
    { from: '[ref:scene:{i}]', to: '[图{i}]' },
    { from: '[ref:shot:{i}]', to: '[图{i}]' },
  ];

  transform(prompt: string, context?: { taskType?: string }): string {
    let result = prompt;

    if (context?.taskType === 'video') {
      // 应用替换规则
      result = this.applyReplacements(result, this.VIDEO_REPLACEMENTS);
      // 添加后缀
      result = result + this.VIDEO_SUFFIX;
    }

    return result;
  }

  /** 应用替换规则(支持 {i} 数字占位符) */
  private applyReplacements(
    prompt: string,
    replacements: Array<{ from: string; to: string }>,
  ): string {
    // 按 from 长度降序排序,优先匹配更长的规则(避免短规则误匹配)
    const sorted = [...replacements].sort(
      (a, b) => (b.from?.length || 0) - (a.from?.length || 0),
    );

    let result = prompt;
    for (const r of sorted) {
      if (!r.from || r.to === undefined) continue;

      if (r.from.includes('{i}')) {
        const prefix = r.from.split('{i}')[0];
        const suffix = r.from.split('{i}')[1] || '';
        const toPrefix = r.to.split('{i}')[0];
        const toSuffix = r.to.split('{i}')[1] || '';
        const regex = new RegExp(
          this.escapeRegex(prefix) + '(\\d+)' + this.escapeRegex(suffix),
          'g',
        );
        result = result.replace(regex, `${toPrefix}$1${toSuffix}`);
      } else {
        result = result.split(r.from).join(r.to);
      }
    }
    return result;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
