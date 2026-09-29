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

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { InstantCharacter, InstantScene, InstantSegment } from '@/shared/types/project';

export type ProjectAssetType = 'image' | 'video' | 'audio';

export interface ProjectAsset {
  url: string;
  name: string;
  type: ProjectAssetType;
  source: string; // 来源描述（角色头像/场景图/生成视频/首帧/尾帧/分镜参考图/参考附件）
}

export interface ProjectAssetsGroup {
  image: ProjectAsset[];
  video: ProjectAsset[];
  audio: ProjectAsset[];
}

/**
 * 从当前项目数据（角色/场景/片段）收集所有媒体资产，按 url 去重，按类型分组。
 * 用于「项目资产库」抽屉展示。
 */
export function collectProjectAssets(input: {
  characters: InstantCharacter[];
  scenes: InstantScene[];
  segments: InstantSegment[];
}): ProjectAssetsGroup {
  const { characters, scenes, segments } = input;
  const seen = new Set<string>();
  const image: ProjectAsset[] = [];
  const video: ProjectAsset[] = [];
  const audio: ProjectAsset[] = [];

  const add = (type: ProjectAssetType, url: string | undefined, name: string, source: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    (type === 'image' ? image : type === 'video' ? video : audio).push({ url, name, type, source });
  };

  // ===== 角色图片 =====
  characters.forEach((c) => {
    const base = c.name ? `${c.name}` : '角色';
    add('image', c.avatar, `${base}-头像`, '角色头像');
    c.avatarImages?.forEach((img, i) => add('image', img.imageUrl, `${base}-头像${i + 1}`, '角色头像'));
    c.portraitImages?.forEach((img, i) => add('image', img.imageUrl, `${base}-形象照${i + 1}`, '形象照'));
    c.fullBodyImages?.forEach((img, i) => add('image', img.imageUrl, `${base}-全身照${i + 1}`, '全身照'));
    // multiViewImages 运行时可能存在（InstantCharacter 类型未声明但数据可能携带）
    (c as any).multiViewImages?.forEach((img: any, i: number) =>
      add('image', img.imageUrl, `${base}-多视图${i + 1}`, '多视图'),
    );
  });

  // ===== 场景图片 =====
  scenes.forEach((s) => {
    add('image', s.imageUrl, `${s.name}-场景图`, '场景图');
    s.imageUrls?.forEach((u, i) => add('image', u, `${s.name}-场景图${i + 1}`, '场景图'));
  });

  // ===== 片段内的画布项（视频/首尾帧/参考附件/分镜） =====
  segments.forEach((seg) => {
    seg.canvasItems.forEach((item) => {
      // 生成视频
      add('video', item.videoUrl, '生成视频', '生成视频');
      item.videoUrls?.forEach((u, i) => add('video', u, `生成视频${i + 1}`, '生成视频'));
      // 首尾帧
      add('image', item.firstFrameImageUrl, '首帧', '首帧');
      add('image', item.lastFrameImageUrl, '尾帧', '尾帧');
      // 场景卡片提示词参考附件
      item.referenceAssets?.forEach((a) => {
        add(a.type,a.assetId, a.name || `参考${a.type === 'image' ? '图片' : a.type === 'video' ? '视频' : '音频'}`, '参考附件');
      });
      // 分镜
      item.shots?.forEach((shot, si) => {
        add('image', shot.referenceImageUrl, `分镜${si + 1}参考图`, '分镜参考图');
        shot.referenceAssets?.forEach((a) => {
          add(
            a.type,
           a.assetId,
            a.name || `分镜${si + 1}参考${a.type === 'image' ? '图片' : a.type === 'video' ? '视频' : '音频'}`,
            '分镜参考附件',
          );
        });
      });
    });
  });

  return { image, video, audio };
}
