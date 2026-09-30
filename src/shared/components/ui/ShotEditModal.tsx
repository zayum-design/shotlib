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
import { Modal, Input, Slider, Checkbox, Tooltip, Divider } from 'antd';
import { VisualPromptEditor } from './VisualPromptEditor';
import type { Character, Scene, Shot, ShotReferenceAsset, CameraMovement, ShotType, CameraAngle, LightingType, MoodType } from '../../types';
import { CAMERA_MOVEMENTS, SHOT_TYPES, CAMERA_ANGLES, LIGHTING_TYPES, MOOD_TYPES } from '../../types';
import { generateShotPrompt, generateShotPromptPreview } from '@/modules/workflow/utils/workflowUtils';
import { ReferenceThumbnails } from '@/modules/generate/components/ReferenceThumbnails';
import { removeRefTagByUrl } from '@/modules/generate/refTagUtils';
import { AvatarUploadDialog } from './AvatarUploadDialog';
import { ImagePreview } from './ImagePreview';
import { uploadFile } from '@/shared/utils/upload';
import { localApi } from '@/storage';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { message } from '../../utils/message';
import type { UserMaterialItem } from '@/shared/api/userMaterialApi';

/** 根据 File 的 MIME 类型推断参考附件类型 */
function fileToAssetType(file: File): ShotReferenceAsset['type'] {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'image';
}

/** 分镜参考附件最大数量（与 generate 页面上限一致） */
const REF_MAX_COUNT = 9;

interface ShotEditModalProps {
  open: boolean;
  editingShot: Shot | null;
  remainingDuration: number;

  shotDuration: number;
  setShotDuration: (v: number) => void;
  shotMovements: CameraMovement[];
  handleMovementsChange: (movements: string[]) => void;
  shotType: ShotType;
  setShotType: (v: ShotType) => void;
  shotAngle: CameraAngle;
  setShotAngle: (v: CameraAngle) => void;
  shotLighting: LightingType;
  setShotLighting: (v: LightingType) => void;
  shotMood: MoodType;
  setShotMood: (v: MoodType) => void;
  shotPrompt: string;
  setShotPrompt: (v: string) => void;
  shotReferencePrompt: string;
  setShotReferencePrompt: (v: string) => void;
  /** 参考附件（上传的图片/视频/音频） */
  shotReferenceAssets: ShotReferenceAsset[];
  setShotReferenceAssets: (assets: ShotReferenceAsset[]) => void;

  characters: Character[];
  scenes: Scene[];
  /** 道具伪资产（仅用于 ! 下拉引用，不出现在参考附件缩略图与上传管理中） */
  propAssets?: ShotReferenceAsset[];

  onSave: () => void;
  onCancel: () => void;
  sanitizeHtml: (html: string) => string;
}

/**
 * 分镜编辑/新增弹窗：左侧选择项 + 右侧提示词 + 底部预览
 */
export const ShotEditModal: React.FC<ShotEditModalProps> = ({
  open,
  editingShot,
  remainingDuration,
  shotDuration,
  setShotDuration,
  shotMovements,
  handleMovementsChange,
  shotType,
  setShotType,
  shotAngle,
  setShotAngle,
  shotLighting,
  setShotLighting,
  shotMood,
  setShotMood,
  shotPrompt,
  setShotPrompt,
  shotReferencePrompt,
  setShotReferencePrompt,
  shotReferenceAssets,
  setShotReferenceAssets,
  characters,
  scenes,
  propAssets = [],
  onSave,
  onCancel,
  sanitizeHtml,
}) => {
  // 道具伪资产与上传附件合并进编辑器 ! 下拉（缩略图仍只显示上传附件）
  const editorReferenceAssets = [...shotReferenceAssets, ...propAssets];
  // ===== 参考附件上传（复刻 generate 页面输入框左侧的上传功能） =====
  const [uploading, setUploading] = useState(false);
  const [uploadingType, setUploadingType] = useState<ShotReferenceAsset['type'] | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  // 图片预览（点击图片附件缩略图放大，支持组内切换）
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewIndex, setImgPreviewIndex] = useState(0);

  const imageAssetUrls = shotReferenceAssets
    .filter((r) => r.type === 'image')
    .map((r) =>r.assetId);

  /** 添加附件（上限 REF_MAX_COUNT） */
  const addAsset = (asset: ShotReferenceAsset) => {
    if (shotReferenceAssets.length >= REF_MAX_COUNT) {
      message.warning(`最多添加 ${REF_MAX_COUNT} 条参考`);
      return;
    }
    setShotReferenceAssets([...shotReferenceAssets, asset]);
  };

  /** 本地上传参考附件（图片/视频/音频） */
  const handleUploadAsset = async (file: File) => {
    const type = fileToAssetType(file);
    setUploading(true);
    setUploadingType(type);
    try {
      // 图片附件同时创建 image_asset 行（assetType=shot_reference），便于后续按行管理
      const currentProjectId = useWorkflowStore.getState().currentProjectId;
      const episodeNumber = useWorkflowStore.getState().currentEpisodeNumber ?? 1;
      const canPersistAsset = type === 'image' && !!currentProjectId && currentProjectId !== 'default';
      const { url: assetId, assetId: assetKey } = await uploadFile(
        file,
        'drama',
        'shot_reference',
        canPersistAsset ? { projectId: currentProjectId, assetType: 'shot_reference', episodeNumber } : {},
      );
      addAsset({ type, assetId, name: file.name, assetKey: canPersistAsset ? assetKey : undefined });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
      setUploadingType(null);
    }
  };

  /**
   * 素材库选择的图片附件：创建 shot_reference 资产行（对齐 PropCard 素材库选图模式）；
   * 建行失败时 assetKey 留空，不影响使用
   */
  const addLibraryImageAsset = async (asset: UserMaterialItem, fallbackName: string) => {
    let assetKey = '';
    const currentProjectId = useWorkflowStore.getState().currentProjectId;
    const episodeNumber = useWorkflowStore.getState().currentEpisodeNumber ?? 1;
    if (currentProjectId && currentProjectId !== 'default') {
      try {
        const res = await localApi.createImageAssets(currentProjectId, {
          assets: [{
            episode_number: episodeNumber,
            asset_type: 'shot_reference',
            original_url: asset.sourceUrl,
            source: 'asset',
            metadata: { source: 'user_asset', userAssetId: asset.id, name: asset.name },
          }],
        });
        assetKey = res?.data?.[0]?.id || '';
      } catch (e) {
        console.error('[ShotEditModal] createImageAssets 失败:', e);
      }
    }
    addAsset({ type: 'image', assetId: asset.sourceUrl, name: asset.name || fallbackName, assetKey: assetKey || undefined });
  };

  /** 点击附件缩略图：仅图片打开预览 */
  const handlePreviewAsset = (index: number) => {
    const asset = shotReferenceAssets[index];
    if (!asset || asset.type !== 'image') return;
    const idx = imageAssetUrls.indexOf(asset.assetId);
    setImgPreviewIndex(idx >= 0 ? idx : 0);
    setImgPreviewOpen(true);
  };

  /** 删除附件：同步删除提示词中引用该附件的 !<ref> 标签（两个提示词都清理，兼容历史数据） */
  const handleRemoveAsset = (index: number) => {
    const asset = shotReferenceAssets[index];
    setShotReferenceAssets(shotReferenceAssets.filter((_, idx) => idx !== index));
    if (!asset) return;
    if (shotPrompt.includes(asset.assetId)) {
      setShotPrompt(removeRefTagByUrl(shotPrompt, asset.assetId));
    }
    if (shotReferencePrompt.includes(asset.assetId)) {
      setShotReferencePrompt(removeRefTagByUrl(shotReferencePrompt, asset.assetId));
    }
  };

  return (
    <Modal
      title={editingShot ? '编辑分镜' : '新增分镜'}
      open={open}
      onOk={onSave}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={800}
      destroyOnHidden
    >
      <div className="py-4">
        {/* 主内容区：左右两栏 */}
        <div className="flex gap-6">
          {/* 左侧：选择项 */}
          <div className="w-1/2 space-y-3">
            {/* 时长选择 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">时长</label>
              <div className="flex items-center gap-2 flex-1">
                <Slider
                  min={1}
                  max={editingShot ? 15 : Math.min(15, remainingDuration)}
                  value={shotDuration}
                  onChange={setShotDuration}
                  className="flex-1"
                  disabled={!editingShot && remainingDuration <= 0}
                />
                <Input
                  type="number"
                  min={1}
                  max={editingShot ? 15 : Math.min(15, remainingDuration)}
                  value={shotDuration}
                  onChange={(e) => {
                    const maxVal = editingShot ? 15 : Math.min(15, remainingDuration);
                    setShotDuration(Math.min(maxVal, Math.max(1, parseInt(e.target.value) || 1)));
                  }}
                  className="w-14"
                  disabled={!editingShot && remainingDuration <= 0}
                />
                <span className="text-sm text-text-muted w-4">秒</span>
              </div>
            </div>

            {/* 运镜方式（多选） */}
            <div className="flex items-start gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0 pt-1">运镜方式</label>
              <Checkbox.Group
                value={shotMovements}
                onChange={handleMovementsChange}
                className="flex flex-wrap gap-x-3 gap-y-1 flex-1"
              >
                {CAMERA_MOVEMENTS.map((movement) => (
                  <Checkbox key={movement.id} value={movement.id}>
                    <Tooltip title={movement.description}>
                      <span className="text-xs">{movement.name}</span>
                    </Tooltip>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </div>

            {/* 镜头类型 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">镜头类型</label>
              <select
                value={shotType}
                onChange={(e) => setShotType(e.target.value as ShotType)}
                className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                {SHOT_TYPES.map((s) => (
                  <option key={s.id} value={s.id} title={s.description}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 摄像机角度 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">摄像机角度</label>
              <select
                value={shotAngle}
                onChange={(e) => setShotAngle(e.target.value as CameraAngle)}
                className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                {CAMERA_ANGLES.map((a) => (
                  <option key={a.id} value={a.id} title={a.description}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 灯光设定 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">灯光设定</label>
              <select
                value={shotLighting}
                onChange={(e) => setShotLighting(e.target.value as LightingType)}
                className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                {LIGHTING_TYPES.map((l) => (
                  <option key={l.id} value={l.id} title={l.description}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 氛围 */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-text-secondary w-20 flex-shrink-0">氛围</label>
              <select
                value={shotMood}
                onChange={(e) => setShotMood(e.target.value as MoodType)}
                className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-1.5 text-sm text-text-primary"
              >
                {MOOD_TYPES.map((m) => (
                  <option key={m.id} value={m.id} title={m.description}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 右侧：分镜提示词和参考图提示词 */}
          <div className="w-1/2 space-y-3">
            <div>
              <label className="text-sm text-text-secondary mb-2 block">
                分镜提示词 <span className="text-red-500">*</span>
              </label>
              {/* 参考附件上传（复刻 generate 页面输入框左侧的上传功能），位于标题下方、左对齐 */}
              <div className="mb-1 flex justify-start">
                <ReferenceThumbnails
                  references={shotReferenceAssets}
                  maxCount={REF_MAX_COUNT}
                  uploading={uploading}
                  uploadingType={uploadingType}
                  mode="image"
                  onRemove={handleRemoveAsset}
                  onPreview={handlePreviewAsset}
                  onOpenAvatarUpload={() => setUploadDialogOpen(true)}
                />
              </div>
              <VisualPromptEditor
                value={shotPrompt}
                onChange={setShotPrompt}
                characters={characters}
                scenes={scenes}
                referenceAssets={editorReferenceAssets}
                placeholder="描述此分镜的具体内容、动作、表情等，输入 @ 插入角色，输入 # 插入场景..."
                minRows={6}
                hintText="输入 @ 插入角色，输入 # 插入场景，输入 ! 引用道具/参考附件"
              />
            </div>
            <div>
              <label className="text-sm text-text-secondary mb-2 block">
                参考图提示词
                <Tooltip title="用于生成静态参考图的提示词，仅描述单一瞬间的定格画面。留空则自动使用分镜提示词生成。">
                  <span className="text-text-muted ml-1 cursor-help">(?)</span>
                </Tooltip>
              </label>
              <VisualPromptEditor
                value={shotReferencePrompt}
                onChange={setShotReferencePrompt}
                characters={characters}
                scenes={scenes}
                referenceAssets={editorReferenceAssets}
                placeholder="描述分镜的静态定格画面（无运镜）。留空则使用分镜提示词..."
                minRows={6}
              />
            </div>
          </div>
        </div>

        {/* 预览区 */}
        <Divider className="my-4" />
        <div className="bg-bg-tertiary rounded-lg p-3">
          <p className="text-xs text-text-muted mb-1">预览</p>
          <div
            className="text-sm text-text-secondary html-content max-h-32 overflow-y-auto"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(
                shotPrompt
                  ? generateShotPromptPreview({
                      id: '',
                      duration: shotDuration,
                      cameraMovements: shotMovements,
                      shotType,
                      cameraAngle: shotAngle,
                      lighting: shotLighting,
                      mood: shotMood,
                      prompt: shotPrompt,
                      referencePrompt: shotReferencePrompt,
                    })
                  : '请输入分镜提示词...'
              )
            }}
          />
        </div>
      </div>

      {/* 参考附件图片预览（点击图片附件缩略图放大，支持组内切换） */}
      <ImagePreview
        images={imageAssetUrls}
        visible={imgPreviewOpen}
        currentIndex={imgPreviewIndex}
        onClose={() => setImgPreviewOpen(false)}
        title="参考附件"
      />

      {/* 参考附件上传弹窗：与 generate 页面输入框左侧的上传弹窗保持一致 */}
      <AvatarUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onConfirm={async (file) => {
          await handleUploadAsset(file);
          setUploadDialogOpen(false);
        }}
        showAssetTab
        onSelectAsset={async (asset: UserMaterialItem) => {
          await addLibraryImageAsset(asset, '真人资产');
          setUploadDialogOpen(false);
        }}
        showCharacterLibraryTab
        onSelectCharacterAsset={async (asset: UserMaterialItem) => {
          await addLibraryImageAsset(asset, '角色素材');
          setUploadDialogOpen(false);
        }}
        showSceneLibraryTab
        onSelectSceneAsset={async (asset: UserMaterialItem) => {
          await addLibraryImageAsset(asset, '场景素材');
          setUploadDialogOpen(false);
        }}
        title="上传"
        uploadLabel="参考"
        okText="确认添加"
        allowMedia
      />
    </Modal>
  );
};
