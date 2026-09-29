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

import { useState, useRef } from 'react';
import {
  Headphones,
  Upload,
  Play,
  Pause,
  Trash2,
  Clock,
} from 'lucide-react';
import { useWorkflowStore, persistWorkflowState } from '../stores/workflowStore';
import { syncWorkflowToCloudApi } from '@/modules/workflow/api/syncApi';
import { message } from '@/shared/utils/message';

export const AudioAssetsPanel: React.FC = () => {
  const { audioAssets, addAudioAsset, removeAudioAsset } = useWorkflowStore();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const togglePlay = (asset: { id: string; audioUrl?: string }) => {
    if (!asset.audioUrl) return;

    if (playingId === asset.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(asset.audioUrl);
      audioRef.current.play();
      audioRef.current.onended = () => setPlayingId(null);
      setPlayingId(asset.id);
    }
  };

  // 自动同步到云端
  const syncToCloud = async () => {
    const projectId = useWorkflowStore.getState().currentProjectId;
    if (!projectId || projectId === 'default') return;
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      const state = useWorkflowStore.getState();
      const workflowData = {
        version: 2,
        projectAssets: {
          characters: state.characters,
          scenes: state.scenes,
          era: state.era,
          relationshipNetwork: state.relationshipNetwork,
          agentType: state.agentType,
          artStyle: state.artStyle,
          artStylePromptHint: state.artStylePromptHint,
          skills: state.skills,
          textModel: state.textModel,
          imageModel: state.imageModel,
          videoModel: state.videoModel,
          audioAssets: state.audioAssets,
        },
        currentEpisodeData: {
          currentStep: state.currentStep,
          topic: state.topic,
          script: state.script,
          previousEpisodeScript: state.previousEpisodeScript,
          isSimplifiedMode: state.isSimplifiedMode,
          activeCharacterIds: state.activeCharacterIds,
          activeSceneIds: state.activeSceneIds,
          episodes: state.episodes,
        },
      };

      const response = await syncWorkflowToCloudApi(projectId, 'aliyun', workflowData);
      if (response.success && response.data?.urlMapping) {
        const urlMapping = response.data.urlMapping;
        const updatedAssets = state.audioAssets.map((asset) => ({
          ...asset,
          audioUrl: urlMapping[asset.audioUrl] || asset.audioUrl,
          coverUrl: asset.coverUrl ? (urlMapping[asset.coverUrl] || asset.coverUrl) : asset.coverUrl,
        }));
        useWorkflowStore.setState({ audioAssets: updatedAssets });
        const episodeNumber = useWorkflowStore.getState().currentEpisodeNumber ?? 1;
        persistWorkflowState(projectId, episodeNumber);
        console.log('[音频同步] 云端同步完成，URL 已更新');
      }
    } catch (e) {
      console.error('[音频同步] 同步失败:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // 上传音频文件
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64Url = ev.target?.result as string;
      if (!base64Url) return;

      // 获取音频时长
      let duration = 0;
      try {
        const audio = new Audio(base64Url);
        await new Promise<void>((resolve) => {
          audio.onloadedmetadata = () => {
            duration = audio.duration;
            resolve();
          };
          audio.onerror = () => resolve();
          setTimeout(() => resolve(), 3000);
        });
      } catch {
        // ignore
      }

      addAudioAsset({
        id: `upload-${Date.now()}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        audioUrl: base64Url,
        duration: duration > 0 ? duration : undefined,
        source: 'upload',
      });

      message.success('音频上传成功');

      // 自动同步到云端
      await syncToCloud();
    };
    reader.readAsDataURL(file);

    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-bg-tertiary text-text-secondary border border-border/60 hover:bg-bg-tertiary/80 transition-colors"
        >
          <Upload size={14} />
          上传音频
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>

      {/* 音频列表 */}
      {audioAssets.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {audioAssets.map((asset) => (
            <div
              key={asset.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary/50 border border-border/60 hover:border-accent-primary/30 transition-colors group"
            >
              {/* 封面 */}
              {asset.coverUrl ? (
                <img
                  src={asset.coverUrl}
                  alt={asset.title}
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                  <Headphones size={20} className="text-violet-400" />
                </div>
              )}

              {/* 信息 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {asset.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <Clock size={10} />
                    {formatDuration(asset.duration)}
                  </span>
                  {asset.source === 'library' && (
                    <span className="text-xs text-text-muted">音乐库</span>
                  )}
                  {asset.source === 'upload' && (
                    <span className="text-xs text-text-muted">本地上传</span>
                  )}
                </div>
              </div>

              {/* 操作 */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => togglePlay(asset)}
                  className="p-1.5 rounded-lg text-text-muted hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
                >
                  {playingId === asset.id ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  onClick={() => removeAudioAsset(asset.id)}
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Headphones size={32} className="text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">暂无音频</p>
          <p className="text-xs text-text-muted mt-1">
            上传音频文件
          </p>
        </div>
      )}
    </div>
  );
};
