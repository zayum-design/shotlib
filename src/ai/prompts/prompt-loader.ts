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
 * prompt-loader — 提示词模板加载与变量渲染(前端版)
 *
 * 移植自后端 PromptLoaderService,fs 读取改为 Vite `?raw` 静态导入:
 * 构建期把 config/prompts 目录下全部 .md 模板内联为字符串 Map,运行时零 IO。
 *
 * promptType 统一在 `./prompt-registry.ts` 登记:
 * - 已登记类型:加载模板后按 sharedVars 声明内联注入共享模板(如导演核心协议、镜头语言合同)
 * - 未登记类型:按旧路径推断逻辑解析并输出警告(向后兼容)
 */
import { getPromptTypeEntry, SCRIPT_MODE_OVERLAYS } from './prompt-registry';

// 构建期内联全部模板:键为相对于 config/prompts 的路径(如 'workflow/SCRIPT_GENERATION.md')
const RAW_TEMPLATES: Record<string, string> = import.meta.glob(
  '../../config/prompts/**/*.md',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// 路径 → 内容 查找表(去掉 glob 前缀)
const TEMPLATE_MAP: Map<string, string> = new Map();
for (const [file, content] of Object.entries(RAW_TEMPLATES)) {
  const rel = file.replace(/^.*config\/prompts\//, '');
  TEMPLATE_MAP.set(rel, content);
}

/** 后端风格相对路径 → 本仓库相对路径:开源版模板库省略顶级业务前缀 `drama/` */
function normalizeRelPath(relativePath: string): string {
  return relativePath.startsWith('drama/') ? relativePath.slice('drama/'.length) : relativePath;
}

class PromptLoader {
  // 缓存提示词模板(键为 promptType)
  private promptCache: Map<string, string> = new Map();

  /**
   * 读取提示词模板
   * @param _modelId 模型ID(保留用于未来按模型定制)
   * @param promptType 提示词类型 (drama/script-generation 等)
   * @returns 提示词模板内容(已内联共享模板)
   */
  loadPromptTemplate(_modelId: string, promptType: string): string {
    const cacheKey = promptType;

    // 检查缓存
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey)!;
    }

    const entry = getPromptTypeEntry(promptType);
    if (!entry) {
      console.warn(
        `[PromptLoader] promptType「${promptType}」未在 prompt-registry.ts 登记,按旧路径推断解析`,
      );
    }

    // 解析路径,支持子文件夹,如 drama/script-generation → SCRIPT_GENERATION.md
    const parts = promptType.split('/');
    const fileName = `${parts.pop()!.replace(/-/g, '_').toUpperCase()}.md`;

    // 依次尝试 workflow / instant / shared 子目录与根目录(与后端搜索顺序一致)
    const candidates = ['workflow', 'instant', 'shared'].map(
      (sub) => `${sub}/${fileName}`,
    );
    candidates.push(fileName);

    for (const rel of candidates) {
      const raw = TEMPLATE_MAP.get(rel);
      if (raw !== undefined) {
        // 按注册表声明内联注入共享模板(导演核心协议 / 镜头语言合同等)
        const template = this.inlineSharedVars(raw, entry?.sharedVars);
        this.promptCache.set(cacheKey, template);
        return template;
      }
    }

    console.warn(
      `[PromptLoader] 提示词模板不存在,尝试路径: ${candidates.join(', ')},使用默认提示词`,
    );
    // 回退到默认提示词
    return this.getDefaultPromptTemplate(promptType);
  }

  /**
   * 加载 config/prompts 下指定相对路径的共享模板(不含 .md)。
   * 文件缺失时返回空字符串(优雅降级,不阻断主流程)。
   */
  loadSharedTemplate(relativePath: string): string {
    const cacheKey = `shared:${relativePath}`;
    if (this.promptCache.has(cacheKey)) {
      return this.promptCache.get(cacheKey)!;
    }
    const content = TEMPLATE_MAP.get(normalizeRelPath(`${relativePath}.md`)) ?? '';
    if (!content) {
      console.warn(`[PromptLoader] 共享模板缺失: ${relativePath}.md`);
    }
    this.promptCache.set(cacheKey, content);
    return content;
  }

  /**
   * 将注册表声明的共享模板内联到主模板中(替换 {{变量名}} 占位符)。
   * 公开方法:独立加载路径也复用此能力,保证两条加载链路的共享注入行为一致。
   */
  inlineSharedVarsFor(promptType: string, template: string): string {
    return this.inlineSharedVars(
      template,
      getPromptTypeEntry(promptType)?.sharedVars,
    );
  }

  /**
   * 将注册表声明的共享模板内联到主模板中(替换 {{变量名}} 占位符)
   */
  private inlineSharedVars(
    template: string,
    sharedVars?: Record<string, string>,
  ): string {
    if (!sharedVars) return template;
    let result = template;
    for (const [varName, sharedPath] of Object.entries(sharedVars)) {
      const content = this.loadSharedTemplate(sharedPath);
      const regex = new RegExp(`{{\\s*${varName}\\s*}}`, 'g');
      result = result.replace(regex, content);
    }
    return result;
  }

  /**
   * 加载短剧创作工艺库文件(config/prompts/workflow/drama/{name}.md)。
   * 用于按剧本类型向剧本生成注入题材钩子/开场/节奏等工艺指南。
   */
  loadCraftGuide(name: string): string {
    return this.loadSharedTemplate(`workflow/drama/${name}`);
  }

  /**
   * 加载剧本创作模式叠加层(modes/{drama|story|mood})。
   * 未知模式回退到 drama(付费短剧),保证存量行为不变。
   */
  loadScriptModeOverlay(mode?: string): string {
    const key = (mode || 'drama') as keyof typeof SCRIPT_MODE_OVERLAYS;
    const rel = SCRIPT_MODE_OVERLAYS[key] ?? SCRIPT_MODE_OVERLAYS.drama;
    return this.loadSharedTemplate(rel);
  }

  /**
   * 获取默认提示词模板(当 md 文件不存在时作为回退)
   */
  private getDefaultPromptTemplate(promptType: string): string {
    // 兼容带子目录前缀的 key (drama/script-parsing → script-parsing)
    const key = promptType.includes('/')
      ? promptType.split('/').pop()!
      : promptType;

    if (key === 'script-generation') {
      return `你是一个专业的剧本作家,请根据以下要求创作一个剧本。
主题:{{topic}}

{{#if agentType}}
智能体类型:{{agentType}}
{{/if}}

{{#if skills}}
所需技能:{{skills}}
{{/if}}

剧本要求:
1. 请创作一个完整的剧本,包含3-5幕
2. 每幕需要包含:场景、时间、角色、对话和动作描述
3. 剧本要有起承转合,情节要有冲突和发展
4. 对话要自然生动,符合角色性格
5. 请使用中文创作,剧本格式清晰易读

请直接输出剧本内容,不需要额外的解释。`;
    }

    if (key === 'script-parsing') {
      return `你是一个专业的剧本分析师,请分析给定的剧本,提取以下结构化信息:

请以 JSON 格式返回分析结果,包含以下字段:

1. characters (角色数组): 每个角色应包含:
   - name: 角色姓名
   - description: 角色描述(年龄、性格、职业等)
   - imagePrompt: 生成角色图片的提示词
   - avatarPrompt: 生成角色头像的提示词

2. scenes (场景数组): 每个场景应包含:
   - name: 场景名称
   - description: 场景描述
   - location: 地点
   - timeOfDay: 时间(清晨、上午、下午、夜晚等)
   - imagePrompt: 生成场景图片的提示词

3. era (故事背景对象): 时代名称/描述/年代/地理位置/视觉风格/全局提示词

请确保 JSON 格式正确,只返回 JSON 对象,不要有其他文本。`;
    }

    if (key === 'episode-generation') {
      return `你是一个专业的短剧分镜编剧。请根据给定剧本、角色和场景信息,将完整故事拆分为多个视频片段(episode),每个片段包含若干分镜(shot)。

要求:
1. 每个 episode 内所有 shot 的 duration 之和 ≤ 15 秒,单 shot ≥ 3 秒
2. 每个 shot 只承载一个主体动作与一个主要运镜,写清结束帧画面状态
3. 剧本中的对白必须用 {对白} 格式嵌入 shot 的 prompt 中,禁止省略或新增
4. 角色名/场景名必须与提供的清单逐字一致
5. 情绪描写必须翻译为可见的动作/表情细节,禁止抽象情绪词与套话句式

{{#if previousEndingState}}
上一集结尾状态:{{previousEndingState}}
本集第一个 episode 的首帧必须从该状态自然接续。
{{/if}}

以纯 JSON 返回:{ "episodes": [ { "title": "", "description": "", "shots": [ { "duration": 5, "cameraMovements": ["static"], "shotType": "medium", "cameraAngle": "eye_level", "lighting": "natural", "mood": "bright", "prompt": "", "referencePrompt": "" } ], "firstFramePrompt": "", "lastFramePrompt": "", "firstLastFrameVideoPrompt": "" } ] }

剧本:
{{script}}

角色清单:
{{characters}}

场景清单:
{{scenes}}`;
    }

    if (key === 'scene-shots-generation') {
      return `你是一位专业的短剧导演和分镜师。请根据提供的场景信息和角色信息,为这个场景设计分镜列表。

要求:
1. 分镜总时长不超过15秒,每个分镜3-8秒,共2-5个
2. 每个分镜只承载一个主体动作与一个主要运镜,写清结束帧画面状态
3. 每个分镜包含 duration / cameraMovements / shotType / cameraAngle / lighting / mood / prompt / dialogue 字段;有对白的分镜必须以 {对白} 格式嵌入 prompt
4. 角色姓名后标注年龄(如「张三(25岁)」),场景名必须完整不得简写
5. 额外生成 firstFramePrompt / lastFramePrompt(纯静态定格画面)与 firstLastFrameVideoPrompt(用视觉特征指代人物,禁止角色姓名)
6. 情绪描写翻译为可见细节,禁止抽象情绪词与套话句式

以纯 JSON 返回:{ "shots": [...], "firstFramePrompt": "", "lastFramePrompt": "", "firstLastFrameVideoPrompt": "" }`;
    }

    return '';
  }

  /**
   * 渲染提示词模板,替换变量
   */
  renderTemplate(template: string, variables: Record<string, unknown>): string {
    let result = template;

    // 处理简单变量替换 {{variable}}
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, String(value ?? ''));
    }

    // 处理条件块 {{#if variable}}...{{/if}}
    const ifBlockRegex = /{{#if\s+(\w+)}}([\s\S]*?){{\/if}}/g;
    result = result.replace(ifBlockRegex, (_match, varName, content) => {
      const varValue = variables[varName];
      if (varValue && (Array.isArray(varValue) ? varValue.length > 0 : true)) {
        return content;
      }
      return '';
    });

    return result;
  }
}

/** 全局单例(编排服务共享同一份缓存) */
export const promptLoader = new PromptLoader();
