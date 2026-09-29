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
import { Modal, Input, Button, Select, Tooltip } from 'antd';
import { Plus, Sparkles } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { generatePortraitPromptApi } from '@/modules/workflow/api/sceneApi';
import type { UseInstantCreatePageReturn } from '../../hooks/UseInstantCreatePageReturn';
import { message } from '@/shared/utils/message';

interface Props {
  page: UseInstantCreatePageReturn;
}

export const PortraitDialogModal: React.FC<Props> = ({ page }) => {
  const [selectedTextModel, setSelectedTextModel] = useState<string>(
    page.defaultTextModel,
  );
  const [isGeneratingPortraitPrompt, setIsGeneratingPortraitPrompt] =
    useState(false);

  // 根据形象标题，使用文本模型生成形象提示词
  const handleGeneratePortraitPrompt = async () => {
    if (!page.portraitDialogTitle.trim()) {
      message.warning('请先输入形象标题');
      return;
    }
    if (!selectedTextModel) {
      message.warning('请选择文本模型');
      return;
    }
    if (isGeneratingPortraitPrompt) return;
    setIsGeneratingPortraitPrompt(true);
    try {
      const res = await generatePortraitPromptApi(
        selectedTextModel,
        page.portraitDialogTitle.trim(),
      );
      if (res.success && res.data?.prompt) {
        page.setPortraitDialogPrompt(res.data.prompt);
        message.success('提示词已生成');
      } else {
        message.error(res.message || '生成提示词失败');
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : '生成提示词失败',
      );
    } finally {
      setIsGeneratingPortraitPrompt(false);
    }
  };

  return (
    <>
    {/* 形象照生成 Dialog */}
    <Modal
      open={page.portraitDialogOpen}
      onCancel={page.closePortraitDialog}
      onOk={page.handleConfirmPortraitFromDialog}
      title={page.portraitDialogIsReset ? '重新生成形象照' : '添加形象照'}
      okText="确认添加"
      cancelText="取消"
      width={640}
      okButtonProps={{ disabled: !page.portraitDialogPreviewUrl }}
    >
      <div className="mt-2 flex gap-4">
        {/* 左侧：图片预览区 + 生成按钮 */}
        <div className="w-36 flex-shrink-0 flex flex-col gap-2">
          <div
            className="w-full rounded-lg overflow-hidden border border-border bg-bg-tertiary flex items-center justify-center"
            style={{ aspectRatio: '9/16' }}
          >
            {page.portraitDialogGenerating ? (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">生成中...</span>
              </div>
            ) : page.portraitDialogPreviewUrl ? (
              <img
                src={page.portraitDialogPreviewUrl}
                alt="形象照预览"
                className="w-full h-full object-cover"
              />
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
            loading={page.portraitDialogGenerating}
            onClick={page.handleGeneratePortraitInDialog}
          >
            {page.portraitDialogPreviewUrl ? '重新生成' : '生成形象图'}
          </Button>
        </div>

        {/* 右侧：表单 */}
        <div className="flex-1 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">形象标题</label>
            <Input
              value={page.portraitDialogTitle}
              onChange={(e) => page.setPortraitDialogTitle(e.target.value)}
              placeholder="例如：旗袍形象照、运动形象照..."
              className="bg-bg-tertiary border-border rounded-lg"
            />
          </div>

          {/* AI 生成提示词：文本模型 + 生成按钮 */}
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              AI 生成提示词
            </label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedTextModel}
                onChange={setSelectedTextModel}
                options={(page.textModels || []).map((m: any) => ({
                  label: m.name,
                  value: m.id,
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
                  disabled={
                    !page.portraitDialogTitle.trim() ||
                    isGeneratingPortraitPrompt
                  }
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
              value={page.portraitDialogPrompt}
              onChange={(e) => page.setPortraitDialogPrompt(e.target.value)}
              placeholder="描述角色的形象，例如：穿着红色旗袍，优雅端庄，手持折扇..."
              rows={4}
              className="bg-bg-tertiary border-border rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">图片模型</label>
            <Select
              value={page.imageModels.filter((m) => m.supports?.image_to_image === true).some((m) => m.id === page.portraitDialogModel) ? page.portraitDialogModel : (page.imageModels.filter((m) => m.supports?.image_to_image === true)[0]?.id || page.portraitDialogModel)}
              onChange={(v) => page.setPortraitDialogModel(v)}
              options={page.imageModels.filter((m) => m.supports?.image_to_image === true).map((m) => ({ label: m.name, value: m.id }))}
              className="w-full"
              size="small"
              popupMatchSelectWidth={false}
            />
            <div className="mt-1">
              <ModelPriceTag model={page.imageModels.find(m => m.id === page.portraitDialogModel)} />
            </div>
          </div>
        </div>
      </div>
    </Modal>

    </>
  );
};
