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

import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Steps, Input, Tooltip, Select, Spin } from 'antd';
import { Shuffle, ImagePlus, Sparkles, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ModelConfig } from '@/shared/types/index';
import {
  generateSceneImageApi,
  getScenePresetConfig,
  getRandomScenePreset,
  generateScenePromptApi,
} from '@/modules/workflow/api/sceneApi';
import type {
  SceneStepOption,
  SceneConflictRule,
} from '@/modules/workflow/api/sceneApi';
import { message } from '@/shared/utils/message';

export interface NewScene {
  id: string;
  name: string;
  imageUrl?: string;
  prompt: string;
  sceneType: string;
  timeOfDay: string;
  atmosphere: string;
  lighting: string;
  weather: string;
  model?: string;
  imageUrls?: string[];
  isGenerating?: boolean;
}

interface CreateSceneDialogProps {
  open: boolean;
  onCancel: () => void;
  onCreate: (scene: NewScene) => void;
  /** 已有场景名称列表，用于重名检查 */
  existingNames?: string[];
  imageModels: ModelConfig[];
  selectedImageModel: string;
  aspectRatio?: string;
  /** 文本模型列表（用于 AI 生成场景提示词） */
  textModels: ModelConfig[];
  /** 默认文本模型 */
  defaultTextModel: string;
  /** API 预览模式开关（开启时生成前弹请求体预览 dialog） */
  videoApiPreviewMode?: boolean;
  /** API 预览弹窗触发函数（与 instant 其他生图入口一致） */
  showApiPreview?: (title: string, previewPromise: Promise<unknown>, requestData: unknown, onExecute: () => void) => void;
}

export const CreateSceneDialog: React.FC<CreateSceneDialogProps> = ({
  open,
  onCancel,
  onCreate,
  existingNames = [],
  imageModels,
  selectedImageModel,
  aspectRatio = '16:9',
  textModels,
  defaultTextModel,
  videoApiPreviewMode,
  showApiPreview,
}) => {
  // 向导步骤：0=选择属性，1=生成场景（名称/提示词/场景图合并）
  const [wizardStep, setWizardStep] = useState(0);
  // Step 0 内部的属性子步骤（0..stepOptions.length-1）
  const [sceneAttributeStep, setSceneAttributeStep] = useState(0);
  const [selections, setSelections] = useState<string[]>([]);

  // 场景属性向导配置（从后端 scene-presets.json 加载）
  const [stepOptions, setStepOptions] = useState<SceneStepOption[]>([]);
  const [optionsByType, setOptionsByType] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [conflictRules, setConflictRules] = useState<SceneConflictRule[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [sceneName, setSceneName] = useState('');
  const [nameError, setNameError] = useState('');

  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [imageUrls, setImageUrls] = useState<string[] | undefined>();
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedModel, setSelectedModel] = useState(selectedImageModel);

  // AI 生成提示词相关状态
  const [selectedTextModel, setSelectedTextModel] = useState(defaultTextModel);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isFetchingInspiration, setIsFetchingInspiration] = useState(false);

  // 加载场景属性向导配置
  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await getScenePresetConfig();
      if (res.success && res.data) {
        setStepOptions(res.data.stepOptions);
        setOptionsByType(res.data.optionsByType);
        setConflictRules(res.data.conflictRules);
        setSelections(new Array(res.data.stepOptions.length).fill(''));
        setConfigLoaded(true);
      } else {
        message.error(res.message || '场景配置加载失败');
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : '场景配置加载失败',
      );
    } finally {
      setConfigLoading(false);
    }
  }, []);

  // 每次打开时重置状态；首次打开加载配置
  useEffect(() => {
    if (open) {
      setWizardStep(0);
      setSceneAttributeStep(0);
      if (stepOptions.length > 0) {
        setSelections(new Array(stepOptions.length).fill(''));
      }
      setPrompt('');
      setSceneName('');
      setNameError('');
      setImageUrl(undefined);
      setImageUrls(undefined);
      setIsGeneratingImage(false);
      setSelectedModel(selectedImageModel);
      setSelectedTextModel(defaultTextModel);
      if (!configLoaded) {
        loadConfig();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedImageModel, defaultTextModel]);

  const handleSceneNameChange = (value: string) => {
    setSceneName(value);
    if (value.trim() && existingNames.includes(value.trim())) {
      setNameError('场景名称已存在，请换一个');
    } else {
      setNameError('');
    }
  };

  // 获取某步骤的可用选项
  const getAvailableOptions = (
    stepIndex: number,
    currentSelections: string[],
  ): string[] => {
    if (!stepOptions[stepIndex]) return [];
    const baseOptions = stepOptions[stepIndex].options;

    // 场景类型过滤
    const sceneType = currentSelections[0];
    let result = baseOptions;
    if (stepIndex > 0 && sceneType && optionsByType[sceneType]) {
      const stepTitle = stepOptions[stepIndex].title;
      const typeFiltered = optionsByType[sceneType][stepTitle];
      if (typeFiltered) {
        result = typeFiltered;
      }
    }

    // 应用冲突规则
    conflictRules.forEach(
      ([triggerStep, triggerValue, affectedStep, excludedValue]) => {
        if (affectedStep === stepIndex && currentSelections[triggerStep] === triggerValue) {
          result = result.filter((opt) => opt !== excludedValue);
        }
      },
    );

    return result;
  };

  // 清理不兼容的后续选项
  const clearIncompatibleSelections = (
    changedStep: number,
    currentSelections: string[],
  ): string[] => {
    const newSelections = [...currentSelections];

    // 场景类型或时间段改变时，清除所有后续不兼容选项
    if (changedStep === 0 || changedStep === 1) {
      for (let i = changedStep + 1; i < stepOptions.length; i++) {
        const available = getAvailableOptions(i, newSelections);
        if (newSelections[i] && !available.includes(newSelections[i])) {
          newSelections[i] = '';
        }
      }
    }

    return newSelections;
  };

  const handleSelectOption = (groupIndex: number, value: string) => {
    let newSelections = [...selections];
    newSelections[groupIndex] = value;
    newSelections = clearIncompatibleSelections(groupIndex, newSelections);
    setSelections(newSelections);
    // 头像式交互：选择后自动进入下一步
    if (groupIndex === sceneAttributeStep) {
      handleNextAttributeStep();
    }
  };

  const handleNextAttributeStep = () => {
    if (sceneAttributeStep < stepOptions.length - 1) {
      setSceneAttributeStep(sceneAttributeStep + 1);
    } else {
      setWizardStep(1);
    }
  };

  const handlePrevAttributeStep = () => {
    if (sceneAttributeStep > 0) {
      setSceneAttributeStep(sceneAttributeStep - 1);
    }
  };

  // 随机灵感：从后端预制库随机返回场景名称 + 提示词，自动填入
  const handleRandomPrompt = async () => {
    if (isFetchingInspiration) return;
    setIsFetchingInspiration(true);
    try {
      const sceneType = selections[0] || undefined;
      const res = await getRandomScenePreset(sceneType);
      if (res.success && res.data) {
        // 名称也一并填入（触发重名校验）
        handleSceneNameChange(res.data.name);
        setPrompt(res.data.prompt);
      } else {
        message.error(res.message || '获取灵感失败');
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : '获取灵感失败',
      );
    } finally {
      setIsFetchingInspiration(false);
    }
  };

  // AI 生成：根据场景名称，使用文本模型生成 ≤ 30 字画面提示词
  const handleGeneratePrompt = async () => {
    if (!sceneName.trim()) {
      message.warning('请先输入场景名称');
      return;
    }
    if (!selectedTextModel) {
      message.warning('请选择文本模型');
      return;
    }
    if (isGeneratingPrompt) return;
    setIsGeneratingPrompt(true);
    try {
      const res = await generateScenePromptApi(
        selectedTextModel,
        sceneName.trim(),
      );
      if (res.success && res.data?.prompt) {
        setPrompt(res.data.prompt);
        message.success('提示词已生成');
      } else {
        message.error(res.message || '生成提示词失败');
      }
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : '生成提示词失败',
      );
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // 真实执行场景图生成（预览确认后回调，或非预览模式直接调用）
  const executeGenerateImage = useCallback(async () => {
    setIsGeneratingImage(true);
    try {
      const res = await generateSceneImageApi(
        prompt.trim(),
        selectedModel,
        1,
        undefined,
        aspectRatio,
        undefined,
        undefined,
        false,
      );

      let urls: string[] = [];
      if (res && typeof res === 'object') {
        if ('success' in res && (res as any).success && (res as any).data) {
          urls = ((res as any).data as { images?: string[] })?.images || [];
        } else if ('images' in res) {
          urls = (res as { images?: string[] }).images || [];
        }
      }

      if (urls.length > 0) {
        setImageUrl(urls[0]);
        setImageUrls(urls);
        message.success('场景图生成成功');
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '场景图生成失败';
      message.error(errorMessage);
    } finally {
      setIsGeneratingImage(false);
    }
  }, [prompt, selectedModel, aspectRatio]);

  const handleGenerateImage = useCallback(async () => {
    if (!prompt.trim()) {
      message.warning('请输入场景提示词');
      return;
    }

    // 预览模式：先弹请求体预览 dialog，确认后再执行真实生成
    if (videoApiPreviewMode && showApiPreview) {
      showApiPreview(
        '场景图片生成请求预览',
        generateSceneImageApi(prompt.trim(), selectedModel, 1, undefined, aspectRatio, undefined, true),
        { prompt: prompt.trim(), model: selectedModel, aspectRatio },
        () => executeGenerateImage(),
      );
      return;
    }

    await executeGenerateImage();
  }, [prompt, selectedModel, aspectRatio, videoApiPreviewMode, showApiPreview, executeGenerateImage]);

  const handleSubmit = () => {
    if (!prompt.trim() || !sceneName.trim() || nameError) return;
    const scene: NewScene = {
      id: crypto.randomUUID(),
      name: sceneName.trim(),
      prompt: prompt.trim(),
      sceneType: selections[0],
      timeOfDay: selections[1],
      atmosphere: selections[2],
      lighting: selections[3],
      weather: selections[4],
      model: selectedModel,
      imageUrl,
      imageUrls,
    };
    onCreate(scene);
  };

  const handleCancel = () => {
    onCancel();
  };

  const allSelected =
    selections.length > 0 && selections.every((s) => s.trim() !== '');
  const canGoStep1 = allSelected;
  const canCreate = sceneName.trim() && prompt.trim() && !nameError && imageUrl;

  const stepItems = [
    { title: '选择属性' },
    { title: '生成场景' },
  ];

  // 渲染属性标签摘要
  const renderSummaryTags = () => (
    <div className="flex flex-wrap gap-2">
      {selections.map((value, index) =>
        value ? (
          <span
            key={index}
            className="px-2 py-1 rounded-md bg-bg-secondary text-xs text-text-secondary border border-border"
          >
            {stepOptions[index]?.title}: {value}
          </span>
        ) : null,
      )}
    </div>
  );

  // Step 0：选择属性（一次展示一组，分步向导）
  const renderStep0 = () => {
    if (configLoading || stepOptions.length === 0) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spin tip="加载场景配置..." />
        </div>
      );
    }

    const currentGroup = stepOptions[sceneAttributeStep];
    const options = getAvailableOptions(sceneAttributeStep, selections);
    const isFirst = sceneAttributeStep === 0;
    const isLast = sceneAttributeStep === stepOptions.length - 1;
    const currentSelected = selections[sceneAttributeStep];

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-text-primary">{currentGroup.title}</h3>
            <p className="text-xs text-text-muted mt-1">
              步骤 {sceneAttributeStep + 1} / {stepOptions.length}
            </p>
          </div>
          <div className="flex gap-1">
            {stepOptions.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setSceneAttributeStep(idx)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  idx === sceneAttributeStep
                    ? 'bg-accent-primary'
                    : idx < sceneAttributeStep || selections[idx]
                    ? 'bg-accent-primary/40'
                    : 'bg-border'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[340px] overflow-y-auto pr-1">
          {options.map((option) => {
            const isSelected = currentSelected === option;
            return (
              <motion.button
                key={option}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleSelectOption(sceneAttributeStep, option)}
                className={`
                  p-3 rounded-xl border text-sm font-medium transition-all text-center
                  ${isSelected
                    ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                    : 'border-border bg-bg-tertiary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary'
                  }
                `}
                title={option}
              >
                {option}
              </motion.button>
            );
          })}
        </div>

        {currentSelected && (
          <div className="flex justify-end gap-3 pt-2">
            {!isFirst && (
              <Button onClick={handlePrevAttributeStep}>上一步</Button>
            )}
            <Button
              type="primary"
              onClick={handleNextAttributeStep}
              className="!text-white"
            >
              {isLast ? '下一步：生成场景' : '下一步'}
            </Button>
          </div>
        )}

        {selections.some((s) => s.trim() !== '') && (
          <div className="rounded-xl bg-bg-tertiary p-3">
            <div className="text-xs text-text-secondary mb-2">已选配置</div>
            {renderSummaryTags()}
          </div>
        )}
      </div>
    );
  };

  // Step 1：生成场景（名称、提示词、场景图合并）
  const renderStep1 = () => (
    <div className="flex flex-col md:flex-row gap-6">
      {/* 左侧：场景图预览 + 模型 + 生成按钮 */}
      <div className="flex-shrink-0 w-full md:w-72 flex flex-col gap-4">
        <div
          className={`w-full rounded-2xl overflow-hidden border border-border bg-bg-tertiary flex items-center justify-center relative group ${
            aspectRatio === '9:16'
              ? 'aspect-[9/16]'
              : aspectRatio === '21:9'
              ? 'aspect-[21/9]'
              : 'aspect-[16/9]'
          }`}
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="场景预览"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-text-muted">
              <ImageIcon size={40} />
              <span className="text-xs">场景图预览</span>
            </div>
          )}

          {isGeneratingImage && (
            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
              <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-white">生成中...</span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-text-secondary">图像模型</label>
            <Select
              value={selectedModel}
              onChange={setSelectedModel}
              options={imageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
              size="middle"
              className="w-full"
              popupMatchSelectWidth={false}
              disabled={isGeneratingImage}
            />
          </div>

          <Button
            type="primary"
            size="large"
            icon={imageUrl ? <RefreshCw size={18} /> : <Sparkles size={18} />}
            onClick={handleGenerateImage}
            loading={isGeneratingImage}
            disabled={!prompt.trim() || isGeneratingImage}
            className="w-full !text-white"
          >
            {imageUrl ? '重新生成场景图' : '生成场景图'}
          </Button>
        </div>
      </div>

      {/* 右侧：名称、提示词、配置摘要 */}
      <div className="flex-1 min-w-0 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text-primary">
            场景名称 <span className="text-accent-error">*</span>
          </label>
          <Input
            value={sceneName}
            onChange={(e) => handleSceneNameChange(e.target.value)}
            placeholder="给这个场景起个名字"
            size="large"
            status={nameError ? 'error' : undefined}
          />
          {nameError && (
            <p className="text-xs text-accent-error">{nameError}</p>
          )}

          {/* AI 生成提示词：文本模型 + 生成按钮 */}
          <div className="flex items-center gap-2 pt-1">
            <Select
              value={selectedTextModel}
              onChange={setSelectedTextModel}
              options={textModels.map((m) => ({
                value: m.id,
                label: m.name,
                disabled: m.disabled,
              }))}
              size="middle"
              className="flex-1"
              popupMatchSelectWidth={false}
              disabled={isGeneratingPrompt}
            />
            <Tooltip title="根据场景名称，用文本模型生成 30 字以内的画面提示词">
              <Button
                type="primary"
                icon={<Sparkles size={14} />}
                onClick={handleGeneratePrompt}
                loading={isGeneratingPrompt}
                disabled={!sceneName.trim() || isGeneratingPrompt}
                className="!text-white"
              >
                AI生成
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-primary">场景提示词</label>
            <Tooltip title="随机生成一条场景名称与提示词">
              <Button
                type="text"
                size="small"
                icon={<Shuffle size={14} />}
                onClick={handleRandomPrompt}
                loading={isFetchingInspiration}
                disabled={isFetchingInspiration}
                className="text-text-muted hover:!text-accent-primary"
              >
                随机灵感
              </Button>
            </Tooltip>
          </div>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要的场景画面，也可以直接编辑上方自动生成的提示词"
            autoSize={{ minRows: 4, maxRows: 6 }}
            className="bg-bg-tertiary border-border rounded-xl"
          />
        </div>

        <div className="rounded-xl bg-bg-tertiary p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">已选配置</span>
            <button
              onClick={() => setWizardStep(0)}
              className="text-xs text-accent-primary hover:underline"
            >
              修改
            </button>
          </div>
          {renderSummaryTags()}
        </div>
      </div>
    </div>
  );

  // 底部操作栏
  const renderFooter = () => {
    if (wizardStep === 0) {
      return (
        <div className="flex justify-end gap-3 pt-2">
          <Button onClick={handleCancel}>取消</Button>
        </div>
      );
    }

    return (
      <div className="flex justify-between gap-3 pt-2">
        <Button onClick={() => setWizardStep(0)}>上一步</Button>
        <Button
          type="primary"
          onClick={handleSubmit}
          disabled={!canCreate}
          icon={<ImagePlus size={16} />}
          className="!text-white"
        >
          创建场景
        </Button>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      width={820}
      centered
      footer={null}
      destroyOnHidden
      title={
        <div className="flex items-center gap-2 text-text-primary">
          <ImagePlus size={20} className="text-accent-primary" />
          <span>创建场景</span>
        </div>
      }
    >
      <div className="py-4 space-y-5">
        <Steps
          current={wizardStep}
          size="small"
          onChange={(step) => {
            if (step <= wizardStep) {
              setWizardStep(step);
            } else if (step === 1 && canGoStep1) {
              setWizardStep(1);
            }
          }}
          items={stepItems}
        />

        <div>
          {wizardStep === 0 && renderStep0()}
          {wizardStep === 1 && renderStep1()}
        </div>

        {renderFooter()}
      </div>
    </Modal>
  );
};
