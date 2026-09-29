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
import { promptLoader } from '@/ai/prompts/prompt-loader';
import type { LyricsGenerationOptions } from './ai-model.dto';

/**
 * 歌词生成服务：用模型 SDK + 提示词加载器生成歌词(纯前端版,无 DI,直接引用单例)
 */
export class LyricsGenerationService {
  private readonly modelSDK = modelSDK;
  private readonly promptLoader = promptLoader;

  async generateLyrics(
    modelId: string,
    options: LyricsGenerationOptions,
  ): Promise<string> {
    console.log(
      `[LyricsGenerationService] 使用模型 ${modelId} 生成歌词，描述: ${options.prompt}`,
    );

    try {
      const systemPrompt = this.buildLyricsGenerationPrompt(modelId, options);

      const response = await this.modelSDK.process({
        modelId,
        taskType: 'text',
        operation: 'generate',
        input: { text: options.prompt },
        systemPrompt,
        parameters: {
          temperature: 0.8,
          maxTokens: 2000,
        },
      });

      if (!response.success) {
        throw new Error(response.error?.message || '生成歌词失败');
      }

      return response.data.content || '';
    } catch (error) {
      console.error(`[LyricsGenerationService] 生成歌词失败:`, error);
      throw new Error(
        `生成歌词失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildLyricsGenerationPrompt(
    modelId: string,
    options: LyricsGenerationOptions,
  ): string {
    const { prompt, style, mood } = options;

    const template = this.promptLoader.loadPromptTemplate(
      modelId,
      'music/lyrics-generation',
    );

    return this.promptLoader.renderTemplate(template, {
      prompt,
      style: style || '',
      mood: mood || '',
    });
  }
}

/** 模块级单例(替代 NestJS DI) */
export const lyricsGenerator = new LyricsGenerationService();
