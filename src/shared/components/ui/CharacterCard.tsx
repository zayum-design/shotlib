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

import { useEffect, useRef, useState, useMemo } from 'react';
import { Card, Input, Modal, Checkbox } from 'antd';
import type { Character } from '@/shared/types';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { ImagePreviewModal } from './ImagePreviewModal';
import { AvatarUploadDialog } from './AvatarUploadDialog';
import { useCharacterPortrait } from './hooks/useCharacterPortrait';
import { useImagePreview } from './hooks/useImagePreview';
import type { UserMaterialItem } from '@/shared/api/userMaterialApi';
import { localApi } from '@/storage';
import { syncWorkflowToCloudApi } from '@/modules/workflow/api/syncApi';
import { uploadFile } from '@/shared/utils/upload';
import { CharacterAvatarSection } from './CharacterAvatarSection';
import { CharacterPortraitGrid } from './CharacterPortraitGrid';
import { CharacterFullBodySection } from './CharacterFullBodySection';
import { CharacterPortraitDialog } from './CharacterPortraitDialog';
import { message } from '../../utils/message';
import { useResolvedImageUrls } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { assetDropTarget, type DraggedProjectAsset } from '@/shared/utils/assetDragDrop';

interface CharacterCardProps {
  character: Character;
}

export const CharacterCard: React.FC<CharacterCardProps> = ({ character }) => {
  // 只使用第一张头像，移除切换功能
  const firstAvatarIndex = 0;

  const {
    updateCharacter,
    updateCharacterFullBody,
    generateAvatar,
    generateCharacterViews,
    regenerateFullBody,
    generatePortrait,
    addPortraitImages,
    removePortraitImage,
    imageModels,
    currentProjectId,
    currentEpisodeNumber,
  } = useWorkflowStore();

  // 组件挂载时自动修复脏状态：如果之前生成失败导致 isGenerating 卡住，重置它
  useEffect(() => {
    const multiViewImage = character.multiViewImages?.[0];
    if (multiViewImage?.isGenerating && !character.isGeneratingViews) {
      updateCharacterFullBody(character.id, 0, { isGenerating: false }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id]);

  const [selectedViewsModel, setSelectedViewsModel] = useState(character.model);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullbodyFileInputRef = useRef<HTMLInputElement>(null);

  const {
    previewModalOpen,
    previewImages,
    previewCurrentIndex,
    previewTitle,
    openImagePreview,
    handlePreviewPrev,
    handlePreviewNext,
    closePreview,
  } = useImagePreview();

  const {
    portraitDialogOpen,
    avatarUploadDialogOpen,
    setAvatarUploadDialogOpen,
    portraitAssetDialogOpen,
    setPortraitAssetDialogOpen,
    portraitPrompt,
    setPortraitPrompt,
    portraitName,
    setPortraitName,
    generatedPortraitUrl,
    selectedPortraitModel,
    setSelectedPortraitModel,
    uploadPreviewUrls,
    isGeneratingPortrait,
    isConfirming,
    editingPortraitIndex,
    handleOpenPortraitDialog,
    handleClosePortraitDialog,
    handleGeneratePortrait,
    handleConfirmAddPortrait,
    handleFileSelect,
  } = useCharacterPortrait({
    character,
    generatePortrait,
    updateCharacterFullBody,
    addPortraitImages,
    projectId: currentProjectId,
    episodeNumber: currentEpisodeNumber,
    syncToCloud: async () => {
      const projectId = currentProjectId;
      if (!projectId || projectId === 'default') return;
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
          const updatedCharacters = state.characters.map((c) => {
            if (c.id !== character.id) return c;
            return {
              ...c,
              avatarImages: c.avatarImages?.map((img) => ({ ...img, imageUrl: img.imageUrl ? (urlMapping[img.imageUrl] || img.imageUrl) : img.imageUrl })),
              voiceUrl: c.voiceUrl ? (urlMapping[c.voiceUrl] || c.voiceUrl) : c.voiceUrl,
              multiViewImages: c.multiViewImages?.map((img) => ({
                ...img,
                imageUrl: img.imageUrl ? (urlMapping[img.imageUrl] || img.imageUrl) : img.imageUrl,
              })),
              fullBodyImages: c.fullBodyImages?.map((img) => ({
                ...img,
                imageUrl: img.imageUrl ? (urlMapping[img.imageUrl] || img.imageUrl) : img.imageUrl,
              })),
            };
          });
          useWorkflowStore.setState({ characters: updatedCharacters });
        }
      } catch (e) {
        console.error('[CharacterCard] 同步到云端失败:', e);
      }
    },
  });

  const handleModelChange = (model: string) => {
    updateCharacter(character.id, { model });
  };

  const handleGenerateAvatar = async () => {
    const hasAvatarImage = character.avatarImages?.some(img => img.imageUrl);
    const hasMultiViewImage = character.multiViewImages?.some(img => img.imageUrl);
    const hasPortraitImages = character.fullBodyImages?.some(img => img.imageUrl);
    if (hasAvatarImage && (hasMultiViewImage || hasPortraitImages)) {
      Modal.confirm({
        title: '更换头像',
        content: (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">头像生成后会导致多视图和形象照与新头像不匹配，请选择处理方式：</p>
            <Checkbox
              className="avatar-clear-checkbox"
              onChange={(e) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__avatarClearChecked = e.target.checked;
              }}
            >
              清空多视图和形象照
            </Checkbox>
          </div>
        ),
        okText: '确定',
        cancelText: '取消',
        onOk() {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const shouldClear = (window as any).__avatarClearChecked;
          if (shouldClear) {
            // 清空多视图和形象照，并软删除对应 image_asset
            softDeleteCharacterImageAssets([
              ...(character.multiViewImages || []),
              ...(character.fullBodyImages || []),
            ]);
            updateCharacter(character.id, buildAvatarClearUpdates());
          }
          // 不 await：弹窗立即关闭，头像生成在后台进行（角色卡片自身有生成中状态展示）
          generateAvatar(character.id);
        },
      });
    } else {
      await generateAvatar(character.id);
    }
  };

  const handleGenerateViews = async () => {
    // 使用当前显示的头像作为参考
    const avatarIndex = character.avatarImages && character.avatarImages.length > 0 ? firstAvatarIndex : undefined;
    await generateCharacterViews(character.id, avatarIndex, selectedViewsModel);
  };

  const handleRegenerateFullBody = async () => {
    await regenerateFullBody(character.id, 0, true);
  };

  // 从项目资产库拖入替换头像（asset 已是 image_asset 行，直接引用 assetId）
  // avatarSource 用 'generated'：资产库图片为项目内 AI 生成，角标应显示「虚拟」，
  // 用 'asset' 会被角标逻辑（asset + 无 assetType=character → 真人）误判为「真人」
  const handleDropAvatar = (asset: DraggedProjectAsset) => {
    const avatarImage = { assetId: asset.assetId, imageUrl: asset.url, name: '头像', isPortrait: true };
    const hasExistingAssets = character.multiViewImages?.some(img => img.imageUrl) || character.fullBodyImages?.some(img => img.imageUrl);
    if (hasExistingAssets) {
      Modal.confirm({
        title: '更换头像',
        content: '头像已更新，是否清空多视图和形象照？',
        okText: '是，清空',
        cancelText: '否，保留',
        onOk() {
          softDeleteCharacterImageAssets([
            ...(character.multiViewImages || []),
            ...(character.fullBodyImages || []),
          ]);
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'generated', ...buildAvatarClearUpdates() });
          message.success('已从资产库替换头像');
        },
        onCancel() {
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'generated' });
          message.success('已从资产库替换头像');
        },
      });
    } else {
      updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'generated' });
      message.success('已从资产库替换头像');
    }
  };

  // 从项目资产库拖入替换多视图（全身照）
  const handleDropMultiView = (asset: DraggedProjectAsset) => {
    updateCharacterFullBody(character.id, 0, { assetId: asset.assetId, imageUrl: asset.url, isGenerating: false, name: '人物多视图', isPortrait: false }, true);
    message.success('已从资产库替换多视图');
  };

  const handleRemovePortrait = (index: number) => {
    removePortraitImage(character.id, index);
  };

  // 本地上传头像 - 打开上传弹窗
  const handleOpenAvatarUpload = () => {
    setAvatarUploadDialogOpen(true);
  };

  // 清空多视图和形象照图片引用：
  // - 多视图：直接清空数组
  // - 形象照：保留元数据（name/prompt/episodeNumber），只清空 imageUrl 和 assetId
  const buildAvatarClearUpdates = (): Partial<Character> => {
    return {
      multiViewImages: [],
      fullBodyImages: (character.fullBodyImages || []).map((img) => ({
        ...img,
        imageUrl: '',
        assetId: '',
        isGenerating: false,
      })),
    };
  };

  // 软删除角色多视图和形象照对应的后端 image_asset
  const softDeleteCharacterImageAssets = (images: { assetId?: string; episodeNumber?: number }[]) => {
    const projectId = currentProjectId;
    if (!projectId || projectId === 'default') return;
    for (const img of images) {
      if (img?.assetId) {
        const assetEpisodeNumber = img.episodeNumber ?? currentEpisodeNumber;
        localApi.deleteProjectAsset(projectId, 'image_asset', img.assetId, assetEpisodeNumber).catch((e) => {
          console.error(`[softDeleteCharacterImageAssets] 软删除 image_asset 失败: ${img.assetId}`, e);
        });
      }
    }
  };

  // 为素材库/真人头像创建 image_asset，返回 assetId（持久化必需：character 行只存 assetId，
  // 刷新后由 hydrateCharacterImages 用 assetId 还原 imageUrl；缺 assetId 会刷新后丢失）
  const ensureAvatarImageAssetId = async (
    asset: UserMaterialItem,
    metadata: Record<string, any>,
    label: string,
  ): Promise<string> => {
    const projectId = currentProjectId;
    if (!projectId || projectId === 'default') return '';
    try {
      const res = await localApi.createImageAssets(projectId, {
        assets: [
          {
            episode_number: 0, // 角色头像为项目级资产
            asset_type: 'character_image',
            original_url: asset.sourceUrl,
            source: 'asset',
            metadata,
          },
        ],
      });
      const id = res?.data?.[0]?.id || '';
      if (!id) console.warn(`[${label}] createImageAssets 未返回 assetId`, res);
      return id;
    } catch (e) {
      console.error(`[${label}] createImageAssets 失败:`, e);
      return '';
    }
  };

  // 头像上传确认回调
  const handleAvatarUploadConfirm = async (file: File) => {
    const hasExistingAssets = character.multiViewImages?.some(img => img.imageUrl) || character.fullBodyImages?.some(img => img.imageUrl);
    if (hasExistingAssets) {
      Modal.confirm({
        title: '更换头像',
        content: '头像已更新，是否清空多视图和形象照？',
        okText: '是，清空',
        cancelText: '否，保留',
        async onOk() {
          // 关键修复：角色头像属于项目级资产（episode_number=0），跨集统一
          const result = await uploadFile(file, 'drama', 'avatar', { projectId: currentProjectId, assetType: 'character_image', episodeNumber: 0 });
          // 清空多视图和形象照，并软删除对应 image_asset
          softDeleteCharacterImageAssets([
            ...(character.multiViewImages || []),
            ...(character.fullBodyImages || []),
          ]);
          updateCharacter(character.id, { avatarImages: [{ assetId: result.assetId, imageUrl: result.url, name: "头像", isPortrait: true }], currentAvatarIndex: 0, avatarSource: 'upload', ...buildAvatarClearUpdates() });
          message.success('头像已上传');
        },
        async onCancel() {
          // 关键修复：角色头像属于项目级资产（episode_number=0），跨集统一
          const result = await uploadFile(file, 'drama', 'avatar', { projectId: currentProjectId, assetType: 'character_image', episodeNumber: 0 });
          updateCharacter(character.id, { avatarImages: [{ assetId: result.assetId, imageUrl: result.url, name: "头像", isPortrait: true }], currentAvatarIndex: 0, avatarSource: 'upload' });
          message.success('头像已上传');
        },
      });
    } else {
      // 关键修复：角色头像属于项目级资产（episode_number=0），跨集统一
      const result = await uploadFile(file, 'drama', 'avatar', { projectId: currentProjectId, assetType: 'character_image', episodeNumber: 0 });
      updateCharacter(character.id, { avatarImages: [{ assetId: result.assetId, imageUrl: result.url, name: "头像", isPortrait: true }], currentAvatarIndex: 0, avatarSource: 'upload' });
      message.success('头像已上传');
    }
  };

  // 从真人资产中选择头像
  const handleUserMaterialSelect = async (asset: UserMaterialItem) => {
    // 创建 image_asset 拿到 assetId，保证头像可持久化与刷新还原（修复刷新后头像丢失）
    const assetId = await ensureAvatarImageAssetId(
      asset,
      { source: 'user_asset', userAssetId: asset.id, name: asset.name },
      'handleUserMaterialSelect',
    );

    const avatarImage = { assetId, imageUrl: asset.sourceUrl, name: asset.name || '头像', isPortrait: true };

    const hasExistingAssets = character.multiViewImages?.some(img => img.imageUrl) || character.fullBodyImages?.some(img => img.imageUrl);
    if (hasExistingAssets) {
      Modal.confirm({
        title: '更换头像',
        content: '头像已更新，是否清空多视图和形象照？',
        okText: '是，清空',
        cancelText: '否，保留',
        async onOk() {
          // 清空多视图和形象照，并软删除对应 image_asset
          softDeleteCharacterImageAssets([
            ...(character.multiViewImages || []),
            ...(character.fullBodyImages || []),
          ]);
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset', ...buildAvatarClearUpdates() });
          setAvatarUploadDialogOpen(false);
          message.success('已使用真人资产作为头像');
        },
        onCancel() {
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset' });
          setAvatarUploadDialogOpen(false);
          message.success('已使用真人资产作为头像');
        },
      });
    } else {
      updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset' });
      setAvatarUploadDialogOpen(false);
      message.success('已使用真人资产作为头像');
    }
  };

  // 从素材库中选择头像（character 类型）
  const buildAvatarFromCharacterAsset = (asset: UserMaterialItem) => ({
    imageUrl: asset.sourceUrl,
    name: asset.name || '头像',
    isPortrait: true,
    // 素材库关联数据
    userAssetId: asset.id,
    assetType: asset.assetType,
  });

  const handleCharacterAssetSelect = async (asset: UserMaterialItem) => {
    // 创建 image_asset 拿到 assetId，保证头像可持久化与刷新还原（修复刷新后头像丢失）
    const assetId = await ensureAvatarImageAssetId(
      asset,
      { source: 'user_asset', userAssetId: asset.id, name: asset.name },
      'handleCharacterAssetSelect',
    );

    const avatarImage = { ...buildAvatarFromCharacterAsset(asset), assetId };
    const hasExistingAssets = character.multiViewImages?.some(img => img.imageUrl) || character.fullBodyImages?.some(img => img.imageUrl);
    if (hasExistingAssets) {
      Modal.confirm({
        title: '更换头像',
        content: '头像已更新，是否清空多视图和形象照？',
        okText: '是，清空',
        cancelText: '否，保留',
        async onOk() {
          // 清空多视图和形象照，并软删除对应 image_asset
          softDeleteCharacterImageAssets([
            ...(character.multiViewImages || []),
            ...(character.fullBodyImages || []),
          ]);
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset', ...buildAvatarClearUpdates() });
          setAvatarUploadDialogOpen(false);
          message.success('已使用素材库图片作为头像');
        },
        onCancel() {
          updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset' });
          setAvatarUploadDialogOpen(false);
          message.success('已使用素材库图片作为头像');
        },
      });
    } else {
      updateCharacter(character.id, { avatarImages: [avatarImage], currentAvatarIndex: 0, avatarSource: 'asset' });
      setAvatarUploadDialogOpen(false);
      message.success('已使用素材库图片作为头像');
    }
  };

  // 从真人资产中选择形象照
  const handlePortraitAssetSelect = async (asset: UserMaterialItem) => {
    // 关键修复：不传 name，让 store addPortraitImages 按 actualIndex 自动生成唯一名
    // （如"形象照 1"、"形象照 2"），避免多次添加时全部显示为同一个名字
    addPortraitImages(character.id, [{
      imageUrl: asset.sourceUrl,
      prompt: '',
    }]);
    message.success('已添加真人形象照');
    setPortraitAssetDialogOpen(false);
  };

  // 本地上传全身照
  const handleFullbodyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // 关键修复：角色全身照属于项目级资产（episode_number=0），跨集统一
      const result = await uploadFile(file, 'drama', 'fullbody', { projectId: currentProjectId, assetType: 'character_image', episodeNumber: 0 });
      updateCharacterFullBody(character.id, 0, { assetId: result.assetId, imageUrl: result.url, isGenerating: false, name: '人物多视图', isPortrait: false }, true);
      message.success('全身照已上传');
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '全身照上传失败');
    }
    e.target.value = '';
  };

  // 批量解析当前角色的所有图片资产
  const allAssetIds = useMemo(() => {
    const ids: string[] = [];
    character.avatarImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
    character.multiViewImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
    character.fullBodyImages?.forEach((img) => { if (img.assetId) ids.push(img.assetId); });
    return ids;
  }, [character.avatarImages, character.multiViewImages, character.fullBodyImages]);
  const { getUrl } = useResolvedImageUrls(allAssetIds);

  const handlePreviewPortrait = (index: number) => {
    const img = character.fullBodyImages?.[index];
    const resolvedUrl = getUrl(img?.assetId) || img?.imageUrl;
    if (!resolvedUrl) return;
    openImagePreview(resolvedUrl, `${character.name} - ${img?.name || '形象照'}`);
  };

  const openAvatarPreview = () => {
    const urls = character.avatarImages?.map((img) => getUrl(img.assetId) || img.imageUrl).filter((url): url is string => !!url) || [];
    if (urls.length === 0) return;
    openImagePreview(urls[firstAvatarIndex], `${character.name} - 头像`);
  };

  const openFullBodyPreview = () => {
    const urls = multiViewImages.map((img) => getUrl(img.assetId) || img.imageUrl).filter((url): url is string => !!url);
    if (urls.length === 0) return;
    openImagePreview(urls[0], `${character.name} - 全身照`);
  };

  // 获取全身照数据（现只有1张）
  const multiViewImages = character.multiViewImages || [];
  const multiViewImage = multiViewImages[0];
  const hasFullBody = !!multiViewImage?.imageUrl;
  const isGeneratingFullBody = multiViewImage?.isGenerating || character.isGeneratingViews;

  return (
    <>
      <Card className="bg-bg-secondary border-border rounded-xl overflow-hidden">
        {/* 主体：左右分栏布局 */}
        <div className="flex gap-5 items-start">
          {/* 左侧：角色信息与头像 */}
          <div className="flex-1 min-w-0">
            {/* 头像 + 名称/描述/操作（支持从项目资产库拖入替换头像） */}
            <div {...assetDropTarget(['character_image'], '头像', handleDropAvatar)}>
              <CharacterAvatarSection
                character={character}
                firstAvatarIndex={firstAvatarIndex}
                imageModels={imageModels}
                onUpdateCharacter={updateCharacter}
                onModelChange={handleModelChange}
                onGenerateAvatar={handleGenerateAvatar}
                onOpenAvatarUpload={handleOpenAvatarUpload}
                onAvatarPreview={openAvatarPreview}
              />
            </div>

            {/* 头像提示词 */}
            <div className="flex items-start gap-2 mb-3">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">头像提示词</span>
              <Input.TextArea
                value={character.avatarPrompt}
                onChange={(e) => updateCharacter(character.id, { avatarPrompt: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="请输入头像生成提示词"
              />
            </div>

            {/* 全身提示词 */}
            <div className="flex items-start gap-2">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">全身提示词</span>
              <Input.TextArea
                value={character.imagePrompt}
                onChange={(e) => updateCharacter(character.id, { imagePrompt: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="请输入全身照生成提示词"
              />
            </div>

            {/* 音色提示词 */}
            <div className="flex items-start gap-2 mt-3">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">音色提示词</span>
              <Input.TextArea
                value={character.voicePrompt || ''}
                onChange={(e) => updateCharacter(character.id, { voicePrompt: e.target.value })}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="描述角色的声音特征，如：年轻女性，普通话，语速中等，温柔细腻..."
              />
            </div>
          </div>

          {/* 右侧：全身照展示（支持从项目资产库拖入替换多视图） */}
          <div className="w-44 sm:w-48 md:w-52 flex-shrink-0 flex flex-col">
            <div {...assetDropTarget(['character_image'], '多视图', handleDropMultiView)}>
              <CharacterFullBodySection
              character={character}
              fullBodyImage={multiViewImage}
              hasFullBody={hasFullBody}
              isGeneratingFullBody={!!isGeneratingFullBody}
              imageModels={imageModels}
              selectedViewsModel={selectedViewsModel}
              setSelectedViewsModel={setSelectedViewsModel}
              fullbodyFileInputRef={fullbodyFileInputRef}
              onGenerateViews={handleGenerateViews}
              onRegenerateFullBody={handleRegenerateFullBody}
              onFullbodyUpload={handleFullbodyUpload}
              onFullBodyPreview={openFullBodyPreview}
            />
            </div>
          </div>
        </div>

        {/* 形象照网格：独占卡片整行宽度，保证一行 5 个尺寸可用 */}
        <CharacterPortraitGrid
          character={character}
          onOpenPortraitDialog={handleOpenPortraitDialog}
          onRemovePortrait={handleRemovePortrait}
          onPreviewPortrait={handlePreviewPortrait}
        />
      </Card>

      {/* 形象照添加弹窗 */}
      <CharacterPortraitDialog
        character={character}
        open={portraitDialogOpen}
        editingPortraitIndex={editingPortraitIndex}
        isGeneratingPortrait={isGeneratingPortrait}
        generatedPortraitUrl={generatedPortraitUrl}
        uploadPreviewUrls={uploadPreviewUrls}
        isConfirming={isConfirming}
        portraitName={portraitName}
        setPortraitName={setPortraitName}
        portraitPrompt={portraitPrompt}
        setPortraitPrompt={setPortraitPrompt}
        selectedPortraitModel={selectedPortraitModel}
        setSelectedPortraitModel={setSelectedPortraitModel}
        imageModels={imageModels}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        onClose={handleClosePortraitDialog}
        onConfirm={handleConfirmAddPortrait}
        onGenerate={handleGeneratePortrait}
        firstAvatarIndex={firstAvatarIndex}
      />

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={previewModalOpen}
        images={previewImages}
        currentIndex={previewCurrentIndex}
        onClose={closePreview}
        onPrev={handlePreviewPrev}
        onNext={handlePreviewNext}
        title={previewTitle}
      />

      {/* 本地上传头像弹窗 */}
      <AvatarUploadDialog
        open={avatarUploadDialogOpen}
        onClose={() => setAvatarUploadDialogOpen(false)}
        onConfirm={handleAvatarUploadConfirm}
        showAssetTab
        onSelectAsset={handleUserMaterialSelect}
        showCharacterLibraryTab
        onSelectCharacterAsset={handleCharacterAssetSelect}
        title="选择头像图片来源"
        okText="确认"
        uploadLabel="头像"
      />

      {/* 形象照真人资产选择弹窗（头像是真人时使用） */}
      <AvatarUploadDialog
        open={portraitAssetDialogOpen}
        onClose={() => setPortraitAssetDialogOpen(false)}
        onConfirm={async () => {}}
        showAssetTab
        hideLocalTab
        onSelectAsset={handlePortraitAssetSelect}
        title="选择形象照图片来源"
        okText="确认"
        uploadLabel="形象照"
      />
    </>
  );
};
