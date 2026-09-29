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

import { modelSDK } from './model-sdk';
import {
  extractJsonString,
  tryRepairIncompleteJson,
  fixMissingKeys,
} from './json-repair.utils';
import type {
  ScriptGenerationOptions,
  ScriptParsingOptions,
  EpisodeGenerationOptions,
  LyricsGenerationOptions,
  CharacterInfo,
  SceneInfo,
  Shot,
  Episode,
} from './ai-model.dto';
import {
  translateShotType,
  translateCameraMovements,
  translateCameraAngle,
  translateLighting,
  translateMood,
 } from './shot-translation.utils';
import { promptLoader } from '@/ai/prompts/prompt-loader';
import { lyricsGenerator } from './lyrics-generation.service';

export class AIModelService {
  // 前端版无 DI:直接引用模块级单例
  private readonly modelSDK = modelSDK;
  private readonly promptLoader = promptLoader;
  private readonly lyricsGenerator = lyricsGenerator;

  async generateScript(
    modelId: string,
    options: ScriptGenerationOptions,
  ): Promise<{ script: string; summary: string }> {
    const startTime = Date.now();
    console.log(
      `[AIModelService] 使用模型 ${modelId} 生成剧本，话题: ${options.topic}`,
    );

    try {
      // 从模型目录加载并渲染提示词
      const promptStartTime = Date.now();
      const systemPrompt = this.buildScriptGenerationPrompt(modelId, options);
      const promptTime = Date.now() - promptStartTime;

      // 使用统一SDK
      // timeout 600s：与 generateEpisodes 一致，12000 maxTokens 非流式长文生成
      // （kimi-k3 实测 >180s）远超 adapter 默认 180s
      const sdkStartTime = Date.now();
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: options.topic },
        systemPrompt,
        parameters: {
          temperature: 0.8,
          maxTokens: 12000,
        },
        options: { timeout: 600000 },
      });
      const sdkTime = Date.now() - sdkStartTime;
      const totalTime = Date.now() - startTime;

      console.log(
        `[AIModelService] 剧本生成完成 model=${modelId}, prompt构建=${promptTime}ms, SDK调用=${sdkTime}ms, 总耗时=${totalTime}ms, success=${response.success}, content长度=${response.data?.content?.length || 0}`,
      );

      if (!response.success) {
        throw new Error(response.error?.message || '生成剧本失败');
      }

      // 防御：推理链耗尽 max_tokens 等情况下上游会返回 success 但 content 为空，
      // 此处必须显式失败，避免向用户返回空剧本
      const content = response.data?.content || '';
      if (!content.trim()) {
        throw new Error('模型返回内容为空，请重试或切换其他模型');
      }

      return this.extractScriptAndSummary(content);
    } catch (error) {
      console.error(
        `[AIModelService] 生成剧本失败 model=${modelId}, elapsed=${Date.now() - startTime}ms:`,
        error,
      );
      throw new Error(
        `生成剧本失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 从 LLM 输出中拆分故事梗概与剧本正文
   */
  private extractScriptAndSummary(content: string): {
    script: string;
    summary: string;
  } {
    const marker = '# 故事梗概';
    const idx = content.indexOf(marker);
    if (idx === -1) {
      return { script: content, summary: '' };
    }

    const after = content.slice(idx + marker.length);
    const next = after.search(/\n# /);
    if (next === -1) {
      return {
        script: content.slice(0, idx).trim(),
        summary: after.trim(),
      };
    }

    return {
      script: (content.slice(0, idx) + after.slice(next)).trim(),
      summary: after.slice(0, next).trim(),
    };
  }

  private buildScriptGenerationPrompt(
    modelId: string,
    options: ScriptGenerationOptions,
  ): string {
    const {
      topic,
      agentType,
      subStyleHint,
      skills,
      isEnding,
      genreGuide,
      genreHooks,
      creationMode,
    } = options;

    // 加载模板
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/script-generation',
    );

    // 优先使用子风格的 promptHint，如果没有则使用主风格的 agentType
    const styleHint = subStyleHint || agentType || '';

    // 渲染模板（modeGuide 为创作模式叠加层：付费短剧/故事短片/氛围情绪短片）
    return this.promptLoader.renderTemplate(template, {
      topic,
      agentType: styleHint,
      skills: skills ? skills.join('、') : '',
      isEnding: isEnding ? 'true' : '',
      genreGuide: genreGuide || '',
      genreHooks: genreHooks || '',
      modeGuide: this.promptLoader.loadScriptModeOverlay(creationMode),
    });
  }

  /**
   * 委托到 LyricsGenerationService
   */
  async generateLyrics(
    modelId: string,
    options: LyricsGenerationOptions,
  ): Promise<string> {
    return this.lyricsGenerator.generateLyrics(modelId, options);
  }

  async parseScript(
    modelId: string,
    options: ScriptParsingOptions,
  ): Promise<{
    characters: any[];
    scenes: any[];
    /** 剧本中的关键道具（信物/武器等有视觉意义的物品），旧模板缺失时为空数组 */
    props: any[];
    era: any;
    relationshipNetwork: any;
    /** 分集叙事纲要（戏剧功能/情绪弧线/事件分桶/结尾状态），旧剧本缺失时为空数组 */
    episodeOutlines: any[];
  }> {
    const startTime = Date.now();
    console.log(`[AIModelService] 使用模型 ${modelId} 解析剧本`);

    try {
      // 从模型目录加载提示词
      const promptStartTime = Date.now();
      const systemPrompt = this.buildScriptParsingPrompt(modelId);
      const promptTime = Date.now() - promptStartTime;

      // 使用统一SDK
      const sdkStartTime = Date.now();
      const isVolcEngineModel =
        modelId.includes('volcengine') || modelId.includes('doubao');
      const requestParameters: Record<string, any> = {
        temperature: 0.3,
        maxTokens: 12000,
      };
      // 非火山引擎模型需要设置 responseFormat 以确保返回 JSON
      if (!isVolcEngineModel) {
        requestParameters.responseFormat = { type: 'json_object' };
      }
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: options.script },
        systemPrompt,
        parameters: requestParameters,
        options: { timeout: 600000 },
      });
      const sdkTime = Date.now() - sdkStartTime;
      const totalTime = Date.now() - startTime;

      console.log(
        `[AIModelService] 剧本解析完成 model=${modelId}, prompt构建=${promptTime}ms, SDK调用=${sdkTime}ms, 总耗时=${totalTime}ms, success=${response.success}`,
      );

      if (!response.success) {
        throw new Error(response.error?.message || '解析剧本失败');
      }

      // 生成时间戳
      const timestamp = Date.now();

      // 解析返回的 JSON 数据
      const parsedData = this.parseScriptAnalysisResponse(
        response.data.content || '',
      );
      const characters = this.enrichCharacters(
        parsedData.characters || [],
        parsedData.portraits || [],
        timestamp,
      );
      const scenes = this.enrichScenes(parsedData.scenes || [], timestamp);
      const props = this.enrichProps(
        Array.isArray(parsedData.props) ? parsedData.props : [],
        timestamp,
      );
      const era = this.enrichEra(parsedData.era || {}, timestamp);
      const relationshipNetwork = this.enrichRelationshipNetwork(
        parsedData.relationshipNetwork || {},
        timestamp,
        characters,
      );

      return {
        characters,
        scenes,
        props,
        era,
        relationshipNetwork,
        // 分集叙事纲要：新模板输出，旧数据/模型漏出时降级为空数组（向后兼容）
        episodeOutlines: Array.isArray(parsedData.episodeOutlines)
          ? parsedData.episodeOutlines
          : [],
      };
    } catch (error) {
      console.error(`[AIModelService] 解析剧本失败:`, error);
      throw new Error(
        `解析剧本失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildScriptParsingPrompt(modelId: string): string {
    // 加载模板
    return this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/script-parsing',
    );
  }

  /**
   * 校验审阅剧本：根据故事梗概对剧本进行合理性二次校验，输出审阅报告
   */
  async reviewScript(
    modelId: string,
    options: { script: string; summary?: string; creationMode?: string },
  ): Promise<string> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/script-review',
    );
    // 「节奏」维度的检查标准随创作模式分流：付费短剧查钩子，故事片查叙事弧线，氛围片查情绪曲线
    const reviewRhythmHint =
      options.creationMode === 'story'
        ? '叙事完整性与情感弧线：开端-发展-高潮-结局是否完整，高潮是否由人物行动或选择达成，结尾情感落点是否真实（本模式不强制开场钩子与结尾悬念）'
        : options.creationMode === 'mood'
          ? '情绪曲线与氛围统一性：核心情绪是否唯一且全片统一，建立→沉浸→峰值→余韵是否完整，核心意象是否复现呼应，有无空洞唯美空镜堆砌（本模式不强制剧情冲突与悬念）'
          : '节奏与钩子：开场是否有钩子，冲突推进是否紧凑，结尾是否留有悬念（付费短剧节奏）';
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      summary:
        options.summary || '（未提供故事梗概，请仅基于剧本自身进行审阅）',
      reviewRhythmHint,
    });
    return this.callTextModel(
      modelId,
      systemPrompt,
      options.script,
      '校验审阅剧本',
    );
  }

  /**
   * 修改剧本：按用户修改要求对当前剧本进行修改，返回修改后的完整剧本
   */
  async modifyScript(
    modelId: string,
    options: { script: string; summary?: string; requirement: string },
  ): Promise<string> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/script-modify',
    );
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      summary: options.summary || '（未提供故事梗概）',
      requirement: options.requirement,
    });
    return this.callTextModel(
      modelId,
      systemPrompt,
      options.script,
      '修改剧本',
    );
  }

  /**
   * 校验审阅资产提示词：根据剧本对分解产出的角色/场景提示词进行合理性二次校验，输出审阅报告
   */
  async reviewAssetPrompts(
    modelId: string,
    options: { script: string; characters: any[]; scenes: any[] },
  ): Promise<string> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/asset-prompt-review',
    );
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      characters: this.buildAssetPromptListText(
        options.characters,
        'character',
      ),
      scenes: this.buildAssetPromptListText(options.scenes, 'scene'),
    });
    return this.callTextModel(
      modelId,
      systemPrompt,
      `剧本正文：\n${options.script}`,
      '校验审阅资产提示词',
    );
  }

  /**
   * 修改资产提示词：按用户修改要求对角色/场景提示词进行修改，
   * 返回 JSON（仅包含需要修改的资产和字段）
   */
  async modifyAssetPrompts(
    modelId: string,
    options: {
      script: string;
      characters: any[];
      scenes: any[];
      requirement: string;
    },
  ): Promise<{
    characters: {
      name: string;
      imagePrompt?: string;
      avatarPrompt?: string;
      voicePrompt?: string;
    }[];
    scenes: { name: string; imagePrompt?: string }[];
  }> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/asset-prompt-modify',
    );
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      characters: this.buildAssetPromptListText(
        options.characters,
        'character',
      ),
      scenes: this.buildAssetPromptListText(options.scenes, 'scene'),
      requirement: options.requirement,
    });

    const startTime = Date.now();
    const taskLabel = '修改资产提示词';
    console.log(`[AIModelService] 使用模型 ${modelId} ${taskLabel}`);
    try {
      const isVolcEngineModel =
        modelId.includes('volcengine') || modelId.includes('doubao');
      const parameters: Record<string, any> = {
        temperature: 0.5,
        maxTokens: 12000,
      };
      // 非火山引擎模型需要设置 responseFormat 以确保返回 JSON
      if (!isVolcEngineModel) {
        parameters.responseFormat = { type: 'json_object' };
      }
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: `剧本正文：\n${options.script}` },
        systemPrompt,
        parameters,
        options: { timeout: 600000 },
      });
      console.log(
        `[AIModelService] ${taskLabel}完成 model=${modelId}, 总耗时=${Date.now() - startTime}ms, success=${response.success}`,
      );
      if (!response.success) {
        throw new Error(response.error?.message || `${taskLabel}失败`);
      }
      const content = response.data?.content || '';
      const jsonString = extractJsonString(content);
      if (!jsonString) {
        throw new Error(`${taskLabel}失败: 模型未返回有效 JSON`);
      }
      const parsed = JSON.parse(jsonString);
      return {
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      };
    } catch (error) {
      console.error(`[AIModelService] ${taskLabel}失败:`, error);
      throw new Error(
        `${taskLabel}失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 将角色/场景数组渲染为提示词清单文本（供校验/修改模板使用）
   */
  private buildAssetPromptListText(
    assets: any[],
    kind: 'character' | 'scene',
  ): string {
    if (!assets?.length) return '（无）';
    if (kind === 'character') {
      return assets
        .map((c) => {
          const lines = [`角色：${c.name}`];
          if (c.gender) lines.push(`  性别：${c.gender}`);
          if (c.age !== undefined && c.age !== '')
            lines.push(`  年龄：${c.age}`);
          if (c.description) lines.push(`  角色描述：${c.description}`);
          lines.push(`  形象提示词(imagePrompt)：${c.imagePrompt || '（空）'}`);
          lines.push(
            `  头像提示词(avatarPrompt)：${c.avatarPrompt || '（空）'}`,
          );
          if (c.voicePrompt)
            lines.push(`  音色提示词(voicePrompt)：${c.voicePrompt}`);
          return lines.join('\n');
        })
        .join('\n\n');
    }
    return assets
      .map((s) => {
        const lines = [`场景：${s.name}`];
        if (s.description) lines.push(`  场景描述：${s.description}`);
        if (s.location) lines.push(`  地点：${s.location}`);
        if (s.timeOfDay) lines.push(`  时间：${s.timeOfDay}`);
        if (s.season) lines.push(`  季节：${s.season}`);
        if (s.weather) lines.push(`  天气：${s.weather}`);
        lines.push(`  场景图提示词(imagePrompt)：${s.imagePrompt || '（空）'}`);
        return lines.join('\n');
      })
      .join('\n\n');
  }

  /**
   * 校验审阅片段提示词：根据剧本对片段生成产出的片段/分镜提示词进行合理性二次校验，输出审阅报告
   */
  async reviewEpisodePrompts(
    modelId: string,
    options: { script: string; episodes: any[]; characters?: any[] },
  ): Promise<string> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/episode-prompt-review',
    );
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      episodes: this.buildEpisodePromptListText(options.episodes),
      characters: this.buildCharacterPortraitListText(options.characters),
    });
    return this.callTextModel(
      modelId,
      systemPrompt,
      `剧本正文：\n${options.script}`,
      '校验审阅片段提示词',
    );
  }

  /**
   * 修改片段提示词：按用户修改要求对片段/分镜提示词进行修改，
   * 返回 JSON（仅包含需要修改的片段/分镜和字段）
   */
  async modifyEpisodePrompts(
    modelId: string,
    options: {
      script: string;
      episodes: any[];
      characters?: any[];
      requirement: string;
    },
  ): Promise<{
    episodes: {
      id: string;
      videoPrompt?: string;
      firstFramePrompt?: string;
      lastFramePrompt?: string;
      firstLastFrameVideoPrompt?: string;
      shots?: {
        id: string;
        prompt?: string;
        referencePrompt?: string;
        [key: string]: any;
      }[];
      /** 新增片段时输出 */
      title?: string;
      description?: string;
      /** 删除片段标记 */
      deleted?: boolean;
      [key: string]: any;
    }[];
  }> {
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/episode-prompt-modify',
    );
    const systemPrompt = this.promptLoader.renderTemplate(template, {
      episodes: this.buildEpisodePromptListText(options.episodes),
      characters: this.buildCharacterPortraitListText(options.characters),
      requirement: options.requirement,
    });

    const startTime = Date.now();
    const taskLabel = '修改片段提示词';
    console.log(`[AIModelService] 使用模型 ${modelId} ${taskLabel}`);
    try {
      const isVolcEngineModel =
        modelId.includes('volcengine') || modelId.includes('doubao');
      // maxTokens 32000：与 generateEpisodes 对齐。推理模型的 reasoning 与 content 共享该额度，
      // 「增加片段」类要求需输出完整新片段 JSON（含分镜/首尾帧），16000 会被 reasoning 耗尽导致 content 为空
      const parameters: Record<string, any> = {
        temperature: 0.5,
        maxTokens: 32000,
      };
      // 非火山引擎模型需要设置 responseFormat 以确保返回 JSON
      if (!isVolcEngineModel) {
        parameters.responseFormat = { type: 'json_object' };
      }
      // timeout 600s：与 generateEpisodes 一致，32000 maxTokens 非流式生成远超 adapter 默认 180s
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: `剧本正文：\n${options.script}` },
        systemPrompt,
        parameters,
        options: { timeout: 600000 },
      });
      console.log(
        `[AIModelService] ${taskLabel}完成 model=${modelId}, 总耗时=${Date.now() - startTime}ms, success=${response.success}`,
      );
      if (!response.success) {
        throw new Error(response.error?.message || `${taskLabel}失败`);
      }
      const content = response.data?.content || '';
      const jsonString = extractJsonString(content);
      if (!jsonString) {
        // content 为空但 reasoning 有内容 = maxTokens 被推理耗尽（推理模型 reasoning 与 content 共享额度）
        const hasReasoning = !!response.data?.extra?.reasoningContent;
        throw new Error(
          hasReasoning && !content.trim()
            ? `${taskLabel}失败: 模型输出超出长度限制（推理占用过多），请缩小修改范围或分多次修改后重试`
            : `${taskLabel}失败: 模型未返回有效 JSON`,
        );
      }
      const parsed = JSON.parse(jsonString);
      return {
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
      };
    } catch (error) {
      console.error(`[AIModelService] ${taskLabel}失败:`, error);
      throw new Error(
        `${taskLabel}失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 将片段数组渲染为提示词清单文本（供校验/修改模板使用）。
   * 发送前剥离 <img> 标签与 [图N] 标记：shot.prompt 中的图片标签带超长 OSS 地址，
   * 会淹没模型注意力导致审阅质量差、修改时复读原文；结构标签 @<role>/@<portrait> 保留。
   */
  private buildEpisodePromptListText(episodes: any[]): string {
    const stripNoise = (text: string): string =>
      (text || '')
        .replace(/<img[^>]*>/g, '')
        .replace(/\[图\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!episodes?.length) return '（无）';
    return episodes
      .map((ep, epIndex) => {
        const lines = [
          `片段 ${epIndex + 1}：${ep.title || ''}（id: ${ep.id}）`,
        ];
        if (ep.description) lines.push(`  片段描述：${ep.description}`);
        lines.push(
          `  视频提示词(videoPrompt)：${stripNoise(ep.videoPrompt) || '（空）'}`,
        );
        if (ep.firstFramePrompt !== undefined) {
          lines.push(
            `  首帧提示词(firstFramePrompt)：${stripNoise(ep.firstFramePrompt) || '（空）'}`,
          );
        }
        if (ep.lastFramePrompt !== undefined) {
          lines.push(
            `  尾帧提示词(lastFramePrompt)：${stripNoise(ep.lastFramePrompt) || '（空）'}`,
          );
        }
        if (ep.firstLastFrameVideoPrompt) {
          lines.push(
            `  首尾帧视频提示词(firstLastFrameVideoPrompt)：${stripNoise(ep.firstLastFrameVideoPrompt)}`,
          );
        }
        (ep.shots || []).forEach((shot: any, shotIndex: number) => {
          lines.push(`  分镜 ${shotIndex + 1}（id: ${shot.id}）：`);
          lines.push(
            `    分镜提示词(prompt)：${stripNoise(shot.prompt) || '（空）'}`,
          );
          if (shot.referencePrompt !== undefined) {
            lines.push(
              `    参考图提示词(referencePrompt)：${stripNoise(shot.referencePrompt) || '（空）'}`,
            );
          }
        });
        return lines.join('\n');
      })
      .join('\n\n');
  }

  /**
   * 将角色数组渲染为"角色名 + id + 形象照名列表"清单文本
   * 供片段提示词校验/修改时核对 @<portrait> 标签的 character-id 归属
   */
  private buildCharacterPortraitListText(characters?: any[]): string {
    if (!characters?.length)
      return '（未提供角色清单，跳过形象照引用一致性检查）';
    return characters
      .map((c) => {
        const portraitNames = (c.fullBodyImages || [])
          .map((img: any, idx: number) =>
            img?.name ? `${img.name}(index=${idx})` : null,
          )
          .filter(Boolean);
        const portraits =
          portraitNames.length > 0 ? portraitNames.join('、') : '无形象照';
        return `角色：${c.name}（id: ${c.id}）\n  形象照：${portraits}`;
      })
      .join('\n');
  }

  /**
   * 统一的文本模型调用（校验/修改等单轮文本任务共用）
   */
  private async callTextModel(
    modelId: string,
    systemPrompt: string,
    userText: string,
    taskLabel: string,
  ): Promise<string> {
    const startTime = Date.now();
    console.log(`[AIModelService] 使用模型 ${modelId} ${taskLabel}`);
    try {
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: userText },
        systemPrompt,
        parameters: {
          temperature: 0.5,
          maxTokens: 12000,
        },
        options: { timeout: 600000 },
      });
      console.log(
        `[AIModelService] ${taskLabel}完成 model=${modelId}, 总耗时=${Date.now() - startTime}ms, success=${response.success}, content长度=${response.data?.content?.length || 0}`,
      );
      if (!response.success) {
        throw new Error(response.error?.message || `${taskLabel}失败`);
      }
      const content = response.data?.content?.trim();
      if (!content) {
        throw new Error(`${taskLabel}失败: 模型未返回内容`);
      }
      return content;
    } catch (error) {
      console.error(`[AIModelService] ${taskLabel}失败:`, error);
      throw new Error(
        `${taskLabel}失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ============ 片段生成 ============

  async generateEpisodes(
    modelId: string,
    options: EpisodeGenerationOptions,
  ): Promise<Episode[]> {
    console.log(`[AIModelService] 使用模型 ${modelId} 生成片段`);

    try {
      // 从模型目录加载提示词
      const systemPrompt = this.buildEpisodeGenerationPrompt(modelId, options);

      // 构建请求参数
      // maxTokens 提升至 32000：长剧本（8-15 个片段节拍）的完整分镜 JSON（每 shot 含 prompt/referencePrompt/首尾帧/首尾帧视频提示词）
      // 估算需 24000-40000 token，12000 会截断后半段 episode 与台词。各 adapter 会按模型实际上限自动兜底（如 deepseek 384K）。
      const parameters: Record<string, any> = {
        temperature: 0.7,
        maxTokens: 32000,
      };

      const isVolcEngineModel =
        modelId.includes('volcengine') || modelId.includes('doubao');
      if (!isVolcEngineModel) {
        parameters.responseFormat = { type: 'json_object' };
      } else {
        console.log(
          `[AIModelService] 火山引擎模型 ${modelId} 不支持 response_format 参数，依赖提示词要求 JSON 格式`,
        );
      }

      // 使用统一SDK
      // timeout 600s：maxTokens=32000 的非流式长文生成（deepseek 约 40-60 tok/s）远超 adapter 默认 180s，
      // 不加大超时会导致主模型必超时、12 个 fallback 串行空转（生产事故：任务跑 15 分钟全失败，前端 5 分钟已报"轮询超时"）
      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: `剧本：\n${options.script}` },
        systemPrompt,
        parameters,
        options: { timeout: 600000 },
      });

      if (!response.success) {
        throw new Error(response.error?.message || '生成片段失败');
      }

      // 生成时间戳
      const timestamp = Date.now();

      // 解析返回的 JSON 数据
      const parsedData = this.parseEpisodeGenerationResponse(
        response.data.content || '',
      );
      console.log(
        `[AIModelService] 解析后 episodes 数量: ${parsedData.episodes?.length ?? 0}`,
      );
      if (parsedData.episodes?.length > 0) {
        console.log(
          `[AIModelService] 第一个 episode 字段:`,
          Object.keys(parsedData.episodes[0]),
        );
        console.log(
          `[AIModelService] 第一个 episode shots 数量:`,
          parsedData.episodes[0].shots?.length ?? 0,
        );
      }

      // 转换字符和场景信息
      const characterInfos: CharacterInfo[] = (options.characters || []).map(
        (c) => ({
          id: c.id || '',
          name: c.name || '',
          description: c.description,
          avatarUrl: c.avatarUrl || (c.avatarUrls && c.avatarUrls[0]),
          fullBodyUrl:
            c.fullBodyUrl ||
            (c.fullBodyUrls && c.fullBodyUrls[0]) ||
            (c.fullBodyImages && c.fullBodyImages[0]?.imageUrl),
        }),
      );

      const sceneInfos: SceneInfo[] = (options.scenes || []).map((s) => ({
        id: s.id || '',
        name: s.name || '',
        description: s.description,
        imageUrl: s.imageUrl || (s.imageUrls && s.imageUrls[0]),
      }));

      const episodes = this.enrichEpisodes(
        parsedData.episodes || [],
        timestamp,
        characterInfos,
        sceneInfos,
        options.maxEpisodeDuration === 30 ? 30 : 15,
      );
      console.log(`[AIModelService] enrichEpisodes 后数量: ${episodes.length}`);

      return episodes;
    } catch (error) {
      console.error(`[AIModelService] 生成片段失败:`, error);
      throw new Error(
        `生成片段失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildEpisodeGenerationPrompt(
    modelId: string,
    options: EpisodeGenerationOptions,
  ): string {
    const { script, characters, scenes, props } = options;

    // 格式化角色列表
    const charactersText =
      characters && characters.length > 0
        ? characters
            .map((c) => `- ${c.name}: ${c.description || '暂无描述'}`)
            .join('\n')
        : '暂无角色信息';

    // 格式化场景列表
    const scenesText =
      scenes && scenes.length > 0
        ? scenes
            .map((s) => `- ${s.name}: ${s.description || '暂无描述'}`)
            .join('\n')
        : '暂无场景信息';

    // 格式化道具列表
    const propsText =
      props && props.length > 0
        ? props
            .map((p) => `- ${p.name}: ${p.description || '暂无描述'}`)
            .join('\n')
        : '暂无线索道具信息';

    // 加载模板
    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'drama/episode-generation',
    );

    // 渲染模板
    const rendered = this.promptLoader.renderTemplate(template, {
      script: script, // 完整剧本
      characters: charactersText,
      scenes: scenesText,
      props: propsText,
      // 上集结尾状态与事件分桶：首集/未提供时传空串，模板的 {{#if}} 条件块自动移除
      previousEndingState: options.previousEndingState || '',
      eventBuckets: options.eventBuckets || '',
    });

    // 片段时长规则叠加层：以请求注入的上限为准（15s 或 30s,30s 仅长片段模型如 seedance2.5 支持），
    // 覆盖模板中的默认时长约束
    const maxTotal = options.maxEpisodeDuration === 30 ? 30 : 15;
    const rhythm =
      maxTotal >= 30
        ? '0-6s 建立 / 6-12s 引入 / 12-18s 发展 / 18-24s 高潮 / 24-30s 落点留钩'
        : '0-3s 建立 / 3-6s 引入 / 6-9s 发展 / 9-12s 高潮 / 12-15s 落点留钩';
    const durationRule = `

【本次生成的片段时长规则（优先级高于模板中任何默认时长约束）】
- 每个 episode 内所有 shots 的 duration 之和严禁超过 ${maxTotal} 秒；
- 单个 shot duration ≥ 3 秒且 ≤ 10 秒；每个 episode 2-5 个 shot；
- 每个 episode 的 shots 节奏结构按「${rhythm}」推进；
- 对白字数与时长适配（正常语速约 2.5 字/秒），输出前逐集验算 duration 之和 ≤ ${maxTotal}。`;

    return rendered + durationRule;
  }

  /**
   * 从 AI 响应文本中提取 JSON 字符串
   */
  private parseEpisodeGenerationResponse(responseText: string): any {
    try {
      // 使用 extractJsonString 更精确地提取 JSON（处理代码块、包裹等）
      const jsonString = extractJsonString(responseText);
      console.log(
        `[AIModelService] extractJsonString 结果长度: ${jsonString?.length ?? 0}`,
      );
      if (!jsonString) {
        throw new Error('无法从响应中提取 JSON');
      }

      const parsed = JSON.parse(jsonString);
      console.log(
        `[AIModelService] JSON.parse 成功, episodes 类型: ${typeof parsed.episodes}, 是否为数组: ${Array.isArray(parsed.episodes)}`,
      );
      return parsed;
    } catch (error) {
      console.error('[AIModelService] 解析片段生成 JSON 失败:', error);
      console.error('原始响应长度:', responseText.length);
      console.error(
        '原始响应末尾200字符:',
        responseText.substring(Math.max(0, responseText.length - 200)),
      );

      // 尝试修复不完整的 JSON
      const repairedJson = tryRepairIncompleteJson(responseText);
      console.log(
        `[AIModelService] tryRepairIncompleteJson 结果长度: ${repairedJson?.length ?? 0}`,
      );
      if (repairedJson) {
        try {
          console.log('[AIModelService] 尝试使用修复后的 JSON 解析片段数据');
          const parsed = JSON.parse(repairedJson);
          console.log(
            `[AIModelService] 修复后 JSON.parse 成功, episodes 类型: ${typeof parsed.episodes}, 是否为数组: ${Array.isArray(parsed.episodes)}`,
          );
          return parsed;
        } catch (repairError) {
          console.error(
            '[AIModelService] 修复后的 JSON 仍然解析失败:',
            repairError,
          );
        }
      }

      throw new Error(
        `AI 返回的片段数据格式不正确: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 片段分镜总时长归一化：总时长超过 maxTotal 时按比例压缩各分镜时长。
   * 单分镜最低 2 秒；地板导致仍超限时从最长分镜逐个削减（极端情况兜底）。
   */
  private normalizeShotDurations(
    shots: any[],
    maxTotal: number,
    episodeLabel: string,
  ): any[] {
    const total = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
    if (total <= maxTotal) return shots;

    const scale = maxTotal / total;
    const normalized = shots.map((s) => ({
      ...s,
      duration: Math.max(2, Math.round((s.duration || 0) * scale)),
    }));

    let sum = normalized.reduce((acc, s) => acc + s.duration, 0);
    while (sum > maxTotal) {
      const longest = normalized.reduce((a, b) =>
        b.duration > a.duration ? b : a,
      );
      if (longest.duration <= 2) break; // 全部触底，无法再压（极端情况）
      longest.duration -= 1;
      sum -= 1;
    }

    console.warn(
      `[AIModelService]「${episodeLabel}」分镜总时长 ${total}s 超过 ${maxTotal}s 上限，已按比例压缩为 ${sum}s`,
    );
    return normalized;
  }

  /**
   * 从分镜 prompt 中提取 {对白} 内容（dialogue 字段缺失时的兜底）。
   * 拼接所有 {...} 段，按出现顺序以换行连接；无对白时返回空字符串。
   */
  private extractDialogueFromPrompt(prompt: string): string {
    if (!prompt) return '';
    const matches = prompt.match(/\{([^{}]+)\}/g);
    if (!matches || matches.length === 0) return '';
    return matches.map((m) => m.slice(1, -1).trim()).filter(Boolean).join('\n');
  }

  private enrichEpisodes(
    episodes: any[],
    timestamp: number,
    characters?: CharacterInfo[],
    scenes?: SceneInfo[],
    maxTotalDuration = 15,
  ): Episode[] {
    const videoModels = ['SVD', 'DynamiCamera', 'MorphStudio'];

    // 构建角色和场景名称映射（用于替换）
    const characterMap = new Map<string, CharacterInfo>();
    const sceneMap = new Map<string, SceneInfo>();

    if (characters) {
      characters.forEach((char) => {
        characterMap.set(char.name, char);
        // 同时添加不带空格的版本用于模糊匹配
        characterMap.set(char.name.trim(), char);
      });
    }

    if (scenes) {
      scenes.forEach((scene) => {
        sceneMap.set(scene.name, scene);
        sceneMap.set(scene.name.trim(), scene);
      });
    }

    return episodes.map((ep, index) => {
      const episodeId = crypto.randomUUID();

      // 处理分镜数据
      let shots: any[] = (ep.shots || []).map(
        (shot: any, shotIndex: number) => {
          const rawPrompt = shot.prompt || '场景描述';
          const rawReferencePrompt = shot.referencePrompt || rawPrompt;

          // 替换角色和场景标记
          const processedPrompt = this.replaceCharacterAndSceneMarkers(
            rawPrompt,
            characterMap,
            sceneMap,
          );
          const processedReferencePrompt = this.replaceCharacterAndSceneMarkers(
            rawReferencePrompt,
            characterMap,
            sceneMap,
          );

          return {
            id: shot.id || `shot-${timestamp}-${index}-${shotIndex}`,
            duration: Math.min(
              Math.max(shot.duration || 5, 1),
              maxTotalDuration,
            ), // 限制在 1-maxTotalDuration 秒
            cameraMovements: Array.isArray(shot.cameraMovements)
              ? shot.cameraMovements
              : ['static'],
            shotType: shot.shotType || 'medium',
            cameraAngle: shot.cameraAngle || 'eye_level',
            lighting: shot.lighting || 'natural',
            mood: shot.mood || 'bright',
            prompt: processedPrompt, // 替换标记后的提示词（已包含对白内容）
            rawPrompt: rawPrompt, // 原始提示词
            referencePrompt: processedReferencePrompt, // 替换标记后的参考图提示词
            rawReferencePrompt: rawReferencePrompt, // 原始参考图提示词
            // 保留 LLM 输出的对白字段（供下游配音/字幕/时长校验）；
            // LLM 漏输出时从 prompt 的 {} 中提取兜底
            dialogue:
              typeof shot.dialogue === 'string'
                ? shot.dialogue
                : this.extractDialogueFromPrompt(rawPrompt),
          };
        },
      );

      // 如果没有分镜，创建默认分镜
      if (shots.length === 0) {
        const defaultShots = [
          {
            id: `shot-${timestamp}-${index}-0`,
            duration: 5,
            cameraMovements: ['static'],
            shotType: 'long',
            cameraAngle: 'eye_level',
            lighting: 'natural',
            mood: 'bright',
            rawPrompt: `${ep.title || '场景'} - 开场镜头，建立场景`,
          },
          {
            id: `shot-${timestamp}-${index}-1`,
            duration: 5,
            cameraMovements: ['push_in'],
            shotType: 'medium_close_up',
            cameraAngle: 'eye_level',
            lighting: 'soft',
            mood: 'warm',
            rawPrompt: `${ep.title || '场景'} - 主体动作，角色互动`,
          },
          {
            id: `shot-${timestamp}-${index}-2`,
            duration: 5,
            cameraMovements: ['pull_out'],
            shotType: 'medium',
            cameraAngle: 'eye_level',
            lighting: 'cinematic',
            mood: 'moody',
            rawPrompt: `${ep.title || '场景'} - 结尾镜头，完成叙事`,
          },
        ];

        shots = defaultShots.map((shot) => ({
          ...shot,
          prompt: this.replaceCharacterAndSceneMarkers(
            shot.rawPrompt,
            characterMap,
            sceneMap,
          ),
        }));
      }

      // 硬性约束：单片段分镜总时长 ≤ maxTotalDuration 秒（视频模型上限，默认 15,长片段模型 30）。
      // LLM 可能输出超限时长，生成出口统一钳制：按比例压缩（单分镜最低 2 秒）
      shots = this.normalizeShotDurations(
        shots,
        maxTotalDuration,
        ep.title || `片段${index + 1}`,
      );

      // 生成视频提示词（使用替换后的提示词）
      // 注意：prompt 中已包含 {对白内容}，无需再追加 dialogue
      const videoPromptLines = shots.map((s, idx) => {
        return `【分镜${idx + 1} | ${s.duration}s】${translateShotType(s.shotType)}，${translateCameraMovements(s.cameraMovements)}，${translateCameraAngle(s.cameraAngle)}，${translateLighting(s.lighting)}，${translateMood(s.mood)}氛围，${s.prompt}`;
      });

      // 生成原始视频提示词（未替换标记）
      // 注意：rawPrompt 中已包含 {对白内容}，无需再追加 dialogue
      const rawVideoPromptLines = shots.map((s, idx) => {
        return `【分镜${idx + 1} | ${s.duration}s】${translateShotType(s.shotType)}，${translateCameraMovements(s.cameraMovements)}，${translateCameraAngle(s.cameraAngle)}，${translateLighting(s.lighting)}，${translateMood(s.mood)}氛围，${s.rawPrompt || s.prompt}`;
      });

      // 处理首尾帧提示词
      const firstFramePrompt = ep.firstFramePrompt
        ? this.replaceCharacterAndSceneMarkers(
            ep.firstFramePrompt,
            characterMap,
            sceneMap,
          )
        : '';
      const lastFramePrompt = ep.lastFramePrompt
        ? this.replaceCharacterAndSceneMarkers(
            ep.lastFramePrompt,
            characterMap,
            sceneMap,
          )
        : '';
      const firstLastFrameVideoPrompt = ep.firstLastFrameVideoPrompt
        ? this.replaceCharacterAndSceneMarkers(
            ep.firstLastFrameVideoPrompt,
            characterMap,
            sceneMap,
          )
        : '';

      return {
        id: episodeId,
        title: ep.title || `片段${index + 1}：剧情发展`,
        description: ep.description || '暂无描述',
        videoPrompt: videoPromptLines.join('\n\n'),
        rawVideoPrompt: rawVideoPromptLines.join('\n\n'),
        model: videoModels[index % videoModels.length],
        shots: shots,
        firstFramePrompt,
        rawFirstFramePrompt: ep.firstFramePrompt || '',
        lastFramePrompt,
        rawLastFramePrompt: ep.lastFramePrompt || '',
        firstLastFrameVideoPrompt,
        rawFirstLastFrameVideoPrompt: ep.firstLastFrameVideoPrompt || '',
        firstFrameDialogue: ep.firstFrameDialogue || '',
        lastFrameDialogue: ep.lastFrameDialogue || '',
      };
    });
  }

  /**
   * 替换角色和场景标记
   * 将角色名替换为 @<role character-id="xxx">角色名<img src="..." width="15"></role>
   * 将场景名替换为 #<scene scene-id="xxx">场景名<img src="..."></scene>
   * 嵌入 ID 让前端按 ID 关联最新的头像/场景图,避免后续重命名或重新生成时图片丢失
   *
   * 使用占位符保护机制防止已替换的标记被二次匹配（避免嵌套标签）
   */
  private replaceCharacterAndSceneMarkers(
    text: string,
    characterMap: Map<string, CharacterInfo>,
    sceneMap: Map<string, SceneInfo>,
  ): string {
    let result = text;

    // 标记内替换（双保险）：把 【场景:原名】/【角色:原名】 中的原名包裹为带 ID 的图片标签，
    // 让未被前端 convertPromptToHtml 重算的字段（videoPrompt/首尾帧/referencePrompt）
    // 也能按 ID 关联头像/场景图。形象照标记由前端 portraitMap 处理，此处不动。
    const enrichBracketMarker = (bracket: string): string => {
      let enriched = bracket.replace(
        /【场景:([^】]*)】/g,
        (m, name: string) => {
          const scene = sceneMap.get(name) || sceneMap.get(name.trim());
          if (!scene) return m;
          const idAttr = scene.id ? ` scene-id="${scene.id}"` : '';
          return `【场景:#<scene${idAttr}>${name}</scene>】`;
        },
      );
      enriched = enriched.replace(/【角色:([^】（]+)/g, (m, name: string) => {
        const trimmed = name.trim();
        const char = characterMap.get(name) || characterMap.get(trimmed);
        if (!char) return m;
        const idAttr = char.id ? ` character-id="${char.id}"` : '';
        return `【角色:@<role${idAttr}>${trimmed}</role>`;
      });
      return enriched;
    };

    // 保护中文方括号标记（场景/角色/形象照），避免其中的角色名/场景名被误替换
    const protectedBrackets: { placeholder: string; content: string }[] = [];
    let bracketProtectCounter = 0;
    result = result.replace(/【[^】]*】/g, (match) => {
      const placeholder = `__BRACKET_${bracketProtectCounter++}__`;
      protectedBrackets.push({
        placeholder,
        content: enrichBracketMarker(match),
      });
      return placeholder;
    });

    const protectedPlaceholders: { placeholder: string; content: string }[] =
      [];
    let placeholderIndex = 0;

    // 按名称长度降序排序，避免短名称匹配到长名称的一部分
    const sortedCharacters = Array.from(characterMap.values()).sort(
      (a, b) => b.name.length - a.name.length,
    );
    const sortedScenes = Array.from(sceneMap.values()).sort(
      (a, b) => b.name.length - a.name.length,
    );

    // 替换角色名
    for (const char of sortedCharacters) {
      if (!char.name) continue;

      const idAttr = char.id ? ` character-id="${char.id}"` : '';
      const roleMarker = `@<role${idAttr}>${char.name}</role>`;

      const escapedName = char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(
        `(?<!<role>)${escapedName}(?![^<]*<\\/role>)`,
        'g',
      );
      result = result.replace(regex, () => {
        const placeholder = ` ROLE_${placeholderIndex++} `;
        protectedPlaceholders.push({ placeholder, content: roleMarker });
        return placeholder;
      });
    }

    // 替换场景名
    for (const scene of sortedScenes) {
      if (!scene.name) continue;

      const idAttr = scene.id ? ` scene-id="${scene.id}"` : '';
      const sceneMarker = `#<scene${idAttr}>${scene.name}</scene>`;

      const escapedName = scene.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 排除已在 #<scene> 或 @<role> 标记中的场景名
      const regex = new RegExp(
        `(?<!<scene)(?<!<role>)${escapedName}(?![^<]*<\\/scene>)(?![^<]*<\\/role>)`,
        'g',
      );
      result = result.replace(regex, () => {
        const placeholder = ` SCENE_${placeholderIndex++} `;
        protectedPlaceholders.push({ placeholder, content: sceneMarker });
        return placeholder;
      });
    }

    // 场景名别名回退匹配：LLM 常使用简写（如"写字楼旁咖啡厅"简写为"咖啡厅"），
    // 精确匹配失败后，尝试匹配场景名的后缀子串
    const sceneAliases: { scene: (typeof sortedScenes)[0]; alias: string }[] =
      [];
    for (const scene of sortedScenes) {
      if (!scene.name) continue;
      // 含"·"分隔符的场景名：取主体部分作为别名（兼容 LLM 漏写时段后缀，如"·夜"/"·正午"），
      // 避免提示词里场景名被截断显示
      const dotIdx = scene.name.indexOf('·');
      if (dotIdx >= 2) {
        const mainPart = scene.name.slice(0, dotIdx).trim();
        if (mainPart) sceneAliases.push({ scene, alias: mainPart });
      }
      if (scene.name.length >= 5) {
        const alias3 = scene.name.slice(-3);
        // 跳过含"·"的别名，避免"·夜"/"殿·夜"误匹配破坏含"·"的场景名
        if (alias3 && !alias3.includes('·'))
          sceneAliases.push({ scene, alias: alias3 });
      }
      if (scene.name.length >= 4) {
        const alias2 = scene.name.slice(-2);
        if (alias2 && !alias2.includes('·'))
          sceneAliases.push({ scene, alias: alias2 });
      }
    }
    // 按别名长度降序，避免短别名先匹配；同长度按原始名称长度降序
    sceneAliases.sort(
      (a, b) =>
        b.alias.length - a.alias.length ||
        b.scene.name.length - a.scene.name.length,
    );

    if (sceneAliases.length > 0) {
      // 保护已有的完整标签，避免别名在其内部误匹配导致嵌套/损坏；
      // 同时保护 【...】 占位符（__BRACKET_N__），避免别名子串在标记恢复后错位
      // （历史提交 8495a8e/2ca3f26/bb89e42 反复出现的标签错位/残留字符根因）
      const aliasProtectedTags = new Map<string, string>();
      let aliasProtectCounter = 0;
      let aliasProtectedText = result.replace(
        /[@#]<(?:scene|role)(?:\s+[^>]*)?>[\s\S]*?<\/(?:scene|role)>|__BRACKET_\d+__/g,
        (match) => {
          const key = `__ALIAS_PROTECT_${aliasProtectCounter++}__`;
          aliasProtectedTags.set(key, match);
          return key;
        },
      );

      for (const { scene, alias } of sceneAliases) {
        const idAttr = scene.id ? ` scene-id="${scene.id}"` : '';
        const sceneMarker = `#<scene${idAttr}>${scene.name}</scene>`;

        const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedAlias, 'g');
        aliasProtectedText = aliasProtectedText.replace(regex, () => {
          const placeholder = `SCENE_${placeholderIndex++}`;
          protectedPlaceholders.push({ placeholder, content: sceneMarker });
          return placeholder;
        });
      }

      // 恢复被保护的标签
      for (const [key, value] of aliasProtectedTags) {
        aliasProtectedText = aliasProtectedText.replace(key, value);
      }
      result = aliasProtectedText;
    }

    // 恢复被保护的中文方括号标记
    for (const { placeholder, content } of protectedBrackets) {
      result = result.replace(placeholder, () => content);
    }

    // 恢复占位符为实际标记（使用函数形式避免 $ 字符被当作替换模式）
    for (const { placeholder, content } of protectedPlaceholders) {
      result = result.replace(placeholder, () => content);
    }

    return result;
  }

  private parseScriptAnalysisResponse(responseText: string): any {
    try {
      // 尝试提取 JSON（可能包含代码块标记）
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : responseText;

      return JSON.parse(jsonString);
    } catch (error) {
      console.error('[AIModelService] 解析 JSON 失败:', error);
      console.error('原始响应长度:', responseText.length);
      console.error(
        '原始响应末尾100字符:',
        responseText.substring(Math.max(0, responseText.length - 100)),
      );

      // 尝试修复不完整的 JSON
      const repairedJson = tryRepairIncompleteJson(responseText);
      if (repairedJson) {
        try {
          console.log('[AIModelService] 尝试使用修复后的 JSON 解析');
          return JSON.parse(repairedJson);
        } catch (repairError) {
          console.error(
            '[AIModelService] 修复后的 JSON 仍然解析失败:',
            repairError,
          );
        }
      }

      throw new Error(
        `AI 返回的数据格式不正确: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private enrichCharacters(
    characters: any[],
    portraits: any[],
    timestamp: number,
  ): any[] {
    const enriched = characters.map((char, index) => {
      const charPortraits = (portraits || []).filter(
        (p: any) => p.characterName === char.name,
      );
      return {
        id: `char-${timestamp}-${index + 1}`,
        name: char.name || `角色${index + 1}`,
        gender: char.gender || '',
        age: char.age || '',
        description: char.description || '暂无描述',
        imagePrompt:
          char.imagePrompt || `${char.name} 角色形象，高质量角色设计`,
        avatarPrompt: char.avatarPrompt || `${char.name} 面部特写，高质量肖像`,
        voicePrompt: char.voicePrompt || '',
        avatarUrls: [], // 留空，后续由图像服务生成
        fullBodyUrls: [], // 4张全身照URL，每张包含4视角
        fullBodyImages: [
          {
            imageUrl: '',
            isGenerating: false,
            prompt: '',
            name: '人物多视图',
            isPortrait: false,
          },
          ...charPortraits.map((p: any) => ({
            imageUrl: '',
            isGenerating: false,
            prompt: p.prompt || '',
            name: p.name || '',
            isPortrait: true,
          })),
        ],
        model: char.model || 'SDXL',
      };
    });

    // 形象照名全局去重：不同角色的同名形象照会导致前端 @<portrait> 标签解析到错误角色
    // （生产事故：各角色形象照都叫「山林行路照」，全部解析成沙僧的 character-id）。
    // LLM 不遵守命名规则时在分解出口兜底改名：重名追加「（角色名）」后缀
    const usedPortraitNames = new Set<string>();
    for (const char of enriched) {
      for (const img of char.fullBodyImages || []) {
        if (!img?.isPortrait || !img.name) continue;
        let name = img.name;
        if (usedPortraitNames.has(name)) {
          name = `${img.name}（${char.name}）`;
          let n = 2;
          while (usedPortraitNames.has(name)) {
            name = `${img.name}（${char.name}）${n++}`;
          }
          console.warn(
            `[AIModelService] 形象照名重复，已将「${img.name}」重命名为「${name}」（角色：${char.name}）`,
          );
        }
        usedPortraitNames.add(name);
        img.name = name;
      }
    }
    return enriched;
  }

  private generateCharacterFullBody(): string[] {
    // 返回空数组，全身照由用户点击一键生成后填充
    return [];
  }

  private enrichScenes(scenes: any[], timestamp: number): any[] {
    return scenes.map((scene, index) => ({
      id: `scene-${timestamp}-${index + 1}`,
      name: scene.name || `场景${index + 1}`,
      description: scene.description || '暂无描述',
      location: scene.location || '未知地点',
      timeOfDay: scene.timeOfDay || '未知',
      season: scene.season || '未知',
      weather: scene.weather || '晴朗',
      imagePrompt: scene.imagePrompt || `${scene.name} 场景，高质量摄影`,
      imageUrls: [], // 留空，后续由图像服务生成
      model: scene.model || 'SDXL',
    }));
  }

  /**
   * 补全道具字段：剧本分解新增的 props 通道，
   * 旧模板/模型漏出时降级为空数组（向后兼容）
   */
  private enrichProps(props: any[], timestamp: number): any[] {
    return props.map((prop, index) => ({
      id: `prop-${timestamp}-${index + 1}`,
      name: prop.name || `道具${index + 1}`,
      description: prop.description || '暂无描述',
      imagePrompt: prop.imagePrompt || `${prop.name} 道具特写，高质量产品摄影`,
      imageUrls: [], // 留空，后续由图像服务生成
      model: prop.model || 'SDXL',
    }));
  }

  private enrichEra(era: any, timestamp: number): any {
    return {
      id: `era-${timestamp}`,
      name: era.name || '未知时代',
      description: era.description || '暂无描述',
      year: era.year || '未知年代',
      location: era.location || '未知地点',
      socialBackground: era.socialBackground || '暂无社会背景描述',
      culturalFeatures: era.culturalFeatures || '暂无文化特征描述',
      visualStyle: era.visualStyle || '写实风格',
      globalPrompt:
        era.globalPrompt ||
        `${era.name} 故事背景，聚焦于${era.description || '未知主题'}，视觉风格为${era.visualStyle || '写实风格'}`,
      // 场景专用全局风格前缀：只含视觉基调（色调/光影/质感），
      // 禁止混入人物/剧情元素；模型未输出时为空字符串，场景链路此前缀直接省略
      sceneStylePrompt: era.sceneStylePrompt || '',
      model: era.model || 'DALL-E-3',
    };
  }

  private enrichRelationshipNetwork(
    network: any,
    timestamp: number,
    characters: any[],
  ): any {
    const relationships = (network.relationships || []).map(
      (rel: any, index: number) => {
        // 查找对应的角色 ID
        const fromChar = characters.find(
          (c) => c.name === rel.fromCharacterName,
        );
        const toChar = characters.find((c) => c.name === rel.toCharacterName);

        return {
          id: `rel-${timestamp}-${index + 1}`,
          fromCharacterId: fromChar?.id || `char-${timestamp}-1`,
          fromCharacterName: rel.fromCharacterName,
          toCharacterId: toChar?.id || `char-${timestamp}-2`,
          toCharacterName: rel.toCharacterName,
          relationship: rel.relationship || '未知关系',
          description: rel.description || '暂无描述',
          intensity: rel.intensity || 12,
        };
      },
    );

    return {
      id: `network-${timestamp}`,
      name: network.name || '人物关系网',
      description: network.description || '剧本角色之间的关系脉络',
      relationships,
    };
  }

  /**
   * 保存剧本分解响应日志
   */
  private saveScriptAnalysisLog(_response: unknown, _timestamp: number): void {
    // 纯前端版:浏览器无文件系统,不再落盘剧本分解日志(排障走浏览器 DevTools)
  }

}

/** 模块级单例(替代 NestJS DI) */
export const aiModelService = new AIModelService();
