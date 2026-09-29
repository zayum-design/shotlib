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

import {
  SHOT_TYPES,
  CAMERA_MOVEMENTS,
  CAMERA_ANGLES,
  LIGHTING_TYPES,
  MOOD_TYPES,
} from '@/shared/types/index';
import type { Character, Scene, Shot } from '@/shared/types/index';

/**
 * 火山引擎视频生成提示词格式化器
 *
 * 将通用分镜数据格式化为火山引擎要求的专用格式：
 * 1. 前缀部分：角色/场景参考声明（[图N] / [音频N]）
 * 2. 分镜时间线：0-5秒：镜头参数 + 人物动作 + 对话
 */
export function formatVolcengineVideoPrompt(
  shots: Shot[],
  characters: Character[],
  scenes: Scene[],
  charIdToFaceImageNum: Map<string, number>,
  charIdToCostumeImageNum: Map<string, number>,
  charIdToAudioNum: Map<string, number>,
  sceneIdToImageNum: Map<string, number>,
  shotFirstFrameMap?: Map<number, number>,
  charIdToPortraitImageNum?: Map<string, number>,
): string {
  const prefixLines: string[] = [];

  // 角色前缀
  for (const [charId, faceNum] of charIdToFaceImageNum) {
    const char = characters.find((c) => c.id === charId);
    if (!char) continue;
    const costumeNum = charIdToCostumeImageNum.get(charId);
    const audioNum = charIdToAudioNum.get(charId);

    const gender = char.gender || '';
    const genderLabel = gender.includes('女')
      ? '女'
      : gender.includes('男')
        ? '男'
        : '';

    let line = `- ${char.name}`;
    if (genderLabel) line += `（${genderLabel}）`;
    line += '：';

    const portraitNum = charIdToPortraitImageNum?.get(charId);
    const parts: string[] = [];
    if (faceNum) {
      parts.push(`专属面部五官长相全程锁定完美复刻 [图${faceNum}]，绝对不能改动`);
    }
    // 优先使用形象照作为装束参考，其次使用多视图
    if (portraitNum) {
      parts.push(`穿衣穿搭造型、装束样式严格遵守 [图${portraitNum}]`);
    } else if (costumeNum) {
      parts.push(`穿衣穿搭造型、装束样式严格遵守 [图${costumeNum}]`);
    }
    if (audioNum) {
      parts.push(`发音音色必须严格参考 [音频${audioNum}]`);
    }
    // 角色音色提示词（step3 角色设置中的声音描述，用于情感/语气微调）。
    // 只要 voicePrompt 存在就输出——它是纯文本描述，不依赖音色选择，
    // 与 buildCharRef（非 formatter 路径）的行为保持一致；去掉尾部句号避免与前缀行结尾的「。」重复
    if (char?.voicePrompt) {
      parts.push(char.voicePrompt.replace(/。+\s*$/, ''));
    }

    if (parts.length > 0) {
      line += parts.join('；') + '。';
      prefixLines.push(line);
    }
  }

  // 场景前缀
  for (const [sceneId, imgNum] of sceneIdToImageNum) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) continue;
    prefixLines.push(
      `- 场景：参考 [图${imgNum}]（${scene.name}），图片仅做风格参考，实际场景要按剧情描述和需要进行调整`,
    );
  }

  // 分镜时间线
  const timelineLines: string[] = [];
  if (prefixLines.length > 0) {
    timelineLines.push('');
  }
  timelineLines.push('【分镜时间线】');

  let currentTime = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const startTime = currentTime;
    const endTime = currentTime + shot.duration;
    currentTime = endTime;

    const parts: string[] = [];

    // 镜头参数
    const shotTypeInfo = SHOT_TYPES.find((s) => s.id === shot.shotType);
    if (shotTypeInfo) parts.push(shotTypeInfo.name);

    if (shot.cameraMovements?.length > 0) {
      const movements = shot.cameraMovements
        .map((m) => {
          const info = CAMERA_MOVEMENTS.find((c) => c.id === m);
          return info ? info.name : m;
        })
        .join('、');
      parts.push(movements + '运镜');
    }

    const angleInfo = CAMERA_ANGLES.find((a) => a.id === shot.cameraAngle);
    if (angleInfo) parts.push(angleInfo.name + '视角');

    const lightingInfo = LIGHTING_TYPES.find((l) => l.id === shot.lighting);
    if (lightingInfo) parts.push(lightingInfo.name + '光线');

    const moodInfo = MOOD_TYPES.find((m) => m.id === shot.mood);
    if (moodInfo) parts.push(moodInfo.name + '氛围');

    // 简化 prompt：去掉所有标签和占位符，只保留纯文本
    let simplifiedPrompt = shot.prompt || '';
    simplifiedPrompt = simplifiedPrompt
      .replace(/@<role(?:\s+[^>]*)?>([^<]*)<\/role>/g, '$1')
      .replace(/[#@]<scene(?:\s+[^>]*)?>([^<]*)<\/scene>/g, '$1')
      // 形象照：所属角色已有面部前缀行（含装束参照）时仅保留名字，避免重复；
      // 否则（形象照挂在未出镜角色下）在时间线内联补充装束参照，保证装束提示不丢失
      .replace(/@<portrait\s+[^>]*character-id="([^"]+)"[^>]*>([^<]*)<\/portrait>/g, (_m, charId: string, name: string) => {
        const num = charIdToPortraitImageNum?.get(charId);
        if (num && !charIdToFaceImageNum.has(charId)) {
          return `${name.trim()}，穿衣穿搭造型、装束样式严格遵守 [图${num}]`;
        }
        return name;
      })
      .replace(/!<ref(?:\s+[^>]*)?>([^<]*)<\/ref>/g, '$1')
      .replace(/<img[^>]*>/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\[ref:\w+:\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (simplifiedPrompt) parts.push(simplifiedPrompt);

    // 普通分镜（shot.referenceImageUrl 勾选了"作为分镜首帧图"）：动态插入「文字首帧为图片x」。
    // 衍生片段的衍生场景不记录 shotFirstFrameMap（firstFrameNum 为 undefined），
    // 其「首帧使用片段N视频尾帧参照图片1」文字已在 prompt 的衍生场景标签内文本中，不重复添加。
    const firstFrameNum = shotFirstFrameMap?.get(i);
    if (firstFrameNum) {
      parts.unshift(`文字首帧为图片${firstFrameNum}`);
    }

    timelineLines.push(`${startTime}-${endTime}秒：${parts.join('，')}`);
  }

  return [...prefixLines, ...timelineLines].join('\n');
}

