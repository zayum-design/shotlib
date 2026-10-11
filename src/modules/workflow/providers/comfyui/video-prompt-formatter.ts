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
 * ComfyUI(MiniMax H3) 视频生成提示词格式化器
 *
 * MiniMax H3 的全能参考生视频(r2v)节点用尖括号标签引用参考素材:
 * - <Picture N>:引用第 N 张参考图(1-based,对应 ref_images 数组顺序)
 * - <Subject N>:从参考图中复用的可见主体(角色)
 *
 * 必须用 subject 定义明确「某角色的脸/穿着来自哪张 <Picture>」,否则模型
 * 会把参考图当风格参考而非身份参考,导致人脸/服装随机。
 *
 * 结构:
 * 1. 角色 subject 定义(脸来自 <Picture face>,穿着来自 <Picture portrait>)
 * 2. 场景参考定义
 * 3. 分镜时间线(镜头参数 + 动作 + 台词,角色用 <Subject N> 引用)
 */
export function formatComfyUIVideoPrompt(
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
  // 角色 → subject 编号(1-based,按 face 参考图遍历顺序)
  const charIdToSubjectNum = new Map<string, number>();
  let subjectIdx = 0;
  for (const charId of charIdToFaceImageNum.keys()) {
    subjectIdx++;
    charIdToSubjectNum.set(charId, subjectIdx);
  }

  const prefixLines: string[] = [];
  prefixLines.push('【角色与场景参考定义】');

  // 角色 subject 定义:明确脸/穿着来自哪张 <Picture>
  for (const [charId, faceNum] of charIdToFaceImageNum) {
    const char = characters.find((c) => c.id === charId);
    if (!char) continue;
    const subjectNum = charIdToSubjectNum.get(charId);
    const portraitNum = charIdToPortraitImageNum?.get(charId);
    const costumeNum = charIdToCostumeImageNum.get(charId);
    const audioNum = charIdToAudioNum.get(charId);

    const parts: string[] = [];
    if (faceNum) {
      parts.push(`脸部完全来自 <Picture ${faceNum}>,五官长相与之一致,不得改动`);
    }
    if (portraitNum) {
      parts.push(
        `穿着完全来自 <Picture ${portraitNum}>,服装款式、颜色、材质与之一致,不得随机生成`,
      );
    } else if (costumeNum) {
      parts.push(
        `穿着完全来自 <Picture ${costumeNum}>,服装款式、颜色、材质与之一致,不得随机生成`,
      );
    }
    if (audioNum !== undefined) {
      parts.push(`发音音色严格参考 <Audio ${audioNum}>`);
    }
    if (char?.voicePrompt) {
      parts.push(char.voicePrompt.replace(/。+\s*$/, ''));
    }

    const subjectTag = subjectNum ? `<Subject ${subjectNum}> ` : '';
    if (parts.length > 0) {
      prefixLines.push(`- ${subjectTag}是角色"${char.name}"，${parts.join('；')}。`);
    }
  }

  // 场景参考定义:仅作风格参考
  for (const [sceneId, imgNum] of sceneIdToImageNum) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) continue;
    prefixLines.push(
      `- 场景"${scene.name}"参考 <Picture ${imgNum}>,图片仅作风格参考,实际画面按剧情描述与需要进行调整`,
    );
  }

  // 分镜时间线
  const timelineLines: string[] = [];
  if (prefixLines.length > 0) timelineLines.push('');
  timelineLines.push('【分镜时间线】');

  let currentTime = 0;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const startTime = currentTime;
    const endTime = currentTime + shot.duration;
    currentTime = endTime;

    const parts: string[] = [];

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

    // 简化为纯文本:角色标签替换为 <Subject N>(有 subject 定义时),场景/形象照标签还原为名字;
    // 去掉 [ref:*] 标签(其语义已由上方 subject/场景定义承载)
    let simplifiedPrompt = shot.prompt || '';
    simplifiedPrompt = simplifiedPrompt
      .replace(/@<role\s+character-id="([^"]+)">([^<]*)<\/role>/g, (_m, charId: string, name: string) => {
        const subjectNum = charIdToSubjectNum.get(charId);
        return subjectNum ? `<Subject ${subjectNum}>` : name.trim();
      })
      .replace(/@<role(?:\s+[^>]*)?>([^<]*)<\/role>/g, '$1')
      .replace(/[#@]<scene(?:\s+[^>]*)?>([^<]*)<\/scene>/g, '$1')
      .replace(/@<portrait\s+[^>]*character-id="[^"]+"[^>]*>([^<]*)<\/portrait>/g, '$1')
      .replace(/!<ref(?:\s+[^>]*)?>([^<]*)<\/ref>/g, '$1')
      .replace(/<img[^>]*>/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\[ref:\w+:\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (simplifiedPrompt) parts.push(simplifiedPrompt);

    const firstFrameNum = shotFirstFrameMap?.get(i);
    if (firstFrameNum) {
      parts.unshift(`文字首帧为图片${firstFrameNum}`);
    }

    timelineLines.push(`${startTime}-${endTime}秒：${parts.join('，')}`);
  }

  return [...prefixLines, ...timelineLines].join('\n');
}
