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

import { formatVolcengineVideoPrompt } from './volcengine/video-prompt-formatter';
import type { Character, Scene, Shot } from '@/shared/types/index';

type VideoPromptFormatter = (
  shots: Shot[],
  characters: Character[],
  scenes: Scene[],
  charIdToFaceImageNum: Map<string, number>,
  charIdToCostumeImageNum: Map<string, number>,
  charIdToAudioNum: Map<string, number>,
  sceneIdToImageNum: Map<string, number>,
  shotFirstFrameMap?: Map<number, number>,
  charIdToPortraitImageNum?: Map<string, number>,
) => string;

/**
 * 供应商标识 → 视频提示词格式化器
 * 新增供应商时在此注册即可，无需修改调用方
 */
const FORMATTERS: Record<string, VideoPromptFormatter> = {
  volcengine: formatVolcengineVideoPrompt,
};

/**
 * 根据供应商标识获取对应的视频提示词格式化器
 * @param provider 供应商标识（如 volcengine、aliyun）
 * @returns 格式化器函数，若未注册则返回 undefined
 */
export function getVideoPromptFormatter(
  provider: string,
): VideoPromptFormatter | undefined {
  return FORMATTERS[provider];
}
