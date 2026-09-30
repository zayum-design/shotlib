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

import { Card, Input, Select, Spin, Tooltip, Tag, Modal, Checkbox } from 'antd';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { MapPin, Sun, Cloud, RefreshCw, Image as ImageIcon, ChevronLeft, ChevronRight, Sparkles, ZoomIn, Upload, Eye, Bookmark, Trash2 } from 'lucide-react';
import type { Scene } from '../../types';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { useState, useMemo } from 'react';
import { uploadFile } from '@/shared/utils/upload';
import { createLocalAsset } from '@/shared/api/userMaterialApi';
import type { UserMaterialItem } from '@/shared/api/userMaterialApi';
import { localApi } from '@/storage';
import { ImagePreview } from './ImagePreview';
import { AvatarUploadDialog } from './AvatarUploadDialog';
import { SCENE_VIEWS } from '@/modules/workflow/api/sceneApi';
import { message } from '../../utils/message';
import { useResolvedImageUrls } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { assetDropTarget, type DraggedProjectAsset } from '@/shared/utils/assetDragDrop';

// 场景视角标签
const VIEW_LABELS = ['正面', '左侧', '右侧', '背面'];
const VIEW_COLORS = ['blue', 'green', 'orange', 'purple'];

interface SceneCardProps {
  scene: Scene;
}

export const SceneCard: React.FC<SceneCardProps> = ({ scene }) => {
  const { updateScene, regenerateSceneImage, generateSceneImages, imageModels, currentProjectId, currentEpisodeNumber, activeSceneIds } = useWorkflowStore();
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [sceneUploadDialogOpen, setSceneUploadDialogOpen] = useState(false);

  // 图片预览状态
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 视角选择弹窗状态
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedViews, setSelectedViews] = useState<number[]>([0]);

  // 添加到个人资产库状态
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false);

  // 批量解析场景图片资产
  const sceneAssetIds = useMemo(() => scene.imageAssetIds || [], [scene.imageAssetIds]);
  const { getUrl } = useResolvedImageUrls(sceneAssetIds);

  // 获取当前要显示的图片URL（优先解析assetId，回退imageUrl）
  const getImageUrl = (index: number): string | undefined => {
    const assetId = scene.imageAssetIds?.[index];
    const fallbackUrl = scene.imageUrls?.[index];
    return (assetId ? getUrl(assetId) : undefined) || fallbackUrl;
  };

  const resolvedImageUrls = useMemo(() => {
    const urls: string[] = [];
    const count = Math.max(scene.imageUrls?.length || 0, scene.imageAssetIds?.length || 0);
    for (let i = 0; i < count; i++) {
      const url = getImageUrl(i);
      if (url) urls.push(url);
    }
    return urls;
  }, [scene.imageUrls, scene.imageAssetIds, getUrl]);

  // 打开场景图片预览
  const openPreview = (index: number) => {
    if (resolvedImageUrls.length === 0) return;
    setPreviewIndex(index);
    setPreviewOpen(true);
  };

  // 场景图显示固定 16:9(与生成比例保持一致,不随项目比例变化)
  const aspectClass = 'aspect-video';

  const handleFieldChange = (field: keyof Scene, value: string) => {
    updateScene(scene.id, { [field]: value });
  };

  const handleModelChange = (model: string) => {
    updateScene(scene.id, { model });
  };

  const handleRegenerateImage = async () => {
    await regenerateSceneImage(scene.id, currentImageIndex);
  };

  const handleOpenViewModal = () => {
    setSelectedViews([0]);
    setViewModalOpen(true);
  };

  const handleConfirmViews = async () => {
    setViewModalOpen(false);
    await generateSceneImages(scene.id, undefined, selectedViews);
  };

  // 本地上传场景照（由 AvatarUploadDialog 的 local tab 调用）
  const handleSceneFileConfirm = async (file: File) => {
    try {
      // 关键修复：场景图属于项目级资产（episode_number=0），跨集统一
      const result = await uploadFile(file, 'drama', 'scene', { projectId: currentProjectId, assetType: 'scene_image', episodeNumber: 0 });
      const newAssetIds = [...(scene.imageAssetIds || [])];
      const newUrls = [...(scene.imageUrls || []), result.url];
      if (result.assetId) {
        newAssetIds.push(result.assetId);
      }
      updateScene(scene.id, { imageAssetIds: newAssetIds, imageUrls: newUrls });
      message.success('场景照已上传');
    } catch (err: any) {
      message.error(err?.message || '场景照上传失败');
    }
  };

  // 从素材库选择场景图加入（创建 image_asset 持久化，对齐头像修复 B：无 assetId 刷新后丢失）
  const handleSceneAssetSelect = async (asset: UserMaterialItem) => {
    let assetKey = '';
    if (currentProjectId && currentProjectId !== 'default') {
      try {
        const res = await localApi.createImageAssets(currentProjectId, {
          assets: [{
            episode_number: 0,
            asset_type: 'scene_image',
            original_url: asset.sourceUrl,
            source: 'asset',
            metadata: { source: 'user_asset', userAssetId: asset.id, name: asset.name },
          }],
        });
        assetKey = res?.data?.[0]?.id || '';
      } catch (e) {
        console.error('[handleSceneAssetSelect] createImageAssets 失败:', e);
      }
    }
    const newAssetIds = [...(scene.imageAssetIds || [])];
    const newUrls = [...(scene.imageUrls || []), asset.sourceUrl];
    if (assetKey) newAssetIds.push(assetKey);
    updateScene(scene.id, { imageAssetIds: newAssetIds, imageUrls: newUrls });
    setSceneUploadDialogOpen(false);
    message.success('已添加场景图');
  };

  // 从项目资产库拖入替换场景图（asset 已是 image_asset 行，直接引用 assetId）
  // 场景图只保留一张：拖入直接替换现有图片，不再追加
  const handleDropSceneImage = (asset: DraggedProjectAsset) => {
    updateScene(scene.id, { imageAssetIds: [asset.assetId], imageUrls: [asset.url] });
    setCurrentImageIndex(0);
    message.success('已从资产库替换场景图');
  };

  // 删除当前显示的场景图（仅从场景移除引用，不删除 image_asset：资产库中的图片保留）
  const handleDeleteCurrentImage = () => {
    const idx = currentImageIndex;
    const newAssetIds = (scene.imageAssetIds || []).filter((_, i) => i !== idx);
    const newUrls = (scene.imageUrls || []).filter((_, i) => i !== idx);
    updateScene(scene.id, { imageAssetIds: newAssetIds, imageUrls: newUrls });
    setCurrentImageIndex(0);
    message.success('已删除场景图');
  };

  // 将当前场景图片添加到个人资产库
  const handleAddToAssetLibrary = async () => {
    const imageUrl = getImageUrl(currentImageIndex);
    if (!imageUrl) return;
    setIsAddingToLibrary(true);
    try {
      // 构造与 creator_instant_assets.data 一致的元数据（scene 行）
      const data = { ...scene };
      delete (data as any).id;
      delete (data as any).imageUrl;
      delete (data as any).imageUrls;
      const res = await createLocalAsset(imageUrl, 'scene', scene.name, undefined, data);
      if (res.success && res.data) {
        message.success('已添加到个人素材库');
      } else {
        message.error(res.message || '添加失败');
      }
    } catch (err: any) {
      message.error(err?.message || '添加失败');
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  const handlePrevImage = () => {
    if (resolvedImageUrls.length === 0) return;
    setCurrentImageIndex((prev) =>
      prev === 0 ? resolvedImageUrls.length - 1 : prev - 1
    );
  };

  const handleNextImage = () => {
    if (resolvedImageUrls.length === 0) return;
    setCurrentImageIndex((prev) =>
      prev === resolvedImageUrls.length - 1 ? 0 : prev + 1
    );
  };

  // 新增角标：isNew 是项目级标记（最近任意一集分解都会写入并随资产行落库），
  // 仅对第2集+且属于当前分集活跃集的场景显示——第1集作为首集不应出现「新增」角标，
  // 也避免第2集新增场景的角标串到第1集视图
  const showNewBadge =
    !!scene.isNew &&
    (currentEpisodeNumber ?? 1) > 1 &&
    (!activeSceneIds?.length || activeSceneIds.includes(scene.id));

  return (
    <Card className="bg-bg-secondary border-border rounded-xl overflow-hidden relative">
      {/* 新增场景 45 度角标 */}
      {showNewBadge && (
        <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none z-10">
          <div className="absolute top-2 -right-8 w-28 bg-accent-primary text-white text-[10px] font-bold text-center py-0.5 shadow-sm transform rotate-45">
            新增
          </div>
        </div>
      )}
      {/* 场景头部 */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Input
            value={scene.name}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            className="text-lg font-semibold bg-transparent border-border"
            placeholder="场景名称"
          />
        </div>
        <Input.TextArea
          value={scene.description}
          onChange={(e) => handleFieldChange('description', e.target.value)}
          className="text-sm text-text-secondary bg-transparent border-border mb-2"
          placeholder="场景描述"
          autoSize={{ minRows: 2, maxRows: 3 }}
        />
      </div>

      {/* 场景属性 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
          <MapPin size={12} className="text-accent-primary" />
          <Input
            value={scene.location}
            onChange={(e) => handleFieldChange('location', e.target.value)}
            className="bg-transparent border-0 p-0 text-xs flex-1"
            placeholder="地点"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
          <Sun size={12} className="text-accent-warning" />
          <Input
            value={scene.timeOfDay}
            onChange={(e) => handleFieldChange('timeOfDay', e.target.value)}
            className="bg-transparent border-0 p-0 text-xs flex-1"
            placeholder="时间段"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
          <Cloud size={12} className="text-accent-info" />
          <Input
            value={scene.season}
            onChange={(e) => handleFieldChange('season', e.target.value)}
            className="bg-transparent border-0 p-0 text-xs flex-1"
            placeholder="季节"
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-bg-tertiary rounded p-2">
          <Cloud size={12} className="text-text-muted" />
          <Input
            value={scene.weather}
            onChange={(e) => handleFieldChange('weather', e.target.value)}
            className="bg-transparent border-0 p-0 text-xs flex-1"
            placeholder="天气"
          />
        </div>
      </div>

      {/* 提示词编辑 */}
      <div className="mb-4">
        <label className="text-xs text-text-muted mb-1 block">场景提示词</label>
        {isEditingPrompt ? (
          <Input.TextArea
            value={scene.imagePrompt}
            onChange={(e) => handleFieldChange('imagePrompt', e.target.value)}
            onBlur={() => setIsEditingPrompt(false)}
            autoFocus
            autoSize={{ minRows: 2, maxRows: 4 }}
            className="bg-bg-tertiary border-border text-sm"
          />
        ) : (
          <div
            onClick={() => setIsEditingPrompt(true)}
            className="bg-bg-tertiary rounded p-2 text-sm text-text-secondary cursor-pointer hover:bg-bg-tertiary/80 transition-colors"
          >
            <span className="truncate block">{scene.imagePrompt}</span>
          </div>
        )}
      </div>

      {/* 图片计数 + 图片模型选择（放在生成按钮上方，先选模型再点生成） */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
          {resolvedImageUrls.length > 1 && (
            <span className="text-xs text-text-muted">
              ({currentImageIndex + 1}/{resolvedImageUrls.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Select
            value={scene.model}
            onChange={handleModelChange}
            options={imageModels.map((m) => ({
              value: m.id,
              label: (
                <Tooltip title={m.description}>
                  <span>{m.name}</span>
                </Tooltip>
              ),
              disabled: m.disabled,
            }))}
            size="small" className="flex-1 min-w-0" popupMatchSelectWidth={false} />
          <ModelPriceTag model={imageModels.find(m => m.id === scene.model)} className="whitespace-nowrap" />
        </div>
      </div>

      {/* 生成场景图片按钮（生成按钮占满整行剩余宽度） */}
      <div className="flex mb-4 gap-2">
        <button
          onClick={handleOpenViewModal}
          disabled={scene.isGenerating}
          className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-accent-primary to-accent-secondary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {scene.isGenerating ? (
            <>
              <Spin size="small" />
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Sparkles size={14} />
              {resolvedImageUrls.length > 0 ? '重新生成' : '生成场景图片'}
            </>
          )}
        </button>
        <Tooltip title="上传场景图">
          <button
            onClick={() => setSceneUploadDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-secondary rounded-lg hover:border-accent-primary/60 hover:text-accent-primary transition-colors text-sm"
          >
            <Upload size={14} />
            上传
          </button>
        </Tooltip>
        <AvatarUploadDialog
          open={sceneUploadDialogOpen}
          onClose={() => setSceneUploadDialogOpen(false)}
          onConfirm={handleSceneFileConfirm}
          showSceneLibraryTab
          onSelectSceneAsset={handleSceneAssetSelect}
          title="选择场景图片来源"
          okText="确认"
          uploadLabel="场景图"
        />
      </div>

      {/* 场景图片预览 - 轮播样式 */}
      <div className="mb-4">
        {/* 单个大图 + 左右箭头切换（支持从项目资产库拖入场景图追加） */}
        <div
          className={`relative ${aspectClass} rounded bg-bg-tertiary overflow-hidden group`}
          {...assetDropTarget(['scene_image'], '场景图', handleDropSceneImage)}
        >
          {scene.isGenerating ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spin size="small" />
            </div>
          ) : resolvedImageUrls.length > 0 ? (
            <>
              <div
                className="w-full h-full cursor-pointer"
                onClick={() => openPreview(currentImageIndex)}
              >
                <img
                  src={resolvedImageUrls[currentImageIndex]}
                  alt={`场景图片 ${currentImageIndex + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error(`图片加载失败: ${resolvedImageUrls[currentImageIndex]}`, e);
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3 pointer-events-none">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openPreview(currentImageIndex);
                    }}
                    className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center pointer-events-auto transition-colors"
                    title="预览"
                  >
                    <ZoomIn size={20} className="text-white" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToAssetLibrary();
                    }}
                    disabled={isAddingToLibrary}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-white text-xs pointer-events-auto transition-colors bg-white/20 hover:bg-white/40 disabled:opacity-50"
                    title="添加到我的个人素材库"
                  >
                    {isAddingToLibrary ? (
                      <Spin size="small" />
                    ) : (
                      <Bookmark size={14} />
                    )}
                    添加到我的素材库
                  </button>
                </div>
              </div>
              <div className="absolute top-1 left-1 flex items-center gap-1">
                <div className="bg-black/50 text-white text-xs px-2 py-1 rounded">
                  图片 {currentImageIndex + 1}/{resolvedImageUrls.length}
                </div>
                {resolvedImageUrls.length === 4 && (
                  <Tag color={VIEW_COLORS[currentImageIndex]} className="m-0 text-xs">
                    {VIEW_LABELS[currentImageIndex]}视角
                  </Tag>
                )}
              </div>
              {/* 右上角删除按钮（z-20：避免被右侧全高切换箭头遮挡） */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteCurrentImage();
                }}
                className="absolute top-1 right-1 z-20 w-7 h-7 rounded-full bg-black/50 hover:bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="删除图片"
              >
                <Trash2 size={13} className="text-white" />
              </button>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon size={32} className="text-text-muted" />
            </div>
          )}

          {/* 左右切换箭头 */}
          {resolvedImageUrls.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrevImage();
                }}
                className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronLeft size={20} className="text-white" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextImage();
                }}
                className="absolute right-0 top-0 bottom-0 w-8 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronRight size={20} className="text-white" />
              </button>
            </>
          )}

        </div>
      </div>

      {/* 图片预览 */}
      <ImagePreview
        images={resolvedImageUrls}
        visible={previewOpen}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        title={`${scene.name} - 场景图片`}
      />

      {/* 视角选择弹窗 */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-accent-primary" />
            <span>选择场景生成视角</span>
          </div>
        }
        open={viewModalOpen}
        onOk={handleConfirmViews}
        onCancel={() => setViewModalOpen(false)}
        okText="确认生成"
        cancelText="取消"
        okButtonProps={{ disabled: selectedViews.length === 0 }}
      >
        <div className="py-4">
          <p className="text-sm text-text-secondary mb-4">
            请选择需要生成的场景视角，默认只生成正面视角。
            {scene.imageUrls && scene.imageUrls.length > 0 && (
              <span className="text-amber-500 ml-1">注意：重新生成将覆盖现有的 {resolvedImageUrls.length} 张图片。</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {SCENE_VIEWS.map((view, index) => (
              <div
                key={view.angle}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedViews.includes(index)
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-border hover:border-accent-primary/50'
                }`}
                onClick={() => {
                  setSelectedViews((prev) =>
                    prev.includes(index)
                      ? prev.filter((v) => v !== index)
                      : [...prev, index]
                  );
                }}
              >
                <div className="flex items-center gap-2">
                  <Checkbox checked={selectedViews.includes(index)} />
                  <span className="font-medium text-sm">{view.name}</span>
                </div>
                <p className="text-xs text-text-muted mt-1 ml-6">{view.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-text-muted bg-bg-tertiary rounded p-2">
            已选择 {selectedViews.length} 个视角，将生成 {selectedViews.length} 张图片
          </div>
        </div>
      </Modal>
    </Card>
  );
};
