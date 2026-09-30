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

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal, Button, Tooltip, Select, Spin, Input, Checkbox } from 'antd';
import { User, Scan, Trash2, RefreshCw, Plus, ZoomIn, Upload, Image as ImageIcon, Sparkles } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import type { UserMaterialItem } from '@/shared/api/userMaterialApi';
import { localApi } from '@/storage';
import { persistInstantData } from '@/modules/instant/utils/instantStorageUtils';
import { saveInstantToServer } from '@/modules/instant/utils/instantSyncUtils';
import { removePortraitFromSegments } from '@/modules/instant/utils/instantPromptUtils';
import { generateCharacterPortraitApi, generateCharacterViewsApi, generateAvatarApi } from '@/modules/workflow/api/characterApi';
import { generatePortraitPromptApi } from '@/modules/workflow/api/sceneApi';
import { pollJobStatus } from '@/modules/workflow/api/aiJobApi';
import type { UseInstantCreatePageReturn } from '../../hooks/UseInstantCreatePageReturn';
import type { InstantCharacter } from '@/shared/types/project';
import { message } from '@/shared/utils/message';
import { uploadFile } from '@/shared/utils/upload';
import { AvatarUploadDialog } from '@/shared/components/ui/AvatarUploadDialog';

interface Props {
  page: UseInstantCreatePageReturn;
}

/**
 * 角色多视图 / 完整编辑器（参照剧本 CharacterCard 布局）
 * - 左侧：头像 + 名称/描述/模型/重生成/上传 + 头像/全身/音色 提示词 + 形象照网格
 * - 右侧：多视图展示 + 模型 + 重新生成/本地上传
 */
export const MultiViewModal: React.FC<Props> = ({ page }) => {
  const char = page.multiViewChar;

  // 头像上传弹窗（本地上传 / 真人资产 / 素材库 三来源）
  const [avatarUploadDialogOpen, setAvatarUploadDialogOpen] = useState(false);

  // 形象照添加/编辑对话框状态
  const [portraitDialogOpen, setPortraitDialogOpen] = useState(false);
  const [portraitTitle, setPortraitTitle] = useState('');
  const [portraitPrompt, setPortraitPrompt] = useState('');
  const [portraitModel, setPortraitModel] = useState(page.portraitDialogModel);
  const [portraitPreviewUrl, setPortraitPreviewUrl] = useState('');
  const [portraitGenerating, setPortraitGenerating] = useState(false);
  const [editingPortraitIndex, setEditingPortraitIndex] = useState<number | null>(null);

  // AI 生成形象提示词相关状态
  const [portraitTextModel, setPortraitTextModel] = useState(page.defaultTextModel);
  const [isGeneratingPortraitPrompt, setIsGeneratingPortraitPrompt] = useState(false);

  // 根据形象标题，使用文本模型生成形象提示词
  const handleGeneratePortraitPrompt = async () => {
    if (!portraitTitle.trim()) {
      message.warning('请先输入形象标题');
      return;
    }
    if (!portraitTextModel) {
      message.warning('请选择文本模型');
      return;
    }
    if (isGeneratingPortraitPrompt) return;
    setIsGeneratingPortraitPrompt(true);
    try {
      const res = await generatePortraitPromptApi(portraitTextModel, portraitTitle.trim());
      if (res.success && res.data?.prompt) {
        setPortraitPrompt(res.data.prompt);
        message.success('提示词已生成');
      } else {
        message.error(res.message || '生成提示词失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成提示词失败');
    } finally {
      setIsGeneratingPortraitPrompt(false);
    }
  };

  // 视图提示词和模型（局部状态，确保与 page.viewsPrompt/viewsModel 分离避免冲突）
  const [localViewsPrompt, setLocalViewsPrompt] = useState(page.viewsPrompt);
  const [localViewsModel, setLocalViewsModel] = useState(page.viewsModel);
  const [isGeneratingViews, setIsGeneratingViews] = useState(false);
  const fullbodyFileInputRef = useRef<HTMLInputElement>(null);
  // 重新生成头像时，二次确认中「清空多视图/形象图」复选框状态
  const clearFullBodyRef = useRef(false);
  const clearPortraitRef = useRef(false);

  // 同步 localViewsPrompt/viewsModel
  useEffect(() => {
    setLocalViewsPrompt(page.viewsPrompt);
  }, [page.viewsPrompt]);

  useEffect(() => {
    setLocalViewsModel(page.viewsModel);
  }, [page.viewsModel]);

  // image_to_image 模型
  const imageToImageModels = useMemo(
    () => page.imageModels.filter((m) => m.supports?.image_to_image === true),
    [page.imageModels],
  );
  const defaultImageToImageModel = useMemo(() => {
    const found = imageToImageModels.find((m) => m.id === localViewsModel);
    return found?.id || imageToImageModels[0]?.id || localViewsModel;
  }, [imageToImageModels, localViewsModel]);

  if (!char) {
    return (
      <Modal
        open={page.multiViewOpen}
        onCancel={() => page.setMultiViewOpen(false)}
        footer={null}
        width={1000}
        centered
        title="多视图"
      >
        <div className="py-8 text-center text-text-muted">未选择角色</div>
      </Modal>
    );
  }

  // === 数据更新工具 ===
  const updateCharField = (fieldOrFields: string | Record<string, unknown>, value?: unknown) => {
    const fields = typeof fieldOrFields === 'string' ? { [fieldOrFields]: value } : fieldOrFields;
    // 合并为一次更新，避免多次 setCharacters 因闭包拿到旧的 page.characters 而互相覆盖
    const next = page.characters.map((c) =>
      c.id === char.id ? { ...c, ...fields } : c
    );
    page.saveCharacters(next);
    // 同步 multiViewChar
    page.setMultiViewChar((prev) => (prev ? { ...prev, ...fields } : null));
  };

  // === 头像上传（本地上传 / 真人资产 / 素材库）相关 ===
  // 为真人资产/素材库头像创建 image_asset，返回 assetId（用于持久化与刷新还原）
  const ensureAvatarImageAssetId = async (
    asset: UserMaterialItem,
    metadata: Record<string, unknown>,
    label: string,
  ): Promise<string> => {
    if (!page.projectId || page.projectId === 'default') return '';
    try {
      const res = await localApi.createImageAssets(page.projectId, {
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

  // 应用新头像：回填 avatarImages/avatar，可选清空多视图/形象照（参照 executeRegenerateAvatar 的置空模式），并立即同步服务器
  const applyNewAvatar = (
    avatarImage: { assetId?: string; imageUrl: string; name: string; isPortrait: boolean; userAssetId?: number; assetType?: string; isCompliant?: boolean },
  ) => {
    const hasFullBody = char.fullBodyImages?.some((img) => img.imageUrl);
    const hasPortraits = char.portraitImages?.some((img) => img.imageUrl);

    const doApply = (clearFullBody: boolean, clearPortraits: boolean) => {
      const updates: Record<string, unknown> = {
        avatarImages: [avatarImage],
        avatar: avatarImage.imageUrl,
      };
      if (clearFullBody) {
        updates.fullBodyImages = (char.fullBodyImages || []).map((img) => ({ ...img, imageUrl: '', isGenerating: false }));
      }
      if (clearPortraits) {
        updates.portraitImages = (char.portraitImages || []).map((img) => ({ ...img, imageUrl: '', isGenerating: false }));
      }
      updateCharField(updates);
      // 清除被清空图片的前端缓存，保持数据一致
      if (clearFullBody) {
        (char.fullBodyImages || []).forEach((img) => {
          if (img.assetId) localApi.invalidateCachedImageData(img.assetId);
        });
      }
      if (clearPortraits) {
        (char.portraitImages || []).forEach((img) => {
          if (img.assetId) localApi.invalidateCachedImageData(img.assetId);
        });
      }
      // 立即同步服务器，确保关闭/刷新后仍为新图
      if (page.projectId && page.projectId !== 'default') {
        const nextChar = { ...char, ...updates } as InstantCharacter;
        const nextChars = page.characters.map((c) => (c.id === char.id ? nextChar : c));
        saveInstantToServer(page.projectId, {
          instantCharacters: nextChars,
          instantScenes: page.scenes,
          instantSegments: page.segments,
        }).catch((e) => console.warn('[MultiViewModal] 立即保存失败', e));
      }
    };

    if (hasFullBody || hasPortraits) {
      clearFullBodyRef.current = false;
      clearPortraitRef.current = false;
      Modal.confirm({
        title: '更换头像',
        content: (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">头像更换后可能导致多视图和形象照与新头像不匹配，请选择需要清空的内容：</p>
            <div className="flex flex-col gap-2">
              {hasFullBody && (
                <Checkbox onChange={(e) => { clearFullBodyRef.current = e.target.checked; }}>清空多视图</Checkbox>
              )}
              {hasPortraits && (
                <Checkbox onChange={(e) => { clearPortraitRef.current = e.target.checked; }}>清空形象图</Checkbox>
              )}
            </div>
          </div>
        ),
        okText: '确定',
        cancelText: '取消',
        onOk() {
          doApply(clearFullBodyRef.current, clearPortraitRef.current);
        },
      });
    } else {
      doApply(false, false);
    }
  };

  // 本地上传头像（弹窗「本地上传」tab 确认）
  const handleAvatarUploadConfirm = async (file: File) => {
    const result = await uploadFile(file, 'drama', 'avatar', {
      projectId: page.projectId,
      assetType: 'character_image',
      episodeNumber: 0,
    });
    applyNewAvatar({ assetId: result.assetId, imageUrl: result.url, name: '头像', isPortrait: true });
    message.success('头像已上传');
  };

  // 从真人资产选择头像（弹窗「我的真人资产」tab）
  const handleUserMaterialSelect = async (asset: UserMaterialItem) => {
    const assetId = await ensureAvatarImageAssetId(
      asset,
      { source: 'user_asset', userAssetId: asset.id, name: asset.name },
      'handleUserMaterialSelect',
    );
    applyNewAvatar({ assetId, imageUrl: asset.sourceUrl, name: asset.name || '头像', isPortrait: true });
    setAvatarUploadDialogOpen(false);
    message.success('已使用真人资产作为头像');
  };

  // 从素材库选择头像（弹窗「我的素材库」tab，character 类型）
  const buildAvatarFromCharacterAsset = (asset: UserMaterialItem) => ({
    imageUrl: asset.sourceUrl,
    name: asset.name || '头像',
    isPortrait: true,
    userAssetId: asset.id,
    assetType: asset.assetType,
  });

  const handleCharacterAssetSelect = async (asset: UserMaterialItem) => {
    const assetId = await ensureAvatarImageAssetId(
      asset,
      { source: 'user_asset', userAssetId: asset.id, name: asset.name },
      'handleCharacterAssetSelect',
    );
    applyNewAvatar({ ...buildAvatarFromCharacterAsset(asset), assetId });
    setAvatarUploadDialogOpen(false);
    message.success('已使用素材库图片作为头像');
  };


  // === 真正提交头像生成 ===
  const executeRegenerateAvatar = async (
    prompt: string,
    clearFullBody: boolean,
    clearPortraits: boolean,
  ) => {
    // 真正生成时才设置 loading（预览模式下用户点「发送」后才进入此处）
    updateCharField('isGeneratingAvatar', true);
    try {
      const res = await generateAvatarApi(char.id, prompt, char.model, undefined, undefined, false, true);
      if (!res.success) {
        message.error('头像生成提交失败');
        return;
      }
      const jobData = res.data as { jobId?: string; avatarUrls?: string[] } | undefined;
      let urls: string[] = [];
      if (jobData?.jobId) {
        const poll = await pollJobStatus<{ avatarUrls?: string[] }>(jobData.jobId, { interval: 3000, maxWaitTime: 5 * 60 * 1000 });
        if (!poll.success) { message.error(poll.error || '头像生成失败'); return; }
        urls = poll.data?.avatarUrls || [];
      } else {
        urls = jobData?.avatarUrls || [];
      }
      if (urls.length > 0) {
        const newImages = urls.map((url) => ({ imageUrl: url, name: '头像', isPortrait: true, prompt }));
        const updates: Partial<InstantCharacter> = { avatarImages: newImages, avatar: urls[0] };
        // 清空时只置空 URL，保留 id/assetId；后端保存时会按原始格式重写 data
        if (clearFullBody) {
          updates.fullBodyImages = (char.fullBodyImages || []).map((img) => ({
            ...img,
            imageUrl: '',
            isGenerating: false,
          }));
        }
        if (clearPortraits) {
          updates.portraitImages = (char.portraitImages || []).map((img) => ({
            ...img,
            imageUrl: '',
            isGenerating: false,
          }));
        }
        // 清除前端缓存：头像（char.id）+ 被清空的形象照/多视图（assetId 保留），
        // 无需刷新页面（后端 data 已重写，前端缓存需同步）
        localApi.invalidateCachedImageData(char.id);
        if (clearFullBody) {
          (char.fullBodyImages || []).forEach((img) => {
            if (img.assetId) localApi.invalidateCachedImageData(img.assetId);
          });
        }
        if (clearPortraits) {
          (char.portraitImages || []).forEach((img) => {
            if (img.assetId) localApi.invalidateCachedImageData(img.assetId);
          });
        }
        updateCharField(updates);
        // 立即同步到服务器，确保后端按原始格式重写 data，不等防抖
        if (page.projectId && page.projectId !== 'default') {
          const nextChar = { ...char, ...updates } as InstantCharacter;
          const nextChars = page.characters.map((c) => (c.id === char.id ? nextChar : c));
          saveInstantToServer(page.projectId, {
            instantCharacters: nextChars,
            instantScenes: page.scenes,
            instantSegments: page.segments,
          }).catch((e) => console.warn('[MultiViewModal] 立即保存失败', e));
        }
        message.success('头像已更新');
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: any) {
      message.error(err?.message || '头像生成失败');
    } finally {
      updateCharField('isGeneratingAvatar', false);
    }
  };

  // === 重新生成头像 ===
  const handleRegenerateAvatar = async () => {
    if (!char.avatarPrompt?.trim() && !char.name) {
      message.warning('请先填写头像提示词');
      return;
    }
    const prompt = char.avatarPrompt?.trim() || `${char.name}，${char.gender}，${char.personality || ''}。高清头像，正面照。`;
    const hasFullBody = char.fullBodyImages?.some((img) => img.imageUrl);
    const hasPortraits = char.portraitImages?.some((img) => img.imageUrl);

    const startGenerate = async (clearFullBody: boolean, clearPortraits: boolean) => {
      try {
        if (page.apiPreviewMode) {
          // 预览模式：先弹出请求 JSON 预览 dialog，点击发送后再真正提交
          // loading 由 executeRegenerateAvatar 内部管理（用户点「发送」后才进入）
          await page.showApiPreview(
            '头像生成请求预览',
            generateAvatarApi(char.id, prompt, char.model, undefined, undefined, true, true),
            { endpoint: `/api/creator/character/${char.id}/avatar`, body: { avatarPrompt: prompt, model: char.model } },
            () => executeRegenerateAvatar(prompt, clearFullBody, clearPortraits),
          );
        } else {
          await executeRegenerateAvatar(prompt, clearFullBody, clearPortraits);
        }
      } catch (err: any) {
        message.error(err?.message || '头像生成失败');
      }
    };

    // 仅当存在多视图或形象图时，才弹出二次确认让用户选择清空内容
    if (hasFullBody || hasPortraits) {
      clearFullBodyRef.current = false;
      clearPortraitRef.current = false;
      Modal.confirm({
        title: '更换头像',
        content: (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">头像生成后会导致多视图和形象照与新头像不匹配，请选择需要清空的内容：</p>
            <div className="flex flex-col gap-2">
              {hasFullBody && (
                <Checkbox
                  onChange={(e) => {
                    clearFullBodyRef.current = e.target.checked;
                  }}
                >
                  清空多视图
                </Checkbox>
              )}
              {hasPortraits && (
                <Checkbox
                  onChange={(e) => {
                    clearPortraitRef.current = e.target.checked;
                  }}
                >
                  清空形象图
                </Checkbox>
              )}
            </div>
          </div>
        ),
        okText: '确定',
        cancelText: '取消',
        onOk() {
          // 立即关闭二次确认 dialog，生成在后台进行
          // （父 dialog 中重生成头像按钮 loading + 头像图片占位 loading）
          const clearFullBody = clearFullBodyRef.current;
          const clearPortraits = clearPortraitRef.current;
          void startGenerate(clearFullBody, clearPortraits);
        },
      });
    } else {
      await startGenerate(false, false);
    }
  };

  // === 重新生成多视图 ===
  const handleRegenerateViews = async () => {
    if (!char.avatar) {
      message.warning('请先生成头像');
      return;
    }
    setIsGeneratingViews(true);
    try {
      const model = localViewsModel || defaultImageToImageModel;
      const imagePrompt = localViewsPrompt || char.imagePrompt || '';
      const res = await generateCharacterViewsApi(char.id, model, char.avatar, undefined, imagePrompt, '16:9', undefined, undefined, true);
      if (!res.success) { message.error('多视图生成失败'); return; }
      const jobData = res.data as { jobId?: string; fullBodyUrls?: string[] } | undefined;
      let urls: string[] = [];
      if (jobData?.jobId) {
        const poll = await pollJobStatus<{ fullBodyUrls?: string[] }>(jobData.jobId, { interval: 3000, maxWaitTime: 5 * 60 * 1000 });
        if (!poll.success) { message.error(poll.error || '多视图生成失败'); return; }
        urls = poll.data?.fullBodyUrls || [];
      } else {
        urls = jobData?.fullBodyUrls || [];
      }
      if (urls.length > 0) {
        const referenceAvatarId = char.avatarImages?.[0]?.id;
        const existingFullBody = char.fullBodyImages || [];
        const newImages = urls.map((url, index) => {
          // 复用已有全身照 asset_key，实现重新生成 upsert 替换，避免数据库新增旧图
          const stableKey =
            existingFullBody[index]?.id ||
            existingFullBody[index]?.assetId ||
            `${char.id}-fullbody-${index}`;
          return {
            id: stableKey,
            assetId: stableKey,
            imageUrl: url,
            name: '全身照',
            isPortrait: false,
            referenceAvatarId,
            prompt: imagePrompt,
            model,
          };
        });
        // 合并为一次状态更新，避免两次 setCharacters 用旧的 page.characters 互相覆盖
        const fields = { fullBodyImages: newImages, imagePrompt };
        const nextChars = page.characters.map((c) =>
          c.id === char.id ? { ...c, ...fields } : c
        );
        page.saveCharacters(nextChars);
        page.setMultiViewChar((prev) => (prev ? { ...prev, ...fields } : null));
        // 立即同步到服务器，不等防抖，确保关闭/刷新后仍为新图
        if (page.projectId) {
          saveInstantToServer(page.projectId, {
            instantCharacters: nextChars,
            instantScenes: page.scenes,
            instantSegments: page.segments,
          }).catch((e) => {
            console.warn('[MultiViewModal] 立即保存失败', e);
          });
        }
        message.success('多视图已更新');
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: any) {
      message.error(err?.message || '多视图生成失败');
    } finally {
      setIsGeneratingViews(false);
    }
  };

  // === 本地选择文件作为多视图（真正上传到服务器） ===
  const handleFullbodyFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      // 角色全身照属于项目级资产（episode_number=0），跨集统一
      const result = await uploadFile(file, 'drama', 'fullbody', {
        projectId: page.projectId,
        assetType: 'character_image',
        episodeNumber: 0,
      });
      const referenceAvatarId = char.avatarImages?.[0]?.id;
      const newImages = [{ assetId: result.assetId, imageUrl: result.url, name: '全身照', isPortrait: false, referenceAvatarId, prompt: localViewsPrompt, model: localViewsModel }];
      const fields = { fullBodyImages: newImages };
      const nextChars = page.characters.map((c) => (c.id === char.id ? { ...c, ...fields } : c));
      page.saveCharacters(nextChars);
      page.setMultiViewChar((prev) => (prev ? { ...prev, ...fields } : null));
      // 立即同步服务器，确保关闭/刷新后仍为新图
      if (page.projectId && page.projectId !== 'default') {
        saveInstantToServer(page.projectId, {
          instantCharacters: nextChars,
          instantScenes: page.scenes,
          instantSegments: page.segments,
        }).catch((err) => console.warn('[MultiViewModal] 立即保存失败', err));
      }
      message.success('全身照已上传');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '全身照上传失败');
    }
    e.target.value = '';
  };

  // === 删除多视图（带二次确认）===
  const handleDeleteCurrentFullBody = (index: number) => {
    const target = char.fullBodyImages?.[index];
    Modal.confirm({
      title: '⚠ 确认删除全身照？',
      content: `确定要删除第 ${index + 1} 张全身照吗？\n\n该操作不可恢复，删除后该全身照将从角色中移除。`,
      okText: '确认删除',
      okButtonProps: { danger: true, size: 'middle' },
      cancelText: '取消',
      cancelButtonProps: { size: 'middle' },
      width: 420,
      centered: true,
      onOk: () => {
        const next = (char.fullBodyImages || []).filter((_, i) => i !== index);
        updateCharField('fullBodyImages', next);
      },
    });
  };

  // === 打开添加形象照对话框 ===
  const handleOpenAddPortrait = () => {
    setPortraitTitle('');
    setPortraitPrompt('');
    setPortraitModel(defaultImageToImageModel);
    setPortraitPreviewUrl('');
    setEditingPortraitIndex(null);
    setPortraitDialogOpen(true);
  };

  // === 打开编辑形象照 ===
  const handleOpenEditPortrait = (index: number) => {
    const img = char.portraitImages?.[index];
    setPortraitTitle(img?.name || '');
    setPortraitPrompt(img?.prompt || char.imagePrompt || '');
    setPortraitModel(img?.model || defaultImageToImageModel);
    setPortraitPreviewUrl(img?.imageUrl || '');
    setEditingPortraitIndex(index);
    setPortraitDialogOpen(true);
  };

  // === 生成形象照 ===
  const handleGeneratePortrait = async () => {
    if (!char.avatar) {
      message.warning('请先生成头像');
      return;
    }
    if (!portraitPrompt.trim()) {
      message.warning('请输入形象照提示词');
      return;
    }
    setPortraitGenerating(true);
    try {
      const model = portraitModel || defaultImageToImageModel;
      const res = await generateCharacterPortraitApi(char.id, {
        avatarUrl: char.avatar,
        portraitPrompt: portraitPrompt.trim(),
        model,
        count: 1,
        aspectRatio: '9:16',
        async: true,
      });
      if (!res.success) { message.error('形象照生成失败'); return; }
      const jobData = res.data as { jobId?: string; portraitUrls?: string[] } | undefined;
      let urls: string[] = [];
      if (jobData?.jobId) {
        const poll = await pollJobStatus<{ portraitUrls?: string[] }>(jobData.jobId, { interval: 3000, maxWaitTime: 5 * 60 * 1000 });
        if (!poll.success) { message.error(poll.error || '形象照生成失败'); return; }
        urls = poll.data?.portraitUrls || [];
      } else {
        urls = jobData?.portraitUrls || [];
      }
      if (urls.length > 0) {
        setPortraitPreviewUrl(urls[0]);
        message.success(`形象照生成成功，点击"${editingPortraitIndex !== null ? '确定' : '确认添加'}"`);
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: any) {
      message.error(err?.message || '形象照生成失败');
    } finally {
      setPortraitGenerating(false);
    }
  };

  // === 确认添加/更新形象照到列表 ===
  const handleConfirmPortrait = async () => {
    if (!portraitPreviewUrl) {
      message.warning('请先生成形象照');
      return;
    }
    if (!portraitTitle.trim()) {
      message.warning('请输入形象照标题');
      return;
    }

    const model = portraitModel || defaultImageToImageModel;
    const referenceAvatarId = char.avatarImages?.[0]?.id;
    const oldImage = editingPortraitIndex !== null ? char.portraitImages?.[editingPortraitIndex] : undefined;
    const hasRegenerated = portraitPreviewUrl !== oldImage?.imageUrl;

    // instant 项目的 image_asset 行由 saveProjectAssets 从 character 数据派生；
    // 我们用稳定的 id 作为 asset_key，编辑时复用旧 id，新增时生成新 id。
    let portraitAssetKey = oldImage?.id;
    if (editingPortraitIndex === null || !portraitAssetKey) {
      portraitAssetKey = crypto.randomUUID();
    }

    const pid = page.projectId;
    if (pid && pid !== 'default' && editingPortraitIndex !== null && hasRegenerated) {
      // 编辑重新生图：立即更新现有 image_asset 行
      try {
        await localApi.patchImageAssetData(pid, portraitAssetKey, {
          original_url: portraitPreviewUrl,
          source: 'ai',
          metadata: {
            prompt: portraitPrompt.trim(),
            name: portraitTitle.trim(),
            characterId: char.id,
          },
        });
      } catch (e) {
        console.warn('[MultiViewModal] 更新形象照 image_asset 失败:', e);
      }
    }

    const newImage = {
      id: portraitAssetKey,
      assetId: portraitAssetKey,
      imageUrl: portraitPreviewUrl,
      name: portraitTitle.trim(),
      referenceAvatarId,
      prompt: portraitPrompt.trim(),
      model,
    };

    let nextChars: typeof page.characters;
    if (editingPortraitIndex !== null) {
      const next = [...(char.portraitImages || [])];
      next[editingPortraitIndex] = newImage;
      nextChars = page.characters.map((c) => (c.id === char.id ? { ...c, portraitImages: next } : c));
      updateCharField('portraitImages', next);
      message.success('形象照已更新');
    } else {
      const next = [...(char.portraitImages || []), newImage];
      nextChars = page.characters.map((c) => (c.id === char.id ? { ...c, portraitImages: next } : c));
      updateCharField('portraitImages', next);
      // 同步清理 segments 中旧引用（如果使用 title 引用）
      if (pid) {
        const nextSegs = removePortraitFromSegments(page.segments, char.id, (char.portraitImages || []).length);
        if (nextSegs !== page.segments) {
          persistInstantData(pid, { instantSegments: nextSegs });
        }
      }
      message.success('形象照已添加');
    }

    // 立即保存到服务器，确保 image_asset 行被创建/更新（资产先行落库）
    if (pid && pid !== 'default') {
      try {
        const saved = await saveInstantToServer(pid, {
          instantCharacters: nextChars,
          instantScenes: page.scenes,
          instantSegments: page.segments,
        });
        if (!saved) {
          console.warn('[MultiViewModal] 立即保存形象照返回失败');
          message.warning('形象照已添加，但自动保存到服务器失败，请稍后手动保存');
        } else {
          console.log('[MultiViewModal] 形象照已立即保存到服务器');
        }
      } catch (e) {
        console.warn('[MultiViewModal] 立即保存形象照异常:', e);
        message.warning('形象照已添加，但自动保存到服务器失败，请稍后手动保存');
      }
    }

    setPortraitDialogOpen(false);
    setPortraitPreviewUrl('');
    setEditingPortraitIndex(null);
  };

  // === 删除形象照（带二次确认）===
  const handleDeletePortrait = (index: number) => {
    const target = char.portraitImages?.[index];
    const portraitName = target?.name || `形象照 ${index + 1}`;
    Modal.confirm({
      title: '⚠ 确认删除形象照？',
      content: `确定要删除形象照 "${portraitName}" 吗？\n\n该操作不可恢复，删除后该形象照以及所有引用此形象照的片段都将被清理。`,
      okText: '确认删除',
      okButtonProps: { danger: true, size: 'middle' },
      cancelText: '取消',
      cancelButtonProps: { size: 'middle' },
      width: 420,
      centered: true,
      onOk: () => {
        const next = (char.portraitImages || []).filter((_, i) => i !== index);
        updateCharField('portraitImages', next);
        // 同步清理 segments
        if (page.projectId) {
          const nextSegs = removePortraitFromSegments(page.segments, char.id, index);
          if (nextSegs !== page.segments) {
            persistInstantData(page.projectId, { instantSegments: nextSegs });
          }
        }
      },
    });
  };

  // === 头像预览 ===
  const currentAvatarUrl = char.avatar;
  const currentFullBody = char.fullBodyImages?.[page.multiViewIndex];
  const hasFullBody = !!currentFullBody?.imageUrl;
  const hasPortrait = (char.portraitImages?.length || 0) > 0;

  return (
    <>
      <Modal
        open={page.multiViewOpen}
        onCancel={() => page.setMultiViewOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="primary" onClick={() => page.setMultiViewOpen(false)}>
              确定
            </Button>
          </div>
        }
        maskClosable={false}
        title={
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-bg-tertiary border border-border flex items-center justify-center flex-shrink-0">
              {char.avatar ? (
                <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
              ) : (
                <User size={18} className="text-text-muted opacity-40" />
              )}
            </div>
            <span>{char.name ? `${char.name} - 角色` : '角色'}</span>
          </div>
        }
        width={1000}
        centered
      >
        <div className="flex gap-5 items-start">
          {/* 左侧：角色信息与头像 */}
          <div className="flex-1 min-w-0">
            {/* 头像 + 名称/描述/操作 */}
            <div className="flex items-start gap-4 mb-4">
              {/* 头像预览（参照剧本 box） */}
              <div
                className="relative w-24 h-24 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer"
                onClick={() => currentAvatarUrl && page.openImagePreview(currentAvatarUrl, `${char.name} - 头像`)}
              >
                {char.isGeneratingAvatar ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-text-muted">
                    <Spin />
                    <span className="text-xs">生成中...</span>
                  </div>
                ) : currentAvatarUrl ? (
                  <>
                    <img
                      src={currentAvatarUrl}
                      alt={char.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ZoomIn size={20} className="text-white" />
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-muted">
                    <ImageIcon size={24} />
                  </div>
                )}
              </div>

              {/* 角色信息 */}
              <div className="flex-1 min-w-0 space-y-2">
                <Input
                  value={char.name}
                  onChange={(e) => updateCharField('name', e.target.value)}
                  className="text-base font-semibold bg-transparent border-border"
                  placeholder="角色名称"
                />
                <Input
                  value={char.appearance || ''}
                  onChange={(e) => updateCharField('appearance', e.target.value)}
                  className="text-sm text-text-secondary bg-transparent border-border"
                  placeholder="角色描述"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-text-muted whitespace-nowrap">图片模型:</span>
                  <Select
                    value={char.model}
                    onChange={(v) => updateCharField('model', v)}
                    options={page.imageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
                    size="small"
                    popupMatchSelectWidth={false}
                    className="min-w-[120px]"
                  />
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    <ModelPriceTag model={page.imageModels.find((m) => m.id === char.model)} />
                  </span>
                  <Button
                    onClick={handleRegenerateAvatar}
                    loading={char.isGeneratingAvatar}
                    icon={<ImageIcon size={14} />}
                    size="small"
                    className="bg-accent-primary text-white"
                  >
                    {char.avatarImages && char.avatarImages.length > 0 ? '重生成头像' : '生成头像'}
                  </Button>
                  <Button
                    onClick={() => setAvatarUploadDialogOpen(true)}
                    icon={<Upload size={14} />}
                    size="small"
                    className="text-text-secondary border-border"
                    title="本地上传头像"
                  />
                </div>
              </div>
            </div>

            {/* 头像提示词 */}
            <div className="flex items-start gap-2 mb-3">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">头像提示词</span>
              <Input.TextArea
                value={char.avatarPrompt || ''}
                onChange={(e) => updateCharField('avatarPrompt', e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="请输入头像生成提示词"
              />
            </div>

            {/* 全身提示词 */}
            <div className="flex items-start gap-2">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">全身提示词</span>
              <Input.TextArea
                value={localViewsPrompt}
                onChange={(e) => {
                  setLocalViewsPrompt(e.target.value);
                  page.setViewsPrompt(e.target.value);
                }}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="请输入全身照生成提示词"
              />
            </div>

            {/* 音色提示词 */}
            <div className="flex items-start gap-2 mt-3">
              <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">音色提示词</span>
              <Input.TextArea
                value={char.voicePrompt || ''}
                onChange={(e) => updateCharField('voicePrompt', e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                className="flex-1 bg-bg-tertiary border-border text-sm"
                placeholder="描述角色的声音特征，如：年轻女性，普通话，语速中等，温柔细腻..."
              />
            </div>

            {/* 形象照网格 */}
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-text-muted">形象照</span>
                <span className="text-xs text-text-muted">
                  ({char.portraitImages?.length || 0}/5)
                </span>
              </div>
              <div className="flex items-start gap-3 flex-wrap">
                {char.portraitImages?.map((img, index) => (
                  <div key={`portrait-${index}`} className="flex flex-col items-center gap-1">
                    <div
                      className="relative h-32 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer border border-border"
                      style={{ aspectRatio: '9/16', width: '72px' }}
                      onClick={() => img.imageUrl && page.openImagePreview(img.imageUrl, `${char.name} - 形象照 ${index + 1}`)}
                    >
                      {img.imageUrl ? (
                        <img
                          src={img.imageUrl}
                          alt={img.name || `形象照 ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-text-muted">
                          <ImageIcon size={24} className="opacity-50" />
                          <span className="text-[10px] mt-1">无图片</span>
                        </div>
                      )}
                      {/* hover 操作按钮 */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEditPortrait(index);
                          }}
                          className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40"
                          title="重新生成"
                        >
                          <RefreshCw size={10} className="text-white" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePortrait(index);
                          }}
                          className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40"
                          title="删除"
                        >
                          <Trash2 size={10} className="text-white" />
                        </button>
                      </div>
                    </div>
                    <span className="text-xs text-secondary text-center truncate max-w-[72px]" title={img.name}>
                      {img.name || `形象照${index + 1}`}
                    </span>
                  </div>
                ))}
                {/* 添加按钮 */}
                {(char.portraitImages?.length || 0) < 5 && (
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={handleOpenAddPortrait}
                      className="h-32 rounded-lg border-2 border-dashed border-border hover:border-accent-primary/60 flex items-center justify-center text-text-muted hover:text-accent-primary transition-colors bg-bg-tertiary/50 px-3"
                      style={{ aspectRatio: '9/16', width: '72px' }}
                      title="添加形象照"
                    >
                      <Plus size={20} />
                    </button>
                    <span className="text-xs text-text-muted text-center" style={{ width: '72px' }}>添加</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：多视图展示 */}
          <div className="w-44 sm:w-48 md:w-52 flex-shrink-0 flex flex-col">
            {/* 多视图展示 */}
            <div
              className="aspect-video w-full rounded-lg bg-bg-tertiary overflow-hidden relative cursor-pointer border border-border group"
              onClick={() => currentFullBody?.imageUrl && page.openImagePreview(currentFullBody.imageUrl, `${char.name} - 全身照`)}
            >
              {isGeneratingViews || char.isGeneratingViews ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-10">
                  <Spin size="default" />
                  <span className="mt-2 text-xs text-white">生成中...</span>
                </div>
              ) : hasFullBody ? (
                <>
                  <img
                    src={currentFullBody?.imageUrl}
                    alt="人物多视图"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ZoomIn size={24} className="text-white" />
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
                  <ImageIcon size={32} className="mb-1 opacity-50" />
                  <span className="text-xs">暂无全身照</span>
                </div>
              )}
              {/* 悬浮重新生成按钮 */}
              {hasFullBody && !isGeneratingViews && !char.isGeneratingViews && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRegenerateViews();
                  }}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  title="重新生成"
                >
                  <RefreshCw size={12} className="text-white" />
                </button>
              )}
              {/* 删除当前多视图按钮 */}
              {hasFullBody && (char.fullBodyImages?.length || 0) > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCurrentFullBody(page.multiViewIndex);
                  }}
                  className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-red-500/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  title="删除当前多视图"
                >
                  <Trash2 size={10} className="text-white" />
                </button>
              )}
              {/* 图片底部悬浮标题 */}
              <div className="absolute bottom-0 left-0 right-0 px-2 py-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <span className="text-sm font-medium text-white drop-shadow">人物多视图</span>
              </div>
            </div>

            {/* 多视图：模型下拉框 + 操作按钮 */}
            <div className="flex flex-col gap-2 mt-2.5">
              <Select
                value={localViewsModel}
                onChange={(v) => {
                  setLocalViewsModel(v);
                  page.setViewsModel(v);
                }}
                options={imageToImageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
                size="small"
                popupMatchSelectWidth={false}
                style={{ minWidth: 90 }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="text"
                  size="small"
                  onClick={handleRegenerateViews}
                  loading={isGeneratingViews}
                  disabled={!char.avatar}
                  className="text-accent-primary hover:text-accent-primary/80 px-3 h-[24px] py-0 border border-border flex-1 text-xs"
                  title={char.avatar ? '使用当前头像作为参考生成全身照' : '请先生成头像'}
                >
                  {hasFullBody ? '重新生成' : '生成多视图'}
                </Button>
                <Button
                  size="small"
                  onClick={() => fullbodyFileInputRef.current?.click()}
                  icon={<Upload size={12} />}
                  className="flex-1 text-xs"
                >
                  本地上传
                </Button>
              </div>
              <input
                ref={fullbodyFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFullbodyFileSelect}
              />
            </div>

          </div>
        </div>
      </Modal>

      {/* 选择头像图片来源（本地上传 / 真人资产 / 素材库） */}
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

      {/* 形象照添加/编辑对话框 */}
      <Modal
        open={portraitDialogOpen}
        onCancel={() => {
          setPortraitDialogOpen(false);
          setPortraitPreviewUrl('');
          setEditingPortraitIndex(null);
        }}
        onOk={handleConfirmPortrait}
        title={editingPortraitIndex !== null ? '编辑形象照' : '添加形象照'}
        okText={editingPortraitIndex !== null ? '确定' : '确认添加'}
        cancelText="取消"
        width={640}
        zIndex={1100}
        maskClosable={false}
        okButtonProps={{ disabled: !portraitPreviewUrl }}
      >
        <div className="mt-2 flex gap-4">
          <div className="w-36 flex-shrink-0 flex flex-col gap-2">
            <div
              className="w-full rounded-lg overflow-hidden border border-border bg-bg-tertiary flex items-center justify-center"
              style={{ aspectRatio: '9/16' }}
            >
              {portraitGenerating ? (
                <div className="flex flex-col items-center gap-2 text-text-muted">
                  <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs">生成中...</span>
                </div>
              ) : portraitPreviewUrl ? (
                <img src={portraitPreviewUrl} alt="形象照预览" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center justify-center text-text-muted p-2">
                  <Plus size={24} className="opacity-40" />
                  <span className="text-xs mt-1 opacity-60">点击生成</span>
                </div>
              )}
            </div>
            <Button
              type="primary"
              block
              size="small"
              loading={portraitGenerating}
              onClick={handleGeneratePortrait}
            >
              {portraitPreviewUrl ? '重新生成' : '生成形象图'}
            </Button>
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">形象标题</label>
              <Input
                value={portraitTitle}
                onChange={(e) => setPortraitTitle(e.target.value)}
                placeholder="例如：旗袍形象照、运动形象照..."
                className="bg-bg-tertiary border-border rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">AI 生成提示词</label>
              <div className="flex items-center gap-2">
                <Select
                  value={portraitTextModel}
                  onChange={setPortraitTextModel}
                  options={(page.textModels || []).map((m: any) => ({
                    value: m.id,
                    label: m.name,
                    disabled: m.disabled,
                  }))}
                  className="flex-1"
                  size="small"
                  popupMatchSelectWidth={false}
                  disabled={isGeneratingPortraitPrompt}
                />
                <Tooltip title="根据形象标题，用文本模型生成形象提示词">
                  <Button
                    type="primary"
                    size="small"
                    icon={<Sparkles size={14} />}
                    onClick={handleGeneratePortraitPrompt}
                    loading={isGeneratingPortraitPrompt}
                    disabled={!portraitTitle.trim() || isGeneratingPortraitPrompt}
                    className="!text-white"
                  >
                    AI生成
                  </Button>
                </Tooltip>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">形象提示词</label>
              <Input.TextArea
                value={portraitPrompt}
                onChange={(e) => setPortraitPrompt(e.target.value)}
                placeholder="描述角色的形象，例如：穿着红色旗袍，优雅端庄，手持折扇..."
                rows={4}
                className="bg-bg-tertiary border-border rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary block mb-1">图片模型</label>
              <Select
                value={portraitModel}
                onChange={setPortraitModel}
                options={imageToImageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
                className="w-full"
                size="small"
                popupMatchSelectWidth={false}
              />
              <div className="mt-1">
                <ModelPriceTag model={page.imageModels.find((m) => m.id === portraitModel)} />
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
