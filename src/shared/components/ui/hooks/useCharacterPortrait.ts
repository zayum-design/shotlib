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

import { useState, useCallback } from 'react';
import { shouldPreview } from '@/modules/workflow/stores/workflowStore';
import { localApi } from '@/storage';
import { uploadFile } from '@/shared/utils/upload';
import type { Character } from '../../../types';
import { message } from '../../../utils/message';

interface UseCharacterPortraitOptions {
  character: Character;
  generatePortrait: (characterId: string, portraitPrompt: string, model?: string, name?: string) => Promise<{ imageUrl: string; assetId?: string } | null>;
  updateCharacterFullBody: (id: string, index: number, data: Partial<unknown>) => void;
  addPortraitImages: (id: string, images: { imageUrl: string; assetId?: string; prompt: string; name: string; episodeNumber?: number }[]) => void;
  projectId: string;
  episodeNumber: number;
  syncToCloud: () => Promise<void>;
}

export function useCharacterPortrait({
  character,
  generatePortrait,
  updateCharacterFullBody,
  addPortraitImages,
  projectId,
  episodeNumber,
  syncToCloud,
}: UseCharacterPortraitOptions) {
  const [portraitDialogOpen, setPortraitDialogOpen] = useState(false);
  const [avatarUploadDialogOpen, setAvatarUploadDialogOpen] = useState(false);
  const [portraitAssetDialogOpen, setPortraitAssetDialogOpen] = useState(false);
  const [portraitPrompt, setPortraitPrompt] = useState('');
  const [portraitName, setPortraitName] = useState('');
  const [generatedPortraitUrl, setGeneratedPortraitUrl] = useState<string>('');
  const [generatedPortraitAssetId, setGeneratedPortraitAssetId] = useState<string>('');
  const [selectedPortraitModel, setSelectedPortraitModel] = useState(character.model);
  const [uploadPreviewUrls, setUploadPreviewUrls] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [editingPortraitIndex, setEditingPortraitIndex] = useState<number | null>(null);

  const handleOpenPortraitDialog = useCallback(
    (index?: number) => {
      if (index === undefined && character.avatarSource === 'asset') {
        setPortraitAssetDialogOpen(true);
        return;
      }

      if (index !== undefined) {
        const img = character.fullBodyImages?.[index];
        setPortraitPrompt(img?.prompt || character.imagePrompt || '');
        setPortraitName(img?.name || '');
        setEditingPortraitIndex(index);
        setGeneratedPortraitUrl(img?.imageUrl || '');
      } else {
        setPortraitPrompt(character.imagePrompt || '');
        setPortraitName('');
        setEditingPortraitIndex(null);
        setGeneratedPortraitUrl('');
      }
      setSelectedPortraitModel(character.model);
      setUploadPreviewUrls([]);
      setPortraitDialogOpen(true);
    },
    [character],
  );

  const handleClosePortraitDialog = useCallback(() => {
    uploadPreviewUrls.forEach((url) => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    setPortraitDialogOpen(false);
    setUploadPreviewUrls([]);
    setSelectedFiles([]);
    setGeneratedPortraitUrl('');
    setGeneratedPortraitAssetId('');
    setPortraitName('');
    setEditingPortraitIndex(null);
  }, [uploadPreviewUrls]);

  const handleGeneratePortrait = useCallback(async () => {
    if (!portraitPrompt.trim()) {
      message.warning('请输入提示词');
      return;
    }
    setIsGeneratingPortrait(true);
    try {
      const result = await generatePortrait(character.id, portraitPrompt.trim(), selectedPortraitModel, portraitName.trim() || undefined);
      if (result) {
        setGeneratedPortraitUrl(result.imageUrl);
        setGeneratedPortraitAssetId(result.assetId || '');
      }
    } catch {
      // ignore
    } finally {
      setIsGeneratingPortrait(false);
    }
  }, [character.id, portraitPrompt, portraitName, selectedPortraitModel, generatePortrait]);

  const handleConfirmAddPortrait = useCallback(async () => {
    if (!generatedPortraitUrl && selectedFiles.length === 0) return;
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      if (selectedFiles.length > 0) {
        const results = await Promise.all(
          // 形象照按当前分集隔离上传
          selectedFiles.map((file) => uploadFile(file, 'drama', 'portrait', { projectId, assetType: 'character_image', episodeNumber })),
        );
        if (editingPortraitIndex !== null && results.length === 1) {
          updateCharacterFullBody(character.id, editingPortraitIndex, {
            assetId: results[0].assetId,
            imageUrl: results[0].url,
            prompt: portraitPrompt,
            name: portraitName || results[0].filename,
            episodeNumber,
          });
          message.success('形象照已更新');
        } else {
          const images = results.map((r) => ({
            assetId: r.assetId,
            imageUrl: r.url,
            prompt: portraitPrompt,
            name: portraitName || r.filename,
            episodeNumber,
          }));
          addPortraitImages(character.id, images);
          message.success(`已添加 ${results.length} 张形象照`);
        }
      } else if (generatedPortraitUrl) {
        let portraitAssetId = generatedPortraitAssetId;
        let portraitImageUrl = generatedPortraitUrl;

        // 形象照仅在确认添加时才创建 image_asset 资产行
        if (!portraitAssetId && projectId && projectId !== 'default') {
          const assetRes = await localApi.createImageAssets(projectId, {
            assets: [{
              episode_number: episodeNumber,
              asset_type: 'character_image',
              original_url: generatedPortraitUrl,
              source: 'ai',
              metadata: {
                prompt: portraitPrompt,
                name: portraitName,
                characterId: character.id,
              },
            }],
          });
          if (!assetRes.success || !assetRes.data?.length) {
            throw new Error('创建图片资产失败');
          }
          const created = assetRes.data[0] as any;
          portraitAssetId = created.id;
          portraitImageUrl = created.data?.original_url || generatedPortraitUrl;
        }

        if (editingPortraitIndex !== null) {
          updateCharacterFullBody(character.id, editingPortraitIndex, {
            imageUrl: portraitImageUrl,
            assetId: portraitAssetId || character.fullBodyImages?.[editingPortraitIndex]?.assetId,
            prompt: portraitPrompt,
            name: portraitName || character.fullBodyImages?.[editingPortraitIndex]?.name,
            episodeNumber,
          });
          message.success('形象照已更新');
        } else {
          addPortraitImages(character.id, [{ imageUrl: portraitImageUrl, assetId: portraitAssetId, prompt: portraitPrompt, name: portraitName, episodeNumber }]);
          message.success('形象照已添加');
        }
      }
      handleClosePortraitDialog();
      await syncToCloud();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsConfirming(false);
    }
  }, [
    character.id,
    character.fullBodyImages,
    generatedPortraitUrl,
    selectedFiles,
    editingPortraitIndex,
    portraitPrompt,
    portraitName,
    projectId,
    episodeNumber,
    updateCharacterFullBody,
    addPortraitImages,
    syncToCloud,
    handleClosePortraitDialog,
  ]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const remainingSlots = editingPortraitIndex !== null ? 1 : 9 - (character.fullBodyImages?.filter((img) => img.imageUrl).length || 0);
      const validFiles = Array.from(files).slice(0, remainingSlots);

      const previewUrls = validFiles.map((f) => URL.createObjectURL(f));
      setUploadPreviewUrls(previewUrls);
      setSelectedFiles(validFiles);
    },
    [character.fullBodyImages, editingPortraitIndex],
  );

  return {
    portraitDialogOpen,
    setPortraitDialogOpen,
    avatarUploadDialogOpen,
    setAvatarUploadDialogOpen,
    portraitAssetDialogOpen,
    setPortraitAssetDialogOpen,
    portraitPrompt,
    setPortraitPrompt,
    portraitName,
    setPortraitName,
    generatedPortraitUrl,
    setGeneratedPortraitUrl,
    selectedPortraitModel,
    setSelectedPortraitModel,
    uploadPreviewUrls,
    setUploadPreviewUrls,
    selectedFiles,
    setSelectedFiles,
    isGeneratingPortrait,
    setIsGeneratingPortrait,
    isConfirming,
    editingPortraitIndex,
    setEditingPortraitIndex,
    handleOpenPortraitDialog,
    handleClosePortraitDialog,
    handleGeneratePortrait,
    handleConfirmAddPortrait,
    handleFileSelect,
  };
}
