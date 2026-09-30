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

import { useState, useMemo } from 'react';
import { Tabs, Spin } from 'antd';
import { Users, MapPin, Video, ImageIcon, Play, Headphones } from 'lucide-react';
import { useWorkflowStore } from '../stores/workflowStore';
import { AudioAssetsPanel } from './AudioAssetsPanel';
import { useResolvedImageUrls } from '../hooks/useWorkflowImageResolver';

export const GlobalAssetsPanel: React.FC = () => {
  const {
    characters,
    scenes,
    episodes,
    composedVideoUrl,
    currentEpisodeNumber,
  } = useWorkflowStore();

  // 场景管理界面过滤片段衍生场景（isDerived 入库持久化，但不在此显示，避免污染场景库）
  const visibleScenes = scenes.filter((s) => !s.isDerived);

  // 批量解析所有角色/场景图片资产
  const allAssetIds = useMemo(() => {
    const ids: string[] = [];
    characters.forEach((char) => {
      char.avatarImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
      char.multiViewImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
      char.fullBodyImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
    });
    scenes.forEach((scene) => {
      scene.imageAssetIds?.forEach((id) => { if (id) ids.push(id); });
    });
    return ids;
  }, [characters, scenes]);
  const { getUrl } = useResolvedImageUrls(allAssetIds);
  const resolveUrl = (assetId?: string, fallbackUrl?: string) => getUrl(assetId) || fallbackUrl || '';

  // 场景/道具图显示固定 16:9(与生成比例一致,不随项目比例变化)
  const sceneAspect = 'aspect-video';

  const [activeTab, setActiveTab] = useState('characters');
  const [playingVideoKey, setPlayingVideoKey] = useState<string | null>(null);

  // 收集所有片段的视频（当前 + 历史），过滤软删除片段
  const allVideos = episodes.filter((ep) => !ep.deleted).flatMap((ep) => {
    const history = ep.generatedVideos || [];
    const current = ep.generatedVideoUrl
      ? [{ url: ep.generatedVideoUrl, sequence: history.length + 1, createdAt: new Date().toISOString(), timestamp: Date.now(), generationMode: ep.videoGenerationMode }]
      : [];
    // 去重：当前 URL 和最新历史记录相同则跳过
    const uniqueCurrent = history.length > 0 && history[0]?.url === ep.generatedVideoUrl ? [] : current;
    return [...uniqueCurrent, ...history].map((v) => ({
      ...v,
      episodeTitle: ep.title,
      episodeId: ep.id,
    }));
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  return (
    <div className="space-y-6">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          // ===== 角色 Tab =====
          {
            key: 'characters',
            label: (
              <div className="flex items-center gap-2">
                <Users size={16} />
                <span>角色 ({characters.length})</span>
              </div>
            ),
            children: (
              <div className="space-y-4">
                {characters.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {characters.map((char) => {
                      const avatarImg = char.avatarImages?.[char.currentAvatarIndex || 0];
                      const multiViewImg = char.multiViewImages?.[0];
                      const portraits = char.fullBodyImages || [];
                      return (
                        <div key={char.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                          {/* 头像 + 名称 + 简介 */}
                          <div className="flex items-start gap-3 p-4">
                            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0">
                              {resolveUrl(avatarImg?.assetId, avatarImg?.imageUrl) ? (
                                <>
                                  <img src={resolveUrl(avatarImg?.assetId, avatarImg?.imageUrl)} alt={char.name} className="w-full h-full object-cover" />
                                </>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-text-muted">
                                  <ImageIcon size={24} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-text-primary truncate">{char.name}</h4>
                              <p className="text-xs text-text-muted mt-1 line-clamp-2">{char.description}</p>
                            </div>
                          </div>

                          {/* 全身照 + 形象照 同行 */}
                          {(resolveUrl(multiViewImg?.assetId, multiViewImg?.imageUrl) || portraits.length > 0) && (
                            <div className="px-4 pb-3 flex gap-3">
                              {resolveUrl(multiViewImg?.assetId, multiViewImg?.imageUrl) && (
                                <div className="flex-shrink-0">
                                  <span className="text-xs text-text-muted">全身照</span>
                                  <div className="relative aspect-video h-28 rounded-lg overflow-hidden bg-bg-tertiary border border-border mt-1">
                                    <img src={resolveUrl(multiViewImg?.assetId, multiViewImg?.imageUrl)} alt="全身照" className="w-full h-full object-cover" />
                                  </div>
                                </div>
                              )}
                              {portraits.length > 0 && (
                                <div className="flex-1 min-w-0">
                                  <span className="text-xs text-text-muted">形象照 ({portraits.length})</span>
                                  <div className="flex gap-2 mt-1 overflow-x-auto">
                                    {portraits.map((img, idx) => (
                                      <div
                                        key={idx}
                                        className="relative aspect-video h-28 rounded-lg overflow-hidden bg-bg-tertiary border border-border flex-shrink-0"
                                      >
                                        {resolveUrl(img.assetId, img.imageUrl) ? (
                                          <>
                                            <img src={resolveUrl(img.assetId, img.imageUrl)} alt={img.name || `形象照 ${idx + 1}`} className="w-full h-full object-cover" />
                                          </>
                                        ) : img.isGenerating ? (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Spin size="small" />
                                          </div>
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-text-muted">
                                            <ImageIcon size={16} />
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted py-12 text-center">暂无角色数据</p>
                )}
              </div>
            ),
          },

          // ===== 场景 Tab =====
          {
            key: 'scenes',
            label: (
              <div className="flex items-center gap-2">
                <MapPin size={16} />
                <span>场景 ({visibleScenes.length})</span>
              </div>
            ),
            children: (
              <div className="space-y-4">
                {scenes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {visibleScenes.map((scene) => (
                      <div key={scene.id} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                        {/* 场景图片 */}
                        <div className={`${sceneAspect} bg-bg-tertiary overflow-hidden`}>
                          {resolveUrl(scene.imageAssetIds?.[0], scene.imageUrls?.[0]) ? (
                            <img src={resolveUrl(scene.imageAssetIds?.[0], scene.imageUrls?.[0])} alt={scene.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-text-muted">
                              <ImageIcon size={32} />
                            </div>
                          )}
                        </div>

                        <div className="p-3">
                          <h4 className="text-sm font-medium text-text-primary truncate">{scene.name}</h4>
                          <p className="text-xs text-text-muted mt-1 line-clamp-2">{scene.description}</p>

                          {/* 场景标签 */}
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {scene.location && (
                              <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">{scene.location}</span>
                            )}
                            {scene.timeOfDay && (
                              <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">{scene.timeOfDay}</span>
                            )}
                            {scene.season && (
                              <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">{scene.season}</span>
                            )}
                            {scene.weather && (
                              <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary text-text-muted">{scene.weather}</span>
                            )}
                          </div>

                          {/* 多张图片 */}
                          {(scene.imageUrls?.length || scene.imageAssetIds?.length || 0) > 1 && (
                            <div className="flex gap-2 mt-2">
                              {Array.from({ length: Math.max((scene.imageUrls?.length || 0), (scene.imageAssetIds?.length || 0)) }).slice(1).map((_, idx) => (
                                <div key={idx} className="w-16 h-10 rounded overflow-hidden bg-bg-tertiary flex-shrink-0">
                                  <img src={resolveUrl(scene.imageAssetIds?.[idx + 1], scene.imageUrls?.[idx + 1])} alt={`${scene.name} ${idx + 2}`} className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted py-12 text-center">暂无场景数据</p>
                )}
              </div>
            ),
          },

          // ===== 音频 Tab =====
          {
            key: 'music',
            label: (
              <div className="flex items-center gap-2">
                <Headphones size={16} />
                <span>音频</span>
              </div>
            ),
            children: <AudioAssetsPanel />,
          },

          // ===== 视频 Tab =====
          {
            key: 'videos',
            label: (
              <div className="flex items-center gap-2">
                <Video size={16} />
                <span>视频 ({allVideos.length})</span>
              </div>
            ),
            children: (
              <div className="space-y-4">
                {/* 合并成片（Step5 合成结果，当前分集） */}
                {composedVideoUrl && (
                  <div className="bg-bg-secondary border border-accent-primary/30 rounded-xl overflow-hidden">
                    <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-text-primary">
                        合并成片（第 {currentEpisodeNumber} 集）
                      </span>
                      <a
                        href={composedVideoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent-primary hover:underline"
                      >
                        在新窗口打开
                      </a>
                    </div>
                    <div className={`${sceneAspect} max-w-[480px] mx-auto mb-3 bg-black overflow-hidden rounded-lg`}>
                      <video src={composedVideoUrl} className="w-full h-full object-contain" controls preload="metadata" />
                    </div>
                  </div>
                )}
                {allVideos.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {allVideos.map((video) => {
                      const videoKey = `${video.episodeId}-${video.sequence}`;
                      const isPlaying = playingVideoKey === videoKey;
                      return (
                      <div key={videoKey} className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
                        {/* 视频缩略图 */}
                        <div
                          className={`${sceneAspect} bg-bg-tertiary overflow-hidden relative group cursor-pointer`}
                          onClick={() => {
                            if (isPlaying) {
                              setPlayingVideoKey(null);
                            } else {
                              setPlayingVideoKey(videoKey);
                            }
                          }}
                        >
                          {isPlaying ? (
                            <video src={video.url} className="w-full h-full object-contain" controls autoPlay />
                          ) : (
                            <>
                              <video src={video.url} className="w-full h-full object-cover" preload="metadata" />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Play size={32} className="text-white" />
                              </div>
                            </>
                          )}
                        </div>

                        <div className="p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-accent-primary font-medium">
                              #{video.sequence}
                            </span>
                            <span className="text-xs text-text-muted">
                              {new Date(video.createdAt).toLocaleString('zh-CN', {
                                month: '2-digit', day: '2-digit',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary mt-1.5 truncate">
                            片段：{video.episodeTitle}
                          </p>
                          {video.generationMode && (
                            <span className="text-xs px-1.5 py-0.5 mt-1.5 inline-block rounded bg-bg-tertiary text-text-muted">
                              {video.generationMode === 'first_last_frame' ? '首尾帧' : '参考图'}
                            </span>
                          )}
                        </div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted py-12 text-center">暂无生成视频</p>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
};
