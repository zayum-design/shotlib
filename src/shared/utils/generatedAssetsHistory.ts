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
 * 大模型生成资产本地历史记录
 * 在同步到云端成功后，将所有 AI 生成的资产（图片、视频、音乐、音频）
 * 保存到本地历史记录中，便于后续检索和复用。
 */
import { userStorage } from './userScopedStorage';

export interface GeneratedAssetRecord {
  id: string;
  projectId: string;
  category: 'drama' | 'music' | 'instant';
  type: 'image' | 'video' | 'audio' | 'music';
  prompt: string;
  modelId: string;
  cloudUrl: string;
  createdAt: number;
  metadata?: Record<string, any>;
}

const STORAGE_KEY = 'shotlib_generated_assets_history';

function loadHistory(): GeneratedAssetRecord[] {
  try {
    const raw = userStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: GeneratedAssetRecord[]) {
  try {
    userStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.error('保存生成资产历史记录失败:', e);
  }
}

function isCloudUrl(url: unknown): url is string {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function dedupeAndMerge(
  existing: GeneratedAssetRecord[],
  incoming: GeneratedAssetRecord[]
): GeneratedAssetRecord[] {
  const seen = new Set(existing.map((r) => r.cloudUrl));
  const newRecords = incoming.filter((r) => !seen.has(r.cloudUrl));
  return [...existing, ...newRecords];
}

/** 批量保存生成的资产记录 */
export function saveGeneratedAssets(records: GeneratedAssetRecord[]) {
  if (!records.length) return;
  const history = loadHistory();
  const merged = dedupeAndMerge(history, records);
  saveHistory(merged);
}

/** 获取全部历史记录 */
export function getGeneratedAssetsHistory(): GeneratedAssetRecord[] {
  return loadHistory();
}

/** 按项目 ID 获取历史记录 */
export function getGeneratedAssetsByProject(projectId: string): GeneratedAssetRecord[] {
  return loadHistory().filter((r) => r.projectId === projectId);
}

/** 清空历史记录 */
export function clearGeneratedAssetsHistory() {
  userStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// Drama 资产提取
// ============================================================================

export function extractDramaAssets(workflowData: any, projectId: string): GeneratedAssetRecord[] {
  const records: GeneratedAssetRecord[] = [];
  const { characters, scenes, episodes } = workflowData || {};

  if (Array.isArray(characters)) {
    for (const char of characters) {
      if (Array.isArray(char.avatarImages)) {
        for (const img of char.avatarImages) {
          if (isCloudUrl(img.imageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'drama',
              type: 'image',
              prompt: char.avatarPrompt || char.imagePrompt || '',
              modelId: char.model || '',
              cloudUrl: img.imageUrl,
              createdAt: Date.now(),
              metadata: { characterName: char.name, assetType: 'avatar' },
            });
          }
        }
      }
      if (Array.isArray(char.multiViewImages)) {
        for (const img of char.multiViewImages) {
          if (isCloudUrl(img.imageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'drama',
              type: 'image',
              prompt: char.imagePrompt || '',
              modelId: char.model || '',
              cloudUrl: img.imageUrl,
              createdAt: Date.now(),
              metadata: { characterName: char.name, assetType: 'multiView' },
            });
          }
        }
      }
      if (Array.isArray(char.fullBodyImages)) {
        for (const img of char.fullBodyImages) {
          if (isCloudUrl(img.imageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'drama',
              type: 'image',
              prompt: char.imagePrompt || '',
              modelId: char.model || '',
              cloudUrl: img.imageUrl,
              createdAt: Date.now(),
              metadata: { characterName: char.name, assetType: 'portrait' },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(scenes)) {
    for (const scene of scenes) {
      if (Array.isArray(scene.imageUrls)) {
        for (const url of scene.imageUrls) {
          if (isCloudUrl(url)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'drama',
              type: 'image',
              prompt: scene.imagePrompt || '',
              modelId: scene.model || '',
              cloudUrl: url,
              createdAt: Date.now(),
              metadata: { sceneName: scene.name, assetType: 'scene' },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(episodes)) {
    for (const ep of episodes) {
      // 当前最新视频
      if (isCloudUrl(ep.generatedVideoUrl)) {
        records.push({
          id: generateId(),
          projectId,
          category: 'drama',
          type: 'video',
          prompt: ep.videoPrompt || '',
          modelId: ep.model || '',
          cloudUrl: ep.generatedVideoUrl,
          createdAt: Date.now(),
          metadata: { episodeTitle: ep.title, episodeId: ep.id, isLatest: true },
        });
      }
      // 历史视频列表
      if (Array.isArray(ep.generatedVideos)) {
        for (const video of ep.generatedVideos) {
          if (isCloudUrl(video.url)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'drama',
              type: 'video',
              prompt: ep.videoPrompt || '',
              modelId: ep.model || '',
              cloudUrl: video.url,
              createdAt: video.timestamp || Date.now(),
              metadata: { episodeTitle: ep.title, episodeId: ep.id, generationMode: video.generationMode, sequence: video.sequence },
            });
          }
        }
      }
      if (isCloudUrl(ep.firstFrameImageUrl)) {
        records.push({
          id: generateId(),
          projectId,
          category: 'drama',
          type: 'image',
          prompt: ep.firstFramePrompt || '',
          modelId: ep.frameModel || ep.model || '',
          cloudUrl: ep.firstFrameImageUrl,
          createdAt: Date.now(),
          metadata: { episodeTitle: ep.title, episodeId: ep.id, frameType: 'first' },
        });
      }
      if (isCloudUrl(ep.lastFrameImageUrl)) {
        records.push({
          id: generateId(),
          projectId,
          category: 'drama',
          type: 'image',
          prompt: ep.lastFramePrompt || '',
          modelId: ep.frameModel || ep.model || '',
          cloudUrl: ep.lastFrameImageUrl,
          createdAt: Date.now(),
          metadata: { episodeTitle: ep.title, episodeId: ep.id, frameType: 'last' },
        });
      }
    }
  }

  return records;
}

// ============================================================================
// Music 资产提取
// ============================================================================

export function extractMusicAssets(workflowData: any, projectId: string): GeneratedAssetRecord[] {
  const records: GeneratedAssetRecord[] = [];
  const { history, tasks } = workflowData || {};

  const extractFromItem = (item: any) => {
    if (!item) return;
    const url = item.audioUrl || item.result?.audioUrl;
    if (isCloudUrl(url)) {
      records.push({
        id: generateId(),
        projectId,
        category: 'music',
        type: 'music',
        prompt: item.prompt || item.request?.prompt || item.title || '',
        modelId: item.model || item.request?.model || '',
        cloudUrl: url,
        createdAt: Date.now(),
        metadata: { title: item.title, duration: item.duration },
      });
    }
  };

  if (Array.isArray(history)) {
    for (const item of history) extractFromItem(item);
  }
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      extractFromItem(task);
    }
  }

  return records;
}

// ============================================================================
// Instant 资产提取
// ============================================================================

export function extractInstantAssets(workflowData: any, projectId: string): GeneratedAssetRecord[] {
  const records: GeneratedAssetRecord[] = [];
  const { instantCharacters, instantScenes, instantSegments } = workflowData || {};

  if (Array.isArray(instantCharacters)) {
    for (const char of instantCharacters) {
      if (Array.isArray(char.avatarImages)) {
        for (const img of char.avatarImages) {
          if (isCloudUrl(img.imageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'image',
              prompt: char.avatarPrompt || '',
              modelId: char.model || '',
              cloudUrl: img.imageUrl,
              createdAt: Date.now(),
              metadata: { characterName: char.name, assetType: 'avatar' },
            });
          }
        }
      }
      if (Array.isArray(char.fullBodyImages)) {
        for (const img of char.fullBodyImages) {
          if (isCloudUrl(img.imageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'image',
              prompt: char.imagePrompt || '',
              modelId: char.model || '',
              cloudUrl: img.imageUrl,
              createdAt: Date.now(),
              metadata: { characterName: char.name, assetType: 'fullBody' },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(instantScenes)) {
    for (const scene of instantScenes) {
      if (Array.isArray(scene.imageUrls)) {
        for (const url of scene.imageUrls) {
          if (isCloudUrl(url)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'image',
              prompt: scene.prompt || '',
              modelId: scene.model || '',
              cloudUrl: url,
              createdAt: Date.now(),
              metadata: { sceneName: scene.name, assetType: 'scene' },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(instantSegments)) {
    for (const segment of instantSegments) {
      if (Array.isArray(segment.canvasItems)) {
        for (const item of segment.canvasItems) {
          if (isCloudUrl(item.videoUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'video',
              prompt: item.customPrompt || item.generatedPrompt || '',
              modelId: item.videoModel || '',
              cloudUrl: item.videoUrl,
              createdAt: Date.now(),
              metadata: { segmentName: segment.name, assetType: 'video' },
            });
          }
          if (isCloudUrl(item.firstFrameImageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'image',
              prompt: item.firstFramePrompt || '',
              modelId: item.videoModel || '',
              cloudUrl: item.firstFrameImageUrl,
              createdAt: Date.now(),
              metadata: { segmentName: segment.name, assetType: 'firstFrame' },
            });
          }
          if (isCloudUrl(item.lastFrameImageUrl)) {
            records.push({
              id: generateId(),
              projectId,
              category: 'instant',
              type: 'image',
              prompt: item.lastFramePrompt || '',
              modelId: item.videoModel || '',
              cloudUrl: item.lastFrameImageUrl,
              createdAt: Date.now(),
              metadata: { segmentName: segment.name, assetType: 'lastFrame' },
            });
          }
        }
      }
    }
  }

  return records;
}
