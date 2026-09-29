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

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Modal, Steps, Button, Input, Select, Switch, Tooltip, Spin } from 'antd';
import type { MenuProps } from 'antd';
import {
  X,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Trash2,
  Check,
  Dices,
  Sparkles,
  Music,
  User,
  Scan,
  Plus,
  Bookmark,
} from 'lucide-react';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import { CreateCharacterDialog } from './CreateCharacterDialog';
import { CreateSceneDialog } from './CreateSceneDialog';
import { ShotEditorModal } from './ShotEditorModal';
import { VideoPreviewModal } from './VideoPreviewModal';
import { AvatarStepsModal } from './modals/AvatarStepsModal';
import { MultiViewModal } from './modals/MultiViewModal';
import { PortraitDialogModal } from './modals/PortraitDialogModal';
import { PreviewRequestModal } from '@/shared/components/ui/PreviewRequestModal';
import { ImagePreviewModal } from '@/shared/components/ui/ImagePreviewModal';
import { SceneImagesGridModal } from '@/shared/components/ui/SceneImagesGridModal';
import { VideoComplianceDialog } from '@/shared/components/ui/VideoComplianceDialog';
import VisualPromptEditor from '@/shared/components/ui/VisualPromptEditor';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { buildUrl } from '@/shared/config/api';
import { createLocalAsset } from '@/shared/api/userMaterialApi';
import type { UseInstantCreatePageReturn } from '../hooks/UseInstantCreatePageReturn';
import { message } from '@/shared/utils/message';

interface InstantCreatePageModalsProps {
  page: UseInstantCreatePageReturn;
  previewOpen: boolean;
  setPreviewOpen: (v: boolean) => void;
  previewVideos: { videoUrl: string; scene: { name: string; imageUrl?: string } }[];
}

export const InstantCreatePageModals: React.FC<InstantCreatePageModalsProps> = ({
  page,
  previewOpen,
  setPreviewOpen,
  previewVideos,
}) => {
  const [isAddingSceneToLibrary, setIsAddingSceneToLibrary] = useState(false);

  // 将编辑场景中的场景图添加到个人素材库
  const handleAddSceneToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const scene = page.editingScene;
    if (!scene?.imageUrl) return;
    setIsAddingSceneToLibrary(true);
    try {
      // 构造与 creator_instant_assets.data 一致的元数据（scene 行）
      const data = { ...scene };
      delete (data as any).id;
      delete (data as any).imageUrl;
      delete (data as any).imageUrls;

      const res = await createLocalAsset(scene.imageUrl, 'scene', scene.name, undefined, data);
      if (res.success && res.data) {
        message.success('已添加到个人素材库');
      } else {
        message.error(res.message || '添加失败');
      }
    } catch (err: any) {
      message.error(err?.message || '添加失败');
    } finally {
      setIsAddingSceneToLibrary(false);
    }
  };

  return (
    <>
            {/* 创建角色 Dialog */}
            <CreateCharacterDialog
              open={page.characterDialogOpen}
              onCancel={() => page.setCharacterDialogOpen(false)}
              onCreate={page.handleCreateCharacter}
              imageModels={page.imageModels}
              selectedImageModel={page.selectedImageModel}
              textModels={page.textModels}
              defaultTextModel={page.defaultTextModel}
              projectId={page.projectId}
              onOpenAvatarPreview={page.handleOpenAvatarPreview}
              onOpenMultiView={page.handleOpenMultiView}
              multiViewChar={page.multiViewChar}
            />

            <AvatarStepsModal page={page} />

            {/* 创建场景 Dialog */}
            <CreateSceneDialog
              open={page.sceneDialogOpen}
              onCancel={() => page.setSceneDialogOpen(false)}
              onCreate={page.handleCreateScene}
              existingNames={page.scenes.map((s) => s.name)}
              imageModels={page.imageModels}
              selectedImageModel={page.selectedImageModel}
              aspectRatio={page.currentProject?.aspectRatio}
              textModels={page.textModels}
              defaultTextModel={page.defaultTextModel}
              videoApiPreviewMode={page.apiPreviewMode}
              showApiPreview={page.showApiPreview}
            />

            {/* 重命名片段 Modal */}
            <Modal
              open={page.renameModalOpen}
              onCancel={() => page.setRenameModalOpen(false)}
              onOk={page.handleRenameSegment}
              title="重命名片段"
              okText="确认"
              cancelText="取消"
            >
              <Input
                value={page.renameValue}
                onChange={(e) => page.setRenameValue(e.target.value)}
                placeholder="请输入片段名称"
                className="mt-2"
              />
            </Modal>

            {/* 重命名场次 Modal */}
            <Modal
              open={page.itemRenameModalOpen}
              onCancel={() => page.setItemRenameModalOpen(false)}
              onOk={page.handleSaveItemRename}
              title="重命名场次"
              okText="确认"
              cancelText="取消"
            >
              <Input
                value={page.itemRenameValue}
                onChange={(e) => page.setItemRenameValue(e.target.value)}
                placeholder="请输入场次名称"
                className="mt-2"
              />
            </Modal>

            {/* 编辑场景 Modal */}
            <Modal
              open={page.editSceneOpen}
              onCancel={() => page.setEditSceneOpen(false)}
              onOk={page.handleSaveEditScene}
              confirmLoading={page.editSceneConfirmLoading}
              title="编辑场景"
              okText="确定"
              cancelText="取消"
            >
              <div className="flex gap-4 mt-2">
                {/* 左侧：场景图片 */}
                <div className="flex-shrink-0 w-48 space-y-3">
                  {page.editingScene?.imageUrl ? (
                    <div className="relative group">
                      <img
                        src={page.editingScene.imageUrl}
                        alt={page.editingScene.name}
                        onClick={() => page.editingScene?.imageUrl && page.openImagePreview(page.editingScene.imageUrl, page.editingScene.name)}
                        className={`w-full rounded-lg object-cover border border-border cursor-pointer hover:opacity-90 transition-opacity ${
                          page.currentProject?.aspectRatio === '9:16'
                            ? 'aspect-[9/16]'
                            : page.currentProject?.aspectRatio === '21:9'
                            ? 'aspect-[21/9]'
                            : 'aspect-[16/9]'
                        }`}
                      />
                      <button
                        onClick={handleAddSceneToLibrary}
                        disabled={isAddingSceneToLibrary}
                        title="添加到我的素材库"
                        className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto"
                      >
                        {isAddingSceneToLibrary ? (
                          <Spin size="small" />
                        ) : (
                          <Bookmark size={16} />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className={`w-full rounded-lg bg-bg-tertiary border border-border flex items-center justify-center ${
                      page.currentProject?.aspectRatio === '9:16'
                        ? 'aspect-[9/16]'
                        : page.currentProject?.aspectRatio === '21:9'
                        ? 'aspect-[21/9]'
                        : 'aspect-[16/9]'
                    }`}>
                      <ImageIcon size={48} className="text-text-muted" />
                    </div>
                  )}
                  <Button
                    type="primary"
                    className="w-full"
                    icon={<Sparkles size={16} />}
                    onClick={page.handleGenerateEditSceneImage}
                    loading={page.editSceneConfirmLoading}
                    disabled={!page.editingScene}
                  >
                    生成场景
                  </Button>
                </div>
                {/* 右侧：名称、提示词、模型 */}
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">名称</label>
                    <Input value={page.editSceneName} onChange={(e) => page.setEditSceneName(e.target.value)} placeholder="场景名称" />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">提示词</label>
                    <Input.TextArea
                      value={page.editScenePrompt}
                      onChange={(e) => page.setEditScenePrompt(e.target.value)}
                      placeholder="场景描述提示词"
                      rows={3}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-text-secondary block mb-1">图像模型</label>
                    <Select
                      value={page.editSceneModel}
                      onChange={page.handleEditSceneModelChange}
                      options={page.imageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
                      className="w-full" popupMatchSelectWidth={false} />
                    <ModelPriceTag model={page.imageModels.find(m => m.id === page.editSceneModel)} />
                  </div>
                </div>
              </div>
            </Modal>

            {/* 头像预览 Modal */}
            <Modal
              open={page.avatarPreviewOpen}
              onCancel={() => page.setAvatarPreviewOpen(false)}
              title={page.avatarPreviewChar?.name ? `${page.avatarPreviewChar.name} - 头像` : '头像预览'}
              width={420}
              centered
              footer={null}
            >
              <div className="flex justify-center items-center py-6">
                {page.avatarPreviewChar?.avatar ? (
                  <div className="relative">
                    <img
                      src={page.avatarPreviewChar.avatar}
                      alt={page.avatarPreviewChar.name}
                      className="w-64 h-64 rounded-full object-cover border-4 border-bg-tertiary"
                    />
                    {/* 检查所有类型的图片是否已合规 */}
                    {(page.avatarPreviewChar.avatarImages?.some((img) => {
                      if (!img?.assetId) return false;
                      const d = localApi.getCachedImageData(img.assetId);
                      return d ? !!readAnyCompliance(d)?.isCompliant : false;
                    }) ||
                      page.avatarPreviewChar.portraitImages?.some((img) => {
                        if (!img?.assetId) return false;
                        const d = localApi.getCachedImageData(img.assetId);
                        return d ? !!readAnyCompliance(d)?.isCompliant : false;
                      }) ||
                      page.avatarPreviewChar.fullBodyImages?.some((img) => {
                        if (!img?.assetId) return false;
                        const d = localApi.getCachedImageData(img.assetId);
                        return d ? !!readAnyCompliance(d)?.isCompliant : false;
                      })) && (
                      <Tooltip title="已通过合规检查">
                        <div className="absolute top-2 right-2 z-10 w-6 h-6 bg-cyan-500 text-white rounded-full flex items-center justify-center shadow-sm">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      </Tooltip>
                    )}
                  </div>
                ) : (
                  <div className="w-64 h-64 rounded-full bg-bg-tertiary flex items-center justify-center">
                    <User size={80} className="text-text-muted" />
                  </div>
                )}
              </div>
            </Modal>

            {/* 场景预览 Modal */}
            <Modal
              open={page.scenePreviewOpen}
              onCancel={() => page.setScenePreviewOpen(false)}
              footer={null}
              title={page.scenePreviewScene?.name || '场景预览'}
              width={720}
              centered
            >
              <div className="flex justify-center items-center py-4">
                {page.scenePreviewScene?.imageUrl ? (
                  <img
                    src={page.scenePreviewScene.imageUrl}
                    alt={page.scenePreviewScene.name}
                    className="max-w-full max-h-[70vh] rounded-xl object-contain border border-border mx-auto"
                  />
                ) : (
                  <div className={`w-full rounded-xl bg-bg-tertiary flex items-center justify-center ${
                    page.currentProject?.aspectRatio === '9:16'
                      ? 'aspect-[9/16]'
                      : page.currentProject?.aspectRatio === '21:9'
                        ? 'aspect-[21/9]'
                        : 'aspect-[16/9]'
                  }`}>
                    <ImageIcon size={48} className="text-text-muted" />
                  </div>
                )}
              </div>
            </Modal>

            <MultiViewModal page={page} />
            <PortraitDialogModal page={page} />

            {/* 编辑场景提示词 Modal */}
            <Modal
              open={page.editPromptOpen}
              onCancel={() => {
                page.setEditPromptOpen(false);
                page.setEditingSceneItem(null);
              }}
              onOk={page.handleSaveScenePrompt}
              title="编辑提示词"
              okText="保存"
              cancelText="取消"
              width={640}
            >
              <div className="mt-2">
                <label className="text-xs text-text-secondary block mb-1">视频生成提示词</label>
                <VisualPromptEditor
                  value={page.editingSceneItem?.prompt || ''}
                  onChange={(val) => page.setEditingSceneItem((prev) => (prev ? { ...prev, prompt: val } : null))}
                  characters={page.characters}
                  scenes={page.scenes}
                  placeholder="描述视频内容，输入 @ 插入角色，输入 # 插入场景..."
                  minRows={4}
                />
              </div>
            </Modal>

            {/* 分镜编辑 Modal */}
            <ShotEditorModal
              open={page.shotModalOpen}
              editingShot={page.editingShot}
              shotDuration={page.shotDuration}
              maxShotDuration={page.editingShotMaxDuration}
              shotMovements={page.shotMovements}
              shotType={page.shotType}
              shotAngle={page.shotAngle}
              shotLighting={page.shotLighting}
              shotMood={page.shotMood}
              shotPrompt={page.shotPrompt}
              characters={(() => {
                // @ 下拉只显示拖入该场景卡片角色，而不是全部角色
                const editingItem = page.canvasItems.find((i) => i.id === page.editingShotItemId);
                if (!editingItem) return page.characters;
                return (editingItem.characters || [])
                  .map((cid) => page.characters.find((c) => c.id === cid))
                  .filter(Boolean) as typeof page.characters;
              })()}
              scenes={page.scenes}
              onDurationChange={page.setShotDuration}
              onMovementsChange={page.setShotMovements}
              onTypeChange={page.setShotType}
              onAngleChange={page.setShotAngle}
              onLightingChange={page.setShotLighting}
              onMoodChange={page.setShotMood}
              onPromptChange={page.setShotPrompt}
              onSave={page.handleSaveShot}
              onCancel={() => {
                page.setShotModalOpen(false);
                page.setEditingShot(null);
              }}
            />

            {/* API 请求预览 Modal */}
            <PreviewRequestModal
              open={page.previewOpen}
              data={page.previewData}
              onCancel={() => page.setPreviewOpen(false)}
              onSend={page.handlePreviewConfirm}
            />

            <ImagePreviewModal
              isOpen={page.previewModalOpen}
              images={page.previewImages}
              currentIndex={page.previewCurrentIndex}
              onClose={() => page.setPreviewModalOpen(false)}
              onPrev={() => page.setPreviewCurrentIndex((prev) => (prev === 0 ? page.previewImages.length - 1 : prev - 1))}
              onNext={() => page.setPreviewCurrentIndex((prev) => (prev === page.previewImages.length - 1 ? 0 : prev + 1))}
              title={page.previewTitle}
            />

            <SceneImagesGridModal
              isOpen={page.sceneGridModalOpen}
              images={page.sceneGridImages}
              title={page.sceneGridTitle}
              aspectRatio={page.currentProject?.aspectRatio}
              onClose={() => page.setSceneGridModalOpen(false)}
            />

            <VideoPreviewModal
              open={previewOpen}
              videos={previewVideos.map((v) => ({
                videoUrl: v.videoUrl,
                sceneName: v.scene.name,
                imageUrl: v.scene.imageUrl,
              }))}
              aspectRatio={page.currentProject?.aspectRatio}
              onClose={() => setPreviewOpen(false)}
            />

            {/* 视频合规检查对话框 */}
            <VideoComplianceDialog
              open={page.complianceDialogOpen}
              onClose={() => page.setComplianceDialogOpen(false)}
              onConfirm={page.handleComplyAndGenerate}
              onCheckComplete={page.handleCheckComplete}
              characters={(() => {
                const item = page.activeSegment?.canvasItems.find((i) => i.id === page.complianceItemId);
                return item?.videoGenerationMode === 'first_last_frame' ? [] : (page.characters as any);
              })()}
              frameImages={(() => {
                const item = page.activeSegment?.canvasItems.find((i) => i.id === page.complianceItemId);
                if (item?.videoGenerationMode !== 'first_last_frame') return undefined;
                return [
                  { imageUrl: item.firstFrameImageUrl, assetKey: item.firstFrameImageAssetId, imageName: '首帧' },
                  { imageUrl: item.lastFrameImageUrl, assetKey: item.lastFrameImageAssetId, imageName: '尾帧' },
                ].filter((f): f is { imageUrl: string; assetKey: string; imageName: string } => !!f.imageUrl && !!f.assetKey);
              })()}
              episodeId={page.currentProject?.id || page.projectId || ''}
              shotPrompts={(() => {
                const item = page.activeSegment?.canvasItems.find((i) => i.id === page.complianceItemId);
                if (item?.videoGenerationMode === 'first_last_frame') {
                  return [item.firstFramePrompt, item.lastFramePrompt, item.firstLastFrameVideoPrompt, item.customPrompt]
                    .filter((p): p is string => !!p);
                }
                return item?.shots?.map((s) => s.prompt) || [];
              })()}
            />
    </>
  );
};
