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
 * 阿里云提示词转换器
 *
 * 将所有统一占位符(如 [ref:face:1]、[图1])一次性转换为目标厂商格式,
 * 避免前端生成中文描述、转换层再次替换的多次转接问题
 */
export interface AliyunPromptTransformContext {
  taskType?: string;
  modelId?: string;
  supports?: Record<string, any>;
}

export class AliyunPromptTransformer {
  /**
   * 视频提示词后缀(通用)
   */
  private readonly VIDEO_SUFFIX =
    '禁止出现简体字或繁体字字幕；禁止现代词汇或网络用语；禁止日式或韩式表演风格；禁止环境与沦陷时期日军驻地身份不符的陈设或建筑；禁止人物年龄感与设定不符；禁止光色过于鲜亮饱和，整体调性应为暗红与深褐交织的压抑质感；禁止任何面部特征雷同或重复的面孔，每个角色必须是独一无二的个体。';

  /**
   * 统一占位符替换规则(图像任务)
   * 将前端生成的 [ref:face:N]、[ref:costume:N] 等占位符转换为厂商特定描述
   */
  private readonly REF_REPLACEMENTS: Array<{
    from: string;
    to: string;
  }> = [
    { from: '[ref:face:{i}]', to: 'Face reference image {i}' },
    { from: '[ref:costume:{i}]', to: 'Outfit reference image {i}' },
    { from: '[ref:audio:{i}]', to: 'Voice reference audio {i}' },
    { from: '[ref:scene:{i}]', to: '[Image {i}]' },
    { from: '[ref:shot:{i}]', to: '[Image {i}]' },
  ];

  /**
   * 视频任务占位符替换规则
   * 视频模型通过 media 数组传递参考素材,提示词中统一使用 [Image N] 指代
   * 音频通过 media.reference_voice 绑定,不需要在提示词中出现
   */
  private readonly VIDEO_REF_REPLACEMENTS: Array<{
    from: string;
    to: string;
  }> = [
    { from: '[ref:face:{i}]', to: '[Image {i}]' },
    { from: '[ref:costume:{i}]', to: '[Image {i}]' },
    { from: '[ref:audio:{i}]', to: '' },
    { from: '[ref:scene:{i}]', to: '[Image {i}]' },
    { from: '[ref:shot:{i}]', to: '[Image {i}]' },
  ];

  /**
   * HappyHorse 模型专用图片占位符替换
   */
  private readonly HAPPYHORSE_IMAGE_REPLACEMENTS: Array<{
    from: string;
    to: string;
  }> = [
    { from: '【图{i}】', to: '[Image {i}]' },
    { from: '[图片{i}]', to: '[Image {i}]' },
    { from: '[图{i}]', to: '[Image {i}]' },
    { from: '图片{i}', to: '[Image {i}]' },
  ];

  transform(prompt: string, context?: AliyunPromptTransformContext): string {
    let result = prompt;

    const isHappyHorse = context?.supports?.modelFamily === 'happyhorse';
    const isVideo = context?.taskType === 'video';

    // 通用视频后缀
    if (isVideo) {
      result = result + this.VIDEO_SUFFIX;
    }

    // 处理统一占位符
    const replacements = isVideo
      ? this.VIDEO_REF_REPLACEMENTS
      : this.REF_REPLACEMENTS;
    result = this.applyReplacements(result, replacements);

    // 视频任务:移除音频引用后清理残留标点
    if (isVideo) {
      result = this.cleanupAudioRefResiduals(result);
    }

    // HappyHorse 模型额外处理 [图N] → [Image N]
    if (isHappyHorse) {
      result = this.applyReplacements(
        result,
        this.HAPPYHORSE_IMAGE_REPLACEMENTS,
      );
    }

    return result;
  }

  /**
   * 清理移除 [ref:audio:N] 后残留的标点符号
   */
  private cleanupAudioRefResiduals(prompt: string): string {
    let result = prompt;

    // 1) 移除 "，[ref:audio:N]，" 中间形态(连续替换后可能残留的逗号组合)
    result = result.replace(/，\s*，/g, '，');

    // 2) 清理空括号："（，" → "（"，"，）" → "）"
    result = result.replace(/（\s*，/g, '（');
    result = result.replace(/，\s*）/g, '）');

    // 3) 清理英文括号同类问题
    result = result.replace(/\(\s*,/g, '(');
    result = result.replace(/,\s*\)/g, ')');

    // 4) 清理连续多个逗号
    result = result.replace(/，{2,}/g, '，');
    result = result.replace(/,{2,}/g, ',');

    // 5) 清理行首/段首的逗号
    result = result.replace(/(^|\n)\s*，/g, '$1');

    // 6) 清理 "内容，\n\n" 中多余的尾随逗号
    result = result.replace(/，\s*(\n|$)/g, '$1');

    return result;
  }

  /**
   * 应用替换规则(支持 {i} 数字占位符)
   */
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
