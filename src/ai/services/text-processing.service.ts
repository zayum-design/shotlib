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
 * 文本处理服务(纯前端简化版)
 *
 * 对齐后端 shared/processing/text/text-processing.service.ts 的 GENERATION 用法:
 * 小型文本生成(提示词润色/灵感生成等),编排层直接调用,无队列无积分。
 */
import { modelSDK } from './model-sdk';
import { promptLoader } from '@/ai/prompts/prompt-loader';

export interface TextGenerationRequest {
  modelId: string;
  input: string;
  systemPrompt?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
}

/**
 * 生成文本:成功返回正文,失败抛错(调用方自行兜底)
 */
export async function generateText(request: TextGenerationRequest): Promise<string> {
  const response = await modelSDK.process({
    modelId: request.modelId,
    taskType: 'text',
    operation: 'generate',
    input: { text: request.input },
    systemPrompt: request.systemPrompt,
    parameters: {
      temperature: 0.7,
      maxTokens: 2000,
      ...request.parameters,
    },
  });
  if (!response.success) {
    throw new Error(response.error?.message || '文本生成失败');
  }
  const content = (response.data as { content?: string }).content || '';
  if (!content.trim()) {
    throw new Error('模型返回内容为空，请重试或切换其他模型');
  }
  return content;
}

/**
 * 生成文本并清理输出(去引号/换行/压缩空白)
 * 对齐后端 scene-presets.controller.generatePromptText 的后处理
 */
export async function generateCleanText(request: TextGenerationRequest): Promise<string> {
  const text = await generateText(request);
  return text
    .replace(/[“”‘’「」『』"]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ProcessByPromptTypeRequest {
  modelId: string;
  /** 提示词模板类型(如 drama/scene-shots-generation),模板内容作为 systemPrompt */
  promptType: string;
  input: string;
  parameters?: Record<string, unknown>;
}

export interface TextProcessingResponse {
  text: string;
  modelId: string;
  type: string;
  processingTime: number;
  metadata?: Record<string, any>;
}

/**
 * 按提示词类型处理文本:加载模板作为 systemPrompt 后调模型
 * 对齐后端 text-processing.service.process(开源版恒同步,无 preview/async 分支)
 */
export async function processTextByPromptType(request: ProcessByPromptTypeRequest): Promise<TextProcessingResponse> {
  const systemPrompt = promptLoader.loadPromptTemplate(request.modelId, request.promptType);
  if (!systemPrompt) {
    throw new Error(`提示词模板加载失败: ${request.promptType}`);
  }
  const startTime = Date.now();
  const response = await modelSDK.process({
    modelId: request.modelId,
    taskType: 'text',
    operation: 'generate',
    input: { text: request.input },
    systemPrompt,
    parameters: request.parameters,
  });
  if (!response.success) {
    throw new Error(response.error?.message || '文本处理失败');
  }
  return {
    text: (response.data as { content?: string }).content || '',
    modelId: response.metadata.modelId,
    type: 'generation',
    processingTime: response.metadata.processingTime ?? Date.now() - startTime,
    metadata: { tokens: response.metadata.tokens },
  };
}
