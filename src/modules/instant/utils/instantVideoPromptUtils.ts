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

import type {
  InstantCharacter,
  InstantScene,
} from '@/shared/types/project';
import type { Shot, ModelConfig } from '@/shared/types/index';
import {
  SHOT_TYPES,
  CAMERA_MOVEMENTS,
  CAMERA_ANGLES,
  LIGHTING_TYPES,
  MOOD_TYPES,
} from '@/shared/types/index';

// ============================================================
// 供应商格式化器注册（扩展时在此追加，不硬编码 if/else）
// ============================================================

interface FormatterParams {
  shots: Shot[];
  characters: InstantCharacter[];
  scenes: InstantScene[];
  charIdToFaceImageNum: Map<string, number>;
  charIdToCostumeImageNum: Map<string, number>;
  charIdToAudioNum: Map<string, number>;
  sceneIdToImageNum: Map<string, number>;
  shotFirstFrameMap?: Map<number, number>;
}

type VideoPromptFormatter = (params: FormatterParams) => string;

/** 火山引擎格式化器 */
function formatVolcengine(params: FormatterParams): string {
  const {
    shots, characters, scenes,
    charIdToFaceImageNum, charIdToCostumeImageNum,
    charIdToAudioNum, sceneIdToImageNum, shotFirstFrameMap,
  } = params;

  const prefixLines: string[] = [];

  for (const [charId, faceNum] of charIdToFaceImageNum) {
    const char = characters.find((c) => c.id === charId);
    if (!char) continue;
    const costumeNum = charIdToCostumeImageNum.get(charId);
    const audioNum = charIdToAudioNum.get(charId);
    const genderLabel = char.gender?.includes('女') ? '女' : char.gender?.includes('男') ? '男' : '';
    let line = `- ${char.name}`;
    if (genderLabel) line += `（${genderLabel}）`;
    line += '：';
    const parts: string[] = [];
    if (faceNum) parts.push(`专属面部五官长相全程锁定完美复刻 [图${faceNum}]，绝对不能改动`);
    if (costumeNum) parts.push(`穿衣穿搭造型、装束样式严格遵守 [图${costumeNum}]`);
    if (audioNum) parts.push(`发音音色必须严格参考 [音频${audioNum}]`);
    if (parts.length > 0) { line += parts.join('；') + '。'; prefixLines.push(line); }
  }

  for (const [sceneId, imgNum] of sceneIdToImageNum) {
    const scene = scenes.find((s) => s.id === sceneId);
    if (!scene) continue;
    prefixLines.push(`- 场景：参考 [图${imgNum}]（${scene.name}），图片仅做风格参考，实际场景要按剧情描述和需要进行调整`);
  }

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

    const st = SHOT_TYPES.find((s) => s.id === shot.shotType);
    if (st) parts.push(st.name);

    if (shot.cameraMovements?.length > 0) {
      const movements = shot.cameraMovements.map((m) => (CAMERA_MOVEMENTS.find((c) => c.id === m)?.name || m)).join('、');
      parts.push(movements + '运镜');
    }

    const ai = CAMERA_ANGLES.find((a) => a.id === shot.cameraAngle);
    if (ai) parts.push(ai.name + '视角');
    const li = LIGHTING_TYPES.find((l) => l.id === shot.lighting);
    if (li) parts.push(li.name + '光线');
    const mi = MOOD_TYPES.find((m) => m.id === shot.mood);
    if (mi) parts.push(mi.name + '氛围');

    const sp = (shot.prompt || '')
      .replace(/@<role(?:\s+[^>]*)?>([^<]*)<\/role>/g, '$1')
      .replace(/[#@]<scene(?:\s+[^>]*)?>([^<]*)<\/scene>/g, '$1')
      .replace(/<img[^>]*>/g, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/\[ref:\w+:\d+\]/g, '')
      .replace(/\s+/g, ' ').trim();
    if (sp) parts.push(sp);

    const ffn = shotFirstFrameMap?.get(i);
    if (ffn) parts.unshift(`文字首帧为图片${ffn}`);

    timelineLines.push(`${startTime}-${endTime}秒：${parts.join('，')}`);
  }

  return [...prefixLines, ...timelineLines].join('\n');
}

const FORMATTERS: Record<string, VideoPromptFormatter> = { volcengine: formatVolcengine };

function getFormatter(provider: string): VideoPromptFormatter | undefined {
  return FORMATTERS[provider];
}

// ============================================================
// 全能参考生成请求构建
// ============================================================

export interface UniversalReferenceResult {
  processedPrompt: string;
  referenceImages: string[];
  referenceAudios: string[];
  referenceAudioMap: Record<string, string>;
  referenceModel: string;
  originalModel: string;
  totalDuration: number;
  firstShotReferenceImageUrl: string | undefined;
  lastShotReferenceImageUrl: string | undefined;
}

export function buildUniversalReferenceRequest(params: {
  shots: Shot[];
  videoPrompt: string;
  characters: InstantCharacter[];
  scenes: InstantScene[];
  model: string;
  videoModels: ModelConfig[];
}): UniversalReferenceResult {
  const { shots, videoPrompt, characters, scenes, model, videoModels } = params;

  const imageUrls: string[] = [];
  const urlToIndex = new Map<string, number>();
  const addImageUrl = (url: string): number => {
    if (!urlToIndex.has(url)) { urlToIndex.set(url, imageUrls.length); imageUrls.push(url); }
    return urlToIndex.get(url)! + 1;
  };

  const charIdToFaceImageNum = new Map<string, number>();
  const charIdToCostumeImageNum = new Map<string, number>();
  const charIdToPortraitCostumeUrl = new Map<string, string>();
  const sceneIdToImageNum = new Map<string, number>();
  const charIdToAudioNum = new Map<string, number>();
  const referenceAudios: string[] = [];
  const referenceAudioMap: Record<string, string> = {};

  const addCharImages = (charId: string) => {
    if (charIdToFaceImageNum.has(charId) || charIdToCostumeImageNum.has(charId)) return;
    const char = characters.find((c) => c.id === charId);
    if (!char) return;
    const avatarUrl = char.avatarImages?.[0]?.imageUrl || char.avatar || '';
    // 如果提示词中有该角色的形象照，用形象照作为装束参照，否则用多视图
    const portraitUrl = charIdToPortraitCostumeUrl.get(charId);
    const fullBodyUrl = portraitUrl || char.fullBodyImages?.[0]?.imageUrl || '';
    console.log('形象图参考 [instant addCharImages]', { charId, charName: char.name, portraitUrl, fullBodyUrl, hasPortrait: !!portraitUrl, portraitUrlsLen: char.portraitImages?.length });
    let faceNum: number | undefined;
    let costumeNum: number | undefined;
    if (avatarUrl) faceNum = addImageUrl(avatarUrl);
    if (fullBodyUrl && fullBodyUrl !== avatarUrl) costumeNum = addImageUrl(fullBodyUrl);
    else if (avatarUrl) costumeNum = faceNum;
    if (faceNum !== undefined) charIdToFaceImageNum.set(charId, faceNum);
    if (costumeNum !== undefined) charIdToCostumeImageNum.set(charId, costumeNum);

  };

  // 对于有形象照的角色，以分镜提示词中实际标注的形象照作为装束参照：
  // 1. @<portrait character-id="..." portrait-index="N"> 标签（AI 按场景选定的）
  // 2. 纯文本形象照名（如 "姓名（39岁，生活常规照）"）
  // 3. 兜底：第一张形象照
  console.log('形象图参考 [instant 预扫描]', { charactersCount: characters.length, charsWithPortraits: characters.filter(c => c.portraitImages && c.portraitImages.length > 0).map(c => ({ id: c.id, name: c.name, count: c.portraitImages?.length })) });
  const resolveReferencedPortrait = (char: InstantCharacter): string => {
    const portraits = char.portraitImages || [];
    if (portraits.length === 0) return '';
    for (const shot of shots) {
      const prompt = shot.prompt || '';
      // 标签形式：@<portrait character-id="X" portrait-index="N">
      for (const m of prompt.matchAll(/@<portrait\s+[^>]*character-id="([^"]+)"[^>]*>/g)) {
        if (m[1] !== char.id) continue;
        const idxM = m[0].match(/portrait-index="(\d+)"/);
        const idx = idxM ? parseInt(idxM[1], 10) : 0;
        const url = portraits[idx]?.imageUrl;
        if (url) return url;
      }
      // 纯文本形式：形象照名出现在该角色的括号标注中
      for (const p of portraits) {
        if (p?.name && p.imageUrl && prompt.includes(p.name)) return p.imageUrl;
      }
    }
    return portraits[0]?.imageUrl || '';
  };
  for (const char of characters) {
    if (char.portraitImages && char.portraitImages.length > 0) {
      const url = resolveReferencedPortrait(char);
      charIdToPortraitCostumeUrl.set(char.id, url);
      console.log('形象图参考 [instant 使用形象照]', { charId: char.id, charName: char.name, portraitUrl: url });
    }
  }

  // 遍历分镜收集所有引用
  if (shots.length > 0) {
    shots.forEach((shot) => {
      for (const m of shot.prompt.matchAll(/@<role\s+character-id="([^"]+)">/g)) addCharImages(m[1]);
      for (const m of shot.prompt.matchAll(/@<role>([^<]*?)<img[^>]*><\/role>/g)) {
        const char = characters.find((c) => c.name === m[1].trim());
        if (char) addCharImages(char.id);
      }
      for (const m of shot.prompt.matchAll(/@<role>([^<]*?)<\/role>/g)) {
        const char = characters.find((c) => c.name === m[1].trim());
        if (char) addCharImages(char.id);
      }
      for (const char of [...characters].sort((a, b) => b.name.length - a.name.length)) {
        if (charIdToFaceImageNum.has(char.id) || charIdToCostumeImageNum.has(char.id)) continue;
        const re = new RegExp(`@${char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^<]*>)`, 'g');
        if (re.test(shot.prompt)) addCharImages(char.id);
      }
      for (const m of shot.prompt.matchAll(/#<scene\s+scene-id="([^"]+)">/g)) {
        const sId = m[1];
        if (sceneIdToImageNum.has(sId)) continue;
        const scene = scenes.find((s) => s.id === sId);
        const img = scene?.imageUrls?.[0] || scene?.imageUrl;
        if (img) sceneIdToImageNum.set(sId, addImageUrl(img));
      }
      for (const m of shot.prompt.matchAll(/#<scene>([^<]*?)<img[^>]*><\/scene>/g)) {
        const scene = scenes.find((s) => s.name === m[1].trim());
        if (scene && !sceneIdToImageNum.has(scene.id)) {
          const img = scene.imageUrls?.[0] || scene.imageUrl;
          if (img) sceneIdToImageNum.set(scene.id, addImageUrl(img));
        }
      }
      for (const m of shot.prompt.matchAll(/[@#]<scene>([^<]*?)<\/scene>/g)) {
        const scene = scenes.find((s) => s.name === m[1].trim());
        if (scene && !sceneIdToImageNum.has(scene.id)) {
          const img = scene.imageUrls?.[0] || scene.imageUrl;
          if (img) sceneIdToImageNum.set(scene.id, addImageUrl(img));
        }
      }
      for (const scene of [...scenes].sort((a, b) => b.name.length - a.name.length)) {
        if (sceneIdToImageNum.has(scene.id)) continue;
        const re = new RegExp(`[@#]${scene.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^<]*>)`, 'g');
        if (re.test(shot.prompt)) {
          const img = scene.imageUrls?.[0] || scene.imageUrl;
          if (img) sceneIdToImageNum.set(scene.id, addImageUrl(img));
        }
      }
      if (shot.referenceImageUrl && (shot as any).useReferenceAsFirstFrame) {
        addImageUrl(shot.referenceImageUrl);
      }
    });
  }

  const firstShotReferenceImageUrl = shots[0]?.referenceImageUrl;
  const lastShotReferenceImageUrl = shots[shots.length - 1]?.referenceImageUrl;

  const shotFirstFrameMap = new Map<number, number>();
  shots.forEach((shot, idx) => {
    if ((shot as any).useReferenceAsFirstFrame && shot.referenceImageUrl) {
      shotFirstFrameMap.set(idx, addImageUrl(shot.referenceImageUrl));
    }
  });

  const buildCharRef = (charId: string, name: string, parenContent?: string): string => {
    const faceNum = charIdToFaceImageNum.get(charId);
    const costumeNum = charIdToCostumeImageNum.get(charId);
    const parts: string[] = [];
    if (parenContent) parts.push(parenContent);
    if (faceNum) parts.push(`[ref:face:${faceNum}]`);
    if (costumeNum && costumeNum !== faceNum) parts.push(`[ref:costume:${costumeNum}]`);
    const char = characters.find((c) => c.id === charId);
    if ((char as any).voicePrompt) {
      let vd = (char as any).voicePrompt as string;
      const an = charIdToAudioNum.get(charId);
      if (an) vd += `，[ref:audio:${an}]`;
      parts.push(vd);
    }
    return `${name}（${parts.join('，')}）`;
  };

  let processedPrompt = videoPrompt || '';
  if (processedPrompt) {
    processedPrompt = processedPrompt
      .replace(/@<role\s+character-id="([^"]+)">([^<]*)<img[^>]*><\/role>(?:（([^）]*)）)?/g,
        (_m, cid, name, pc) => buildCharRef(cid, name, pc))
      .replace(/#<scene\s+scene-id="([^"]+)">([^<]*)<img[^>]*><\/scene>/g,
        (_m, sid, name) => { const n = sceneIdToImageNum.get(sid); return n ? `[ref:scene:${n}]${name}` : name; })
      .replace(/@<role\s+character-id="([^"]+)">([^<]*)<\/role>(?:（([^）]*)）)?/g,
        (_m, cid, name, pc) => buildCharRef(cid, name, pc))
      .replace(/#<scene\s+scene-id="([^"]+)">([^<]*)<\/scene>/g,
        (_m, sid, name) => { const n = sceneIdToImageNum.get(sid); return n ? `[ref:scene:${n}]${name}` : name; })
      .replace(/@<role>([^<]*)<img[^>]*><\/role>(?:（([^）]*)）)?/g, (_m, name, pc) => {
        const ch = characters.find((c) => c.name === name.trim());
        return ch ? buildCharRef(ch.id, name.trim(), pc) : (pc ? `${name.trim()}（${pc}）` : name.trim());
      })
      .replace(/@<role>([^<]*)<\/role>(?:（([^）]*)）)?/g, (_m, name, pc) => {
        const ch = characters.find((c) => c.name === name.trim());
        return ch ? buildCharRef(ch.id, name.trim(), pc) : (pc ? `${name.trim()}（${pc}）` : name.trim());
      })
      .replace(/[@#]<scene>([^<]*)<img[^>]*><\/scene>/g, (_m, name) => {
        const sc = scenes.find((s) => s.name === name.trim());
        const n = sc ? sceneIdToImageNum.get(sc.id) : undefined;
        return n ? `[ref:scene:${n}]${name.trim()}` : name.trim();
      })
      .replace(/[@#]<scene>([^<]*)<\/scene>/g, (_m, name) => {
        const sc = scenes.find((s) => s.name === name.trim());
        const n = sc ? sceneIdToImageNum.get(sc.id) : undefined;
        return n ? `[ref:scene:${n}]${name.trim()}` : name.trim();
      });

    for (const e of characters.filter((c) => charIdToFaceImageNum.has(c.id) || charIdToCostumeImageNum.has(c.id))
      .map((c) => ({ cid: c.id, name: c.name })).sort((a, b) => b.name.length - a.name.length)) {
      const re = new RegExp(`@${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:（([^）]*)）)?`, 'g');
      processedPrompt = processedPrompt.replace(re, (_m, pc) => buildCharRef(e.cid, e.name, pc));
    }
    for (const e of scenes.filter((s) => sceneIdToImageNum.has(s.id))
      .map((s) => ({ name: s.name, n: sceneIdToImageNum.get(s.id)! })).sort((a, b) => b.name.length - a.name.length)) {
      processedPrompt = processedPrompt.replace(new RegExp(`[@#]${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
        `[ref:scene:${e.n}]${e.name}`);
    }

    processedPrompt = processedPrompt
      .replace(/@<portrait\s+[^>]*>([^<]*)(?:<img[^>]*>)?<\/portrait>/g, '$1')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .trim();
  }

  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  const curCfg = videoModels.find((m) => m.id === model);
  let refModel = model || videoModels.find((m) => m.type === 'video')?.id || '';
  if (!curCfg?.supports?.reference_image) {
    const fb = videoModels.find((m) => m.supports?.reference_image);
    refModel = fb?.id || refModel;
  }
  const effCfg = videoModels.find((m) => m.id === (refModel || model || ''));
  const fmtr = getFormatter(effCfg?.provider || '');

  if (fmtr) {
    return {
      processedPrompt: fmtr({ shots, characters, scenes, charIdToFaceImageNum, charIdToCostumeImageNum, charIdToAudioNum, sceneIdToImageNum, shotFirstFrameMap }),
      referenceImages: imageUrls, referenceAudios, referenceAudioMap,
      referenceModel: refModel, originalModel: model || '',
      totalDuration, firstShotReferenceImageUrl, lastShotReferenceImageUrl,
    };
  }

  return {
    processedPrompt, referenceImages: imageUrls, referenceAudios, referenceAudioMap,
    referenceModel: refModel, originalModel: model || '',
    totalDuration, firstShotReferenceImageUrl, lastShotReferenceImageUrl,
  };
}

// ============================================================
// 首尾帧生成：清理 HTML 标签和图片占位符
// ============================================================

export function stripFirstLastFramePrompt(raw: string): string {
  return raw
    .replace(/@<role\s+character-id="[^"]+">([^<]*)<img[^>]*><\/role>/g, '$1')
    .replace(/@<role\s+character-id="[^"]+">([^<]*)<\/role>/g, '$1')
    .replace(/#<scene\s+scene-id="[^"]+">([^<]*)<img[^>]*><\/scene>/g, '$1')
    .replace(/#<scene\s+scene-id="[^"]+">([^<]*)<\/scene>/g, '$1')
    .replace(/<img[^>]*>/g, '')
    .replace(/\[图\d+\]/g, '')
    .replace(/\s+/g, ' ').trim();
}
