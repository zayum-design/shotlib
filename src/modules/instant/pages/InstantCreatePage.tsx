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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Film,
  ArrowLeft,
  MoreHorizontal,
  MoreVertical,
  Plus,
  User,
  Users,
  Map,
  Image as ImageIcon,
  X,
  ChevronLeft,
  ChevronRight,
  Scan,
  MonitorPlay,
  Download,
  Upload,
  Cloud,
  Loader2,
  RefreshCw,
  Trash2,
  Check,
} from 'lucide-react';
import { Button, Dropdown, Modal, Input, Select, Switch, Steps, Tooltip, Spin } from 'antd';
import type { MenuProps } from 'antd';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { useTaskQueueStore, type TaskEntry } from '@/shared/stores/taskQueueStore';
import { syncWorkflowApi, syncWorkflowToCloudApi, exportWorkflowZipApi } from '@/modules/workflow/api/workflowApi';
import { saveInstantToServer } from '../utils/instantSyncUtils';
import { LeftSidebar } from '../components/LeftSidebar';
import VisualPromptEditor from '@/shared/components/ui/VisualPromptEditor';
import { ImagePreviewModal } from '@/shared/components/ui/ImagePreviewModal';
import { SceneImagesGridModal } from '@/shared/components/ui/SceneImagesGridModal';
import { CanvasSceneCard } from '../components/CanvasSceneCard';
import { ShotEditorModal } from '../components/ShotEditorModal';
import { VideoPreviewModal } from '../components/VideoPreviewModal';
import { PreviewRequestModal } from '@/shared/components/ui/PreviewRequestModal';
import { useInstantCreatePage } from '../hooks/useInstantCreatePage';
import type { CanvasItem, InstantCharacter, InstantScene } from '@/shared/types/project';
import { CreateSceneDialog } from '../components/CreateSceneDialog';
import { Dices, Sparkles } from 'lucide-react';
import { saveGeneratedAssets, extractInstantAssets } from '@/shared/utils/generatedAssetsHistory';

import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { HoverImagePreview, type HoverPreviewState } from '@/shared/components/ui/HoverImagePreview';
import { InstantCreatePageHeader } from '../components/InstantCreatePageHeader';
import { InstantCreateSegmentTabs } from '../components/InstantCreateSegmentTabs';
import { InstantCreateSceneSider } from '../components/InstantCreateSceneSider';
import { InstantCreatePageModals } from '../components/InstantCreatePageModals';
import { message } from '@/shared/utils/message';

export const InstantCreatePage: React.FC = () => {
  const page = useInstantCreatePage();

  // 注册任务抽屉中视频任务的重试处理器
  const handleRetryVideoTask = useCallback((task: TaskEntry) => {
    const itemId = task.metadata?.subId as string | undefined;
    if (!itemId) {
      message.error('无法定位要重试的视频任务');
      return;
    }
    page.handleRetrySceneVideo(itemId);
  }, [page.handleRetrySceneVideo]);

  useEffect(() => {
    useTaskQueueStore.getState().setRetryVideoTaskHandler(handleRetryVideoTask);
    return () => {
      useTaskQueueStore.getState().setRetryVideoTaskHandler(undefined);
    };
  }, [handleRetryVideoTask]);

  // 即时创作页面使用独立的 useInstantDataLoader 加载数据，
  // 不需要通过 workflowStore 的 loadWorkflowFromServer 加载（重构后该函数只返回数据不写 store）。

  const [sceneHoverPreview, setSceneHoverPreview] = useState<HoverPreviewState | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isDragOverHeader, setIsDragOverHeader] = useState(false);
  const draggedIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const dragEnterCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 同步状态
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const { remoteStorage } = useSettingsStore();

  // 视频预览
  const [previewOpen, setPreviewOpen] = useState(false);

  const headerSceneItems = page.canvasItems
    .filter((item): item is CanvasItem & { type: 'scene' } => item.type === 'scene' && item.headerOrder !== undefined)
    .sort((a, b) => (a.headerOrder || 0) - (b.headerOrder || 0));

  const previewVideos = headerSceneItems
    .map((item) => {
      const scene = page.scenes.find((s) => s.id === item.refId);
      return scene && item.videoUrl ? { item, scene, videoUrl: item.videoUrl } : null;
    })
    .filter(Boolean) as { item: CanvasItem & { type: 'scene' }; scene: InstantScene; videoUrl: string }[];

  const handleOpenPreview = () => {
    if (headerSceneItems.length === 0) {
      message.warning('标题栏中没有场次，请先将场景拖入标题栏后再预览');
      return;
    }
    if (previewVideos.length === 0) {
      message.warning('标题栏中的场景尚未生成视频，请先生成视频后再预览');
      return;
    }
    setPreviewOpen(true);
  };

  // 构建完整即时创作项目数据
  const buildCompleteInstantData = useCallback(() => {
    return {
      version: 2,
      category: 'instant',
      projectId: page.currentProject?.id || page.projectId,
      instantCharacters: page.characters,
      instantScenes: page.scenes,
      instantSegments: page.segments,
      exportedAt: Date.now(),
    };
  }, [page.currentProject?.id, page.projectId, page.characters, page.scenes, page.segments]);

  // 将后端返回的云端数据应用到本地状态（更新资产 URL 为云端地址）
  const applyCloudInstantData = async (data: any) => {
    if (!data) return;

    // 使用 applyCloudSyncData 直接更新状态并保存到服务器，避免触发额外的自动保存导致 409 冲突
    await page.applyCloudSyncData({
      instantCharacters: data.instantCharacters,
      instantScenes: data.instantScenes,
      instantSegments: data.instantSegments,
    });

    // 保存 AI 生成资产到本地历史记录
    const pid2 = page.currentProject?.id || page.projectId;
    if (pid2) {
      const assets = extractInstantAssets(data, pid2);
      if (assets.length > 0) {
        saveGeneratedAssets(assets);
        console.log(`已保存 ${assets.length} 条 Instant 生成资产到本地历史记录`);
      }
    }
  };

  // 下载数据：保存到项目服务器后直接打包下载 zip（不再依赖远程存储配置）
  const handleDownloadData = async () => {
    const pid = page.currentProject?.id || page.projectId;
    if (!pid) {
      message.warning('请先选择项目');
      return;
    }

    setIsSyncing(true);
    try {
      const instantData = buildCompleteInstantData();
      const workflowData = JSON.parse(JSON.stringify(instantData));

      // 1. 先保存到项目服务器（不依赖远程存储配置）
      const saveSuccess = await saveInstantToServer(pid, {
        instantCharacters: instantData.instantCharacters,
        instantScenes: instantData.instantScenes,
        instantSegments: instantData.instantSegments,
      });
      if (!saveSuccess) {
        console.warn('[下载数据] 项目数据保存到服务器失败，继续导出本地数据');
      } else {
        console.log('[下载数据] 项目数据已保存到服务器');
      }

      // 2. 直接打包下载当前数据
      await exportWorkflowZipApi(pid, workflowData, 'instant');
      message.success('打包文件下载已启动');
    } catch (error: any) {
      console.error('下载打包文件失败:', error);
      message.error(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // 导入数据：从 JSON 文件恢复即时创作数据
  const handleImportData = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 重置 input，允许重复选择同一文件
      e.target.value = '';

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // 检查跨模式导入：即时创作只能导入 instant 数据
        if (data.category && data.category !== 'instant') {
          message.error(`导入失败：该文件是${data.category === 'workflow' ? '剧本创作' : data.category}模式的数据，不能导入到即时创作中`);
          return;
        }

        // 提取核心数据（兼容直接导出格式和嵌套格式）
        const importedChars: InstantCharacter[] = data.instantCharacters || [];
        const importedScenes: InstantScene[] = data.instantScenes || [];
        const importedSegments: any[] = data.instantSegments || [];

        if (
          importedChars.length === 0 &&
          importedScenes.length === 0 &&
          importedSegments.length === 0
        ) {
          message.warning('导入文件为空或格式不正确');
          return;
        }

        // 检查当前项目是否已有内容
        const hasExistingContent =
          page.characters.length > 0 ||
          page.scenes.length > 0 ||
          page.segments.some((s) => s.canvasItems.length > 0);

        const doImport = () => {
          if (importedChars.length > 0) {
            page.saveCharacters(importedChars);
          }
          if (importedScenes.length > 0) {
            page.saveScenes(importedScenes);
          }
          if (importedSegments.length > 0) {
            page.saveSegments(importedSegments);
          }
          message.success('数据导入成功');
        };

        if (hasExistingContent) {
          Modal.confirm({
            title: '危险操作确认',
            content:
              '当前项目已有内容，导入将覆盖所有现有数据（角色、场景、片段）。此操作不可撤销，是否继续？',
            okText: '确认覆盖',
            okType: 'danger',
            cancelText: '取消',
            onOk: doImport,
          });
        } else {
          doImport();
        }
      } catch (err: any) {
        console.error('导入数据失败:', err);
        message.error(`导入失败: ${err instanceof Error ? err.message : '文件格式错误'}`);
      }
    },
    [page]
  );

  // 同步到云端
  const handleSyncToCloud = async () => {
    const pid = page.currentProject?.id || page.projectId;
    if (!pid) {
      message.warning('请先选择项目');
      return;
    }
    if (!remoteStorage) {
      message.warning('未配置远程存储，请先在设置中配置');
      return;
    }

    setIsCloudSyncing(true);
    try {
      const instantData = buildCompleteInstantData();
      const workflowData = JSON.parse(JSON.stringify(instantData));

      const response = await syncWorkflowToCloudApi(pid, remoteStorage, workflowData, 'instant');

      if (response.success) {
        message.success(response.message || '云端同步成功');
        console.log('云端同步成功:', response.data);

        // 将后端返回的云端 workflowData 应用到本地状态（更新资产 URL 为云端地址）
        if (response.data?.workflowData) {
          await applyCloudInstantData(response.data.workflowData);
        }
      } else {
        message.error(response.message || '云端同步失败');
      }
    } catch (error: any) {
      console.error('云端同步失败:', error);
      message.error(`云端同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCloudSyncing(false);
    }
  };

  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      root.style.height = '100vh';
      root.style.minHeight = '100vh';
      root.style.overflow = 'hidden';
    }
    return () => {
      if (root) {
        root.style.height = '';
        root.style.minHeight = '';
        root.style.overflow = '';
      }
    };
  }, []);

  return (
    <div className="h-screen bg-bg-primary flex flex-col overflow-hidden">
      <InstantCreatePageHeader
        page={page}
        isDragOverHeader={isDragOverHeader}
        setIsDragOverHeader={setIsDragOverHeader}
        dragEnterCounterRef={dragEnterCounterRef}
        dragOverIndex={dragOverIndex}
        setDragOverIndex={setDragOverIndex}
        dragOverIndexRef={dragOverIndexRef}
        draggedIndexRef={draggedIndexRef}
        sceneHoverPreview={sceneHoverPreview}
        setSceneHoverPreview={setSceneHoverPreview}
        isSyncing={isSyncing}
        handleDownloadData={handleDownloadData}
        handleImportData={handleImportData}
        handleOpenPreview={handleOpenPreview}
        fileInputRef={fileInputRef}
        handleFileSelected={handleFileSelected}
      />

      <InstantCreateSegmentTabs
        segments={page.segments}
        activeSegmentId={page.activeSegmentId}
        setActiveSegmentId={page.setActiveSegmentId}
      />

      {/* 主内容区 - Sider + Content 布局 */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* 左侧资源栏 */}
        <div className="flex-shrink-0 overflow-hidden min-h-0 flex flex-col">
          <LeftSidebar
            characters={page.characters}
            scenes={page.scenes}
            onAddCharacter={() => page.setCharacterDialogOpen(true)}
            onAddScene={() => page.setSceneDialogOpen(true)}
            onDragStartItem={(data) => {
              page.dragDataRef.current = data;
            }}
            onDragEndItem={() => {
              // 延迟重置，确保 onDrop 有机会读取数据
              setTimeout(() => {
                page.dragDataRef.current = null;
              }, 200);
            }}
            onDeleteCharacter={page.handleDeleteCharacter}
            onOpenMultiView={page.handleOpenMultiView}
            onOpenAvatarPreview={page.handleOpenAvatarPreview}
            onGenerateCharacterViews={page.handleGenerateCharacterViews}
            onEditScene={page.handleEditScene}
            onDeleteScene={page.handleDeleteScene}
            onOpenScenePreview={page.handleOpenScenePreview}
            onOpenSceneImagesPreview={(scene, images) => page.openSceneGridModal(images, scene.name)}
            aspectRatio={page.currentProject?.aspectRatio}
          />
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 flex overflow-hidden bg-bg-primary min-h-0">
          {/* 场景列表 Sider */}
          <InstantCreateSceneSider
            canvasItems={page.canvasItems}
            scenes={page.scenes}
            selectedSceneItemId={page.selectedSceneItemId}
            currentProjectAspectRatio={page.currentProject?.aspectRatio}
            focusOnItem={page.focusOnItem}
            handleOpenItemRename={page.handleOpenItemRename}
            handleDeleteCanvasItem={page.handleDeleteCanvasItem}
          />

          {/* 场景详情 Content */}
          <div className="flex-1 overflow-y-auto p-4 scene-detail-content min-h-0">
            {!page.hasContent && (
              <div className="h-full flex items-center justify-center">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center text-center"
                >
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center mb-6">
                    <Plus size={40} className="text-accent-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-text-primary mb-2">开始构建你的短剧世界</h2>
                  <p className="text-text-secondary mb-8 max-w-sm">点击添加角色或场景，开始创作你的短剧内容</p>
                  <div className="flex items-center gap-3">
                    <Button
                      type="primary"
                      size="large"
                      icon={<Users size={18} />}
                      onClick={() => page.setCharacterDialogOpen(true)}
                      className="h-12 px-6 text-base"
                    >
                      增加角色
                    </Button>
                    <Button
                      type="primary"
                      size="large"
                      icon={<Map size={18} />}
                      onClick={() => page.setSceneDialogOpen(true)}
                      className="h-12 px-6 text-base"
                    >
                      增加场景
                    </Button>
                  </div>
                </motion.div>
              </div>
            )}
            {(() => {
              const activeItem = page.selectedSceneItemId
                ? page.canvasItems.find((i) => i.id === page.selectedSceneItemId && i.type === 'scene')
                : null;
              const activeScene = activeItem
                ? page.scenes.find((s) => s.id === activeItem.refId)
                : null;
              const activeSceneChars = activeItem
                ? (activeItem.characters || [])
                    .map((cid) => page.characters.find((c) => c.id === cid))
                    .filter(Boolean) as InstantCharacter[]
                : [];
              if (activeItem && activeScene) {
                return (
                  <CanvasSceneCard
                    key={activeItem.id}
                    item={activeItem}
                    scene={activeScene}
                    sceneChars={activeSceneChars}
                    characters={page.characters}
                    scenes={page.scenes}
                    currentProjectAspectRatio={page.currentProject?.aspectRatio}
                    canvasAspectClass={page.canvasAspectClass}
                    defaultVideoModel={page.defaultVideoModel}
                    videoModels={page.videoModels}
                    textModels={page.textModels}
                    defaultTextModel={page.defaultTextModel}
                    imageModels={page.imageModels}
                    onShotImageModelChange={page.handleShotImageModelChange}
                    onDeleteCanvasItem={page.handleDeleteCanvasItem}
                    onEditScene={page.handleEditScene}
                    onRemoveCharacterFromScene={page.handleRemoveCharacterFromScene}
                    onEditScenePrompt={page.handleEditScenePrompt}
                    onScenePromptChange={page.handleScenePromptChange}
                    onSceneReferenceAssetsChange={page.handleSceneReferenceAssetsChange}
                    onGenerateShots={page.handleGenerateShots}
                    onOpenShotModal={page.openShotModal}
                    onDeleteShot={page.handleDeleteShot}
                    onGenerateShotReferenceImage={page.handleGenerateShotReferenceImage}
                    onShotTextModelChange={page.handleShotTextModelChange}
                    onShotMaxDurationChange={page.handleShotMaxDurationChange}
                    onSceneVideoModelChange={page.handleSceneVideoModelChange}
                    onVideoDurationChange={page.handleVideoDurationChange}
                    onVideoResolutionChange={page.handleVideoResolutionChange}
                    onGenerateSceneVideo={page.handleGenerateSceneVideo}
                    onRetrySceneVideo={page.handleRetrySceneVideo}
                    onVideoGenerationModeChange={page.handleVideoGenerationModeChange}
                    onFirstFramePromptChange={page.handleFirstFramePromptChange}
                    onLastFramePromptChange={page.handleLastFramePromptChange}
                    onFirstLastFrameVideoPromptChange={page.handleFirstLastFrameVideoPromptChange}
                    onGenerateFirstFrame={page.handleGenerateFirstFrame}
                    onGenerateLastFrame={page.handleGenerateLastFrame}
                    onOpenImagePreview={page.openImagePreview}
                    onBatchGenerateShotReferenceImages={page.handleBatchGenerateShotReferenceImages}
                    onBatchGenerateFirstLastFrames={page.handleBatchGenerateFirstLastFrames}
                    onVideoIndexChange={page.handleVideoIndexChange}
                    onOpenItemRename={page.handleOpenItemRename}
                    onDismissVideoError={page.handleDismissVideoError}
                    onApplyReviewChanges={page.handleApplyReviewChanges}
                  />
                );
              }
              if (page.hasContent) {
                return (
                  <div className="h-full flex items-center justify-center text-text-secondary">
                    <div className="text-center">
                      <ImageIcon size={48} className="mx-auto mb-3 opacity-40" />
                      <p>请从左侧列表选择一个场景</p>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </div>
      </main>

      <InstantCreatePageModals
        page={page}
        previewOpen={previewOpen}
        setPreviewOpen={setPreviewOpen}
        previewVideos={previewVideos}
      />
    </div>
  );
};
