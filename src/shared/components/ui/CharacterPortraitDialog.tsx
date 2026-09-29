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
import { Modal, Button, Input, Select, Tooltip } from 'antd';
import { Plus, Sparkles } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import type { Character } from '@/shared/types';
import { ImagePreview } from './ImagePreview';
import { useResolvedImageUrl } from '@/modules/workflow/hooks/useWorkflowImageResolver';
import { generatePortraitPromptApi } from '@/modules/workflow/api/sceneApi';
import { useWorkflowStore } from '@/modules/workflow/stores/workflowStore';
import { message } from '@/shared/utils/message';

interface ImageModel {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

interface CharacterPortraitDialogProps {
  character: Character;
  open: boolean;
  editingPortraitIndex: number | null;
  isGeneratingPortrait: boolean;
  generatedPortraitUrl: string;
  uploadPreviewUrls: string[];
  portraitName: string;
  setPortraitName: (v: string) => void;
  portraitPrompt: string;
  setPortraitPrompt: (v: string) => void;
  selectedPortraitModel: string;
  setSelectedPortraitModel: (v: string) => void;
  imageModels: ImageModel[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onGenerate: () => void;
  firstAvatarIndex: number;
  isConfirming?: boolean;
}

/**
 * 角色形象照添加/编辑弹窗
 */
export const CharacterPortraitDialog: React.FC<CharacterPortraitDialogProps> = ({
  character,
  open,
  editingPortraitIndex,
  isGeneratingPortrait,
  generatedPortraitUrl,
  uploadPreviewUrls,
  portraitName,
  setPortraitName,
  portraitPrompt,
  setPortraitPrompt,
  selectedPortraitModel,
  setSelectedPortraitModel,
  imageModels,
  fileInputRef,
  onFileSelect,
  onClose,
  onConfirm,
  onGenerate,
  firstAvatarIndex,
  isConfirming = false,
}) => {
  // 图片预览状态
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // AI 生成形象提示词（与即时创作一致：根据形象标题调用文本模型）
  const textModels = useWorkflowStore((s) => s.textModels);
  const storeTextModel = useWorkflowStore((s) => s.textModel);
  const [selectedTextModel, setSelectedTextModel] = useState<string>(storeTextModel);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  const handleGeneratePrompt = async () => {
    if (!portraitName.trim()) {
      message.warning('请先输入形象标题');
      return;
    }
    if (!selectedTextModel) {
      message.warning('请选择文本模型');
      return;
    }
    if (isGeneratingPrompt) return;
    setIsGeneratingPrompt(true);
    try {
      const res = await generatePortraitPromptApi(
        selectedTextModel,
        portraitName.trim(),
      );
      if (res.success && res.data?.prompt) {
        setPortraitPrompt(res.data.prompt);
        message.success('提示词已生成');
      } else {
        message.error(res.message || '生成提示词失败');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '生成提示词失败');
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const avatarImg = character.avatarImages?.[firstAvatarIndex];
  const resolvedAvatarUrl = useResolvedImageUrl(avatarImg?.assetId, avatarImg?.imageUrl);

  // 获取当前预览的图片URL
  const getCurrentPreviewUrl = () => {
    if (generatedPortraitUrl) return generatedPortraitUrl;
    if (uploadPreviewUrls.length > 0) return uploadPreviewUrls[0];
    return '';
  };

  // 打开图片预览
  const handleOpenPreview = () => {
    const url = getCurrentPreviewUrl();
    if (url) {
      setPreviewIndex(0);
      setPreviewOpen(true);
    }
  };

  return (
    <Modal
      title={editingPortraitIndex !== null ? '重新生成形象照' : '添加形象照'}
      open={open}
      onCancel={onClose}
      onOk={onConfirm}
      okText="确认添加"
      cancelText="取消"
      width={640}
      destroyOnHidden
      mask={{ closable: !isGeneratingPortrait && !isConfirming }}
      keyboard={!isGeneratingPortrait && !isConfirming}
      okButtonProps={{ disabled: (!generatedPortraitUrl && uploadPreviewUrls.length === 0) || !portraitName.trim(), loading: isConfirming }}
      confirmLoading={isConfirming || isGeneratingPortrait}
    >
      <div className="mt-2 flex gap-4">
        {/* 左侧：图片预览区 + 图片模型 + 生成按钮 */}
        <div className="w-52 flex-shrink-0 flex flex-col gap-2">
          <div
            className="w-full rounded-lg overflow-hidden border border-border bg-bg-tertiary flex items-center justify-center cursor-pointer hover:border-accent-primary/50 transition-colors"
            style={{ aspectRatio: '16/9' }}
            onClick={handleOpenPreview}
          >
            {isGeneratingPortrait ? (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">生成中...</span>
              </div>
            ) : generatedPortraitUrl ? (
              <img
                src={generatedPortraitUrl}
                alt="形象照预览"
                className="w-full h-full object-cover"
              />
            ) : uploadPreviewUrls.length > 0 ? (
              <img
                src={uploadPreviewUrls[0]}
                alt="上传预览"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-text-muted p-2">
                <Plus size={24} className="opacity-40" />
                <span className="text-xs mt-1 opacity-60">点击生成</span>
              </div>
            )}
          </div>
          {/* 图片模型选择：下拉框与积分标签同行，放在生成按钮正上方 */}
          <div className="flex items-center gap-1.5">
            <Select
              value={selectedPortraitModel}
              onChange={setSelectedPortraitModel}
              options={imageModels.map((m) => ({
                value: m.id,
                label: m.name,
                disabled: m.disabled,
              }))}
              className="flex-1 min-w-0"
              size="small"
              disabled={isGeneratingPortrait}
              popupMatchSelectWidth={false}
            />
            <ModelPriceTag model={imageModels.find((m) => m.id === selectedPortraitModel)} className="whitespace-nowrap" />
          </div>
          <Button
            type="primary"
            block
            size="small"
            loading={isGeneratingPortrait}
            onClick={onGenerate}
            disabled={!character.avatarImages || character.avatarImages.length === 0}
          >
            {generatedPortraitUrl ? '重新生成' : '生成形象图'}
          </Button>
          {/* 本地上传 */}
          <input
            type="file"
            accept="image/*"
            multiple
            ref={fileInputRef}
            onChange={onFileSelect}
            className="hidden"
          />
          <Button
            block
            size="small"
            onClick={() => fileInputRef.current?.click()}
            className="border-border"
          >
            {uploadPreviewUrls.length > 0 ? '重新上传' : '本地上传'}
          </Button>
        </div>

        {/* 右侧：表单 */}
        <div className="flex-1 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">形象标题</label>
            <Input
              value={portraitName}
              onChange={(e) => setPortraitName(e.target.value)}
              placeholder="例如：旗袍形象照、运动形象照..."
              className="bg-bg-tertiary border-border rounded-lg"
              disabled={isGeneratingPortrait}
              maxLength={20}
              showCount
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">AI 生成提示词</label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedTextModel}
                onChange={setSelectedTextModel}
                options={(textModels || []).map((m) => ({
                  label: m.name,
                  value: m.id,
                  disabled: m.disabled,
                }))}
                className="flex-1"
                size="small"
                popupMatchSelectWidth={false}
                disabled={isGeneratingPrompt}
              />
              <Tooltip title="根据形象标题，用文本模型生成形象提示词">
                <Button
                  type="primary"
                  size="small"
                  icon={<Sparkles size={14} />}
                  onClick={handleGeneratePrompt}
                  loading={isGeneratingPrompt}
                  disabled={!portraitName.trim() || isGeneratingPrompt}
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
              disabled={isGeneratingPortrait}
            />
          </div>
          {/* 头像参考提示 */}
          {resolvedAvatarUrl ? (
            <div className="flex items-center gap-2 p-2 bg-bg-tertiary rounded-lg">
              <img
                src={resolvedAvatarUrl}
                alt="参考头像"
                className="w-8 h-8 rounded-full object-cover"
              />
              <span className="text-xs text-text-muted">使用当前头像作为参考</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <span className="text-xs text-amber-400">请先生成头像作为参考</span>
            </div>
          )}
        </div>
      </div>

      {/* 图片放大预览 */}
      <ImagePreview
        images={[getCurrentPreviewUrl()].filter(Boolean)}
        visible={previewOpen}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        title="形象照预览"
      />
    </Modal>
  );
};
