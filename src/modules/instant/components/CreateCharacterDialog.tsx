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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, Button, Steps, Input, Select, Spin, Tooltip } from 'antd';
import { Shuffle, UserPlus, User, Sparkles, RefreshCw, Scan, Eye, ChevronLeft, ChevronRight, Trash2, Plus, ZoomIn, Upload, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CharacterImage } from '@/shared/types';
import type { ModelConfig } from '@/shared/types/index';
import type { InstantCharacter } from '@/shared/types/project';
import { generateAvatarApi, generateCharacterViewsApi, generateCharacterPortraitApi } from '@/modules/workflow/api/characterApi';
import { generatePortraitPromptApi } from '@/modules/workflow/api/sceneApi';
import { pollJobStatus } from '@/modules/workflow/api/aiJobApi';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { ImagePreviewModal } from '@/shared/components/ui/ImagePreviewModal';
import { message } from '@/shared/utils/message';
import {
  CHARACTER_STEP_OPTIONS,
  PERSONALITY_BY_GENDER_AGE,
  APPEARANCE_BY_GENDER_AGE,
  OCCUPATION_BY_GENDER_AGE,
  PRESET_CHARACTER_NAMES,
} from './data';

export interface NewCharacter {
  id: string;
  name: string;
  avatar?: string;
  taskSummary: string;
  gender: string;
  ageGroup: string;
  personality: string;
  appearance: string;
  occupation: string;
  model?: string;
  avatarPrompt?: string;
  imagePrompt?: string;
  portraitPrompt?: string;
  voicePrompt?: string;
  avatarImages?: CharacterImage[];
  portraitImages?: CharacterImage[];
  fullBodyImages?: CharacterImage[];
  isGeneratingAvatar?: boolean;
  isGeneratingViews?: boolean;
  isGeneratingPortrait?: boolean;
}

interface CreateCharacterDialogProps {
  open: boolean;
  onCancel: () => void;
  onCreate: (character: NewCharacter) => void;
  imageModels: ModelConfig[];
  selectedImageModel: string;
  /** 文本模型列表（用于 AI 生成形象提示词） */
  textModels: ModelConfig[];
  /** 默认文本模型 */
  defaultTextModel: string;
  projectId: string | undefined;
  onOpenAvatarPreview?: (character: InstantCharacter) => void;
  onOpenMultiView?: (character: InstantCharacter) => void;
  multiViewChar?: InstantCharacter | null;
}

const buildCharacterSummary = (selections: string[]): string => {
  return [
    selections[0] && `性别：${selections[0]}`,
    selections[1] && `年龄段：${selections[1]}`,
    selections[2] && `性格：${selections[2]}`,
    selections[3] && `外貌：${selections[3]}`,
    selections[4] && `职业：${selections[4]}`,
  ]
    .filter(Boolean)
    .join('，');
};

const buildAvatarPrompt = (name: string, selections: string[]): string => {
  const [gender, ageGroup, personality, appearance, occupation] = selections;
  const displayName = name.trim() || '角色';
  return `${displayName}，${gender}，${ageGroup}，${personality}，${appearance}，职业是${occupation}。高清头像，正面照，细腻五官。`;
};

const buildViewsPrompt = (name: string, selections: string[]): string => {
  const [gender, , personality, appearance, occupation] = selections;
  const displayName = name.trim() || '角色';
  return `${displayName}，${gender}，${appearance}，性格${personality}，职业是${occupation}。全身照。`;
};

export const CreateCharacterDialog: React.FC<CreateCharacterDialogProps> = ({
  open,
  onCancel,
  onCreate,
  imageModels,
  selectedImageModel,
  textModels,
  defaultTextModel,
  projectId,
  onOpenAvatarPreview,
}) => {
  // 向导步骤：0=选择属性，1=编辑/生成头像，2=剧本box风格预览/编辑
  const [wizardStep, setWizardStep] = useState(0);
  // 属性选择子步骤：0-4 对应 CHARACTER_STEP_OPTIONS
  const [attrStep, setAttrStep] = useState(0);
  const [selections, setSelections] = useState<string[]>(
    new Array(CHARACTER_STEP_OPTIONS.length).fill(''),
  );
  const [name, setName] = useState('');
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [imagePrompt, setImagePrompt] = useState(''); // 全身提示词
  const [voicePrompt, setVoicePrompt] = useState(''); // 音色提示词
  const [avatar, setAvatar] = useState<string | undefined>();
  const [avatarImages, setAvatarImages] = useState<CharacterImage[] | undefined>();
  const [fullBodyImages, setFullBodyImages] = useState<CharacterImage[] | undefined>();
  const [portraitImages, setPortraitImages] = useState<CharacterImage[] | undefined>();
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [selectedModel, setSelectedModel] = useState(selectedImageModel);
  const [tempCharacterId, setTempCharacterId] = useState('');

  // 剧本 box 风格的扩展图片状态
  const imageToImageModels = useMemo(
    () => imageModels.filter((m) => m.supports?.image_to_image === true),
    [imageModels],
  );
  const defaultImageToImageModel = useMemo(() => {
    const found = imageToImageModels.find((m) => m.id === selectedImageModel);
    return found?.id || imageToImageModels[0]?.id || selectedImageModel;
  }, [imageToImageModels, selectedImageModel]);

  const [viewsPrompt, setViewsPrompt] = useState('');
  const [viewsModel, setViewsModel] = useState(defaultImageToImageModel);
  const [isGeneratingViews, setIsGeneratingViews] = useState(false);
  const [fullBodyIndex, setFullBodyIndex] = useState(0);

  const [portraitTitle, setPortraitTitle] = useState('');
  const [portraitPrompt, setPortraitPrompt] = useState('');
  const [portraitModel, setPortraitModel] = useState(defaultImageToImageModel);
  const [isGeneratingPortrait, setIsGeneratingPortrait] = useState(false);

  // 添加形象照 dialog 状态（与 MultiViewModal 保持一致）
  const [portraitDialogOpen, setPortraitDialogOpen] = useState(false);
  const [portraitPreviewUrl, setPortraitPreviewUrl] = useState('');

  // AI 生成形象提示词相关状态
  const [portraitTextModel, setPortraitTextModel] = useState(defaultTextModel);
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
      const res = await generatePortraitPromptApi(
        portraitTextModel,
        portraitTitle.trim(),
      );
      if (res.success && res.data?.prompt) {
        setPortraitPrompt(res.data.prompt);
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

  // 素材库相关

  // 通用图片预览
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');

  // 本地文件上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fullbodyFileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开时重置状态
  useEffect(() => {
    if (open) {
      setWizardStep(0);
      setAttrStep(0);
      setSelections(new Array(CHARACTER_STEP_OPTIONS.length).fill(''));
      setName('');
      setAvatarPrompt('');
      setImagePrompt('');
      setVoicePrompt('');
      setAvatar(undefined);
      setAvatarImages(undefined);
      setFullBodyImages(undefined);
      setPortraitImages(undefined);
      setIsGeneratingAvatar(false);
      setSelectedModel(selectedImageModel);
      setTempCharacterId(crypto.randomUUID());
      setViewsPrompt('');
      setViewsModel(defaultImageToImageModel);
      setIsGeneratingViews(false);
      setFullBodyIndex(0);
      setPortraitTitle('');
      setPortraitPrompt('');
      setPortraitModel(defaultImageToImageModel);
      setIsGeneratingPortrait(false);
    }
  }, [open, selectedImageModel, defaultImageToImageModel]);

  // 根据选择项自动生成头像提示词
  useEffect(() => {
    setAvatarPrompt(buildAvatarPrompt(name, selections));
  }, [name, selections]);

  // 进入剧本 box 步骤时，若提示词为空则填入默认多视图提示词
  useEffect(() => {
    if (wizardStep === 2) {
      if (!viewsPrompt.trim()) {
        setViewsPrompt(buildViewsPrompt(name, selections));
      }
      if (!imagePrompt.trim()) {
        setImagePrompt(buildViewsPrompt(name, selections));
      }
      if (!avatarPrompt.trim()) {
        setAvatarPrompt(buildAvatarPrompt(name, selections));
      }
    }
  }, [wizardStep, name, selections, viewsPrompt, imagePrompt, avatarPrompt]);

  const draftCharacter = useMemo<NewCharacter>(
    () => ({
      id: tempCharacterId || crypto.randomUUID(),
      name: name.trim() || '角色',
      taskSummary: buildCharacterSummary(selections),
      gender: selections[0] || '',
      ageGroup: selections[1] || '',
      personality: selections[2] || '',
      appearance: selections[3] || '',
      occupation: selections[4] || '',
      model: selectedModel,
      avatarPrompt: avatarPrompt.trim() || buildAvatarPrompt(name.trim(), selections),
      imagePrompt: imagePrompt.trim() || viewsPrompt.trim() || avatarPrompt.trim() || buildAvatarPrompt(name.trim(), selections),
      portraitPrompt: portraitPrompt.trim() || undefined,
      voicePrompt: voicePrompt.trim() || undefined,
      avatar,
      avatarImages,
      fullBodyImages,
      portraitImages,
    }),
    [
      tempCharacterId,
      name,
      selections,
      selectedModel,
      avatarPrompt,
      imagePrompt,
      viewsPrompt,
      portraitPrompt,
      voicePrompt,
      avatar,
      avatarImages,
      fullBodyImages,
      portraitImages,
    ],
  );

  const getAvailableOptions = (stepIndex: number, currentSelections: string[]): string[] => {
    const gender = currentSelections[0];
    const ageGroup = currentSelections[1];
    if (stepIndex === 2 && gender && ageGroup) {
      return PERSONALITY_BY_GENDER_AGE[gender]?.[ageGroup] || CHARACTER_STEP_OPTIONS[2].options;
    }
    if (stepIndex === 3 && gender && ageGroup) {
      return APPEARANCE_BY_GENDER_AGE[gender]?.[ageGroup] || CHARACTER_STEP_OPTIONS[3].options;
    }
    if (stepIndex === 4 && gender && ageGroup) {
      return OCCUPATION_BY_GENDER_AGE[gender]?.[ageGroup] || CHARACTER_STEP_OPTIONS[4].options;
    }
    return CHARACTER_STEP_OPTIONS[stepIndex].options;
  };

  const clearIncompatibleSelections = (
    changedStep: number,
    currentSelections: string[],
  ): string[] => {
    const newSelections = [...currentSelections];
    if (changedStep === 0 || changedStep === 1) {
      for (let i = changedStep + 1; i < CHARACTER_STEP_OPTIONS.length; i++) {
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
    setAvatarPrompt(buildAvatarPrompt(name, newSelections));

    // 当前组选完且不是最后一组时，自动进入下一组
    if (groupIndex === attrStep && groupIndex < CHARACTER_STEP_OPTIONS.length - 1) {
      setAttrStep(groupIndex + 1);
    }
  };

  const handleAttrNext = () => {
    if (attrStep < CHARACTER_STEP_OPTIONS.length - 1) {
      setAttrStep(attrStep + 1);
    } else {
      setWizardStep(1);
    }
  };

  const handleAttrPrev = () => {
    if (attrStep > 0) {
      setAttrStep(attrStep - 1);
    }
  };

  const handleRandomName = () => {
    const randomName = PRESET_CHARACTER_NAMES[Math.floor(Math.random() * PRESET_CHARACTER_NAMES.length)];
    setName(randomName);
  };

  const handleGenerateAvatar = useCallback(async () => {
    if (!name.trim()) {
      message.warning('请先输入角色名称');
      return;
    }
    if (!projectId) {
      message.warning('项目ID不存在，无法生成头像');
      return;
    }

    const prompt = avatarPrompt.trim() || buildAvatarPrompt(name.trim(), selections);
    const model = selectedModel;
    const characterId = tempCharacterId || crypto.randomUUID();
    if (!tempCharacterId) {
      setTempCharacterId(characterId);
    }

    setIsGeneratingAvatar(true);
    try {
      const res = await generateAvatarApi(characterId, prompt, model, undefined, undefined, undefined, true);

      if (!res.success) {
        message.error('头像生成提交失败');
        return;
      }

      const jobData = res.data as { jobId?: string; avatarUrls?: string[] } | undefined;
      let urls: string[] = [];

      if (jobData?.jobId) {
        const pollResult = await pollJobStatus<{ avatarUrls?: string[] }>(jobData.jobId, {
          interval: 3000,
          maxWaitTime: 5 * 60 * 1000,
        });

        if (!pollResult.success) {
          message.error(pollResult.error || '头像生成失败');
          return;
        }
        urls = pollResult.data?.avatarUrls || [];
      } else {
        urls = jobData?.avatarUrls || [];
      }

      if (urls.length > 0) {
        const images = urls.map((url) => ({ imageUrl: url, name: '头像', isPortrait: true }));
        setAvatarImages(images);
        setAvatar(urls[0]);
        message.success('头像生成成功');
        // 头像生成成功后自动进入剧本 box 风格步骤
        setWizardStep(2);
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '头像生成失败';
      message.error(errorMessage);
    } finally {
      setIsGeneratingAvatar(false);
    }
  }, [name, avatarPrompt, selections, selectedModel, projectId, tempCharacterId]);

  const handleGenerateViews = useCallback(async () => {
    if (!projectId) {
      message.warning('项目ID不存在');
      return;
    }
    const characterId = tempCharacterId;
    const referenceAvatarUrl = avatar?.trim() || avatarImages?.[0]?.imageUrl || '';
    if (!referenceAvatarUrl) {
      message.warning('请先生成头像');
      return;
    }
    const prompt = viewsPrompt.trim() || buildViewsPrompt(name.trim(), selections);
    const model = viewsModel || defaultImageToImageModel;

    setIsGeneratingViews(true);
    try {
      const res = await generateCharacterViewsApi(
        characterId,
        model,
        referenceAvatarUrl,
        undefined,
        prompt,
        '16:9',
        undefined,
        undefined,
        true,
      );

      if (!res.success) {
        message.error('多视图提交失败');
        return;
      }

      const jobData = res.data as { jobId?: string; fullBodyUrls?: string[] } | undefined;
      let urls: string[] = [];
      if (jobData?.jobId) {
        const pollResult = await pollJobStatus<{ fullBodyUrls?: string[] }>(jobData.jobId, {
          interval: 3000,
          maxWaitTime: 5 * 60 * 1000,
        });
        if (!pollResult.success) {
          message.error(pollResult.error || '多视图生成失败');
          return;
        }
        urls = pollResult.data?.fullBodyUrls || [];
      } else {
        urls = jobData?.fullBodyUrls || [];
      }

      if (urls.length > 0) {
        const referenceAvatarId = avatarImages?.[0]?.id;
        const newImages = urls.map((url) => ({
          imageUrl: url,
          name: '全身照',
          isPortrait: false,
          referenceAvatarId,
          prompt,
          model,
        }));
        setFullBodyImages((prev) => {
          const next = [...(prev || []), ...newImages];
          setFullBodyIndex(Math.max(0, next.length - 1));
          return next;
        });
        // 同步更新 imagePrompt
        setImagePrompt(prompt);
        message.success('多视图生成成功');
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '多视图生成失败';
      message.error(errorMessage);
    } finally {
      setIsGeneratingViews(false);
    }
  }, [projectId, tempCharacterId, avatar, avatarImages, viewsPrompt, viewsModel, defaultImageToImageModel, name, selections]);

  // 打开添加形象照 dialog
  const handleOpenAddPortrait = () => {
    setPortraitTitle('');
    setPortraitPrompt('');
    setPortraitModel(defaultImageToImageModel);
    setPortraitPreviewUrl('');
    setPortraitDialogOpen(true);
  };

  // dialog 中点击"生成形象图"
  const handleGeneratePortraitInDialog = useCallback(async () => {
    if (!projectId) {
      message.warning('项目ID不存在');
      return;
    }
    const prompt = portraitPrompt.trim();
    if (!prompt) {
      message.warning('请输入形象图描述');
      return;
    }
    const avatarUrl = avatar?.trim() || avatarImages?.[0]?.imageUrl || '';
    if (!avatarUrl) {
      message.warning('请先生成头像');
      return;
    }
    const model = portraitModel || defaultImageToImageModel;
    const characterId = tempCharacterId;

    setIsGeneratingPortrait(true);
    try {
      const res = await generateCharacterPortraitApi(characterId, {
        avatarUrl,
        portraitPrompt: prompt,
        model,
        count: 1,
        aspectRatio: '9:16',
        async: true,
      });

      if (!res.success) {
        message.error('形象图提交失败');
        return;
      }

      const jobData = res.data as { jobId?: string; portraitUrls?: string[] } | undefined;
      let urls: string[] = [];
      if (jobData?.jobId) {
        const pollResult = await pollJobStatus<{ portraitUrls?: string[] }>(jobData.jobId, {
          interval: 3000,
          maxWaitTime: 5 * 60 * 1000,
        });
        if (!pollResult.success) {
          message.error(pollResult.error || '形象图生成失败');
          return;
        }
        urls = pollResult.data?.portraitUrls || [];
      } else {
        urls = jobData?.portraitUrls || [];
      }

      if (urls.length > 0) {
        setPortraitPreviewUrl(urls[0]);
        message.success('形象图生成成功，点击"确认添加"');
      } else {
        message.error('未返回有效图片');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '形象图生成失败';
      message.error(errorMessage);
    } finally {
      setIsGeneratingPortrait(false);
    }
  }, [projectId, tempCharacterId, avatar, avatarImages, portraitPrompt, portraitModel, defaultImageToImageModel]);

  // dialog 中点击"确认添加"
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
    const referenceAvatarId = avatarImages?.[0]?.id;

    // instant 项目 image_asset 行由 saveProjectAssets 自动创建，前端只需提供稳定 id 作为 asset_key
    const portraitAssetKey = crypto.randomUUID();
    const newImage = {
      id: portraitAssetKey,
      assetId: portraitAssetKey,
      imageUrl: portraitPreviewUrl,
      name: portraitTitle.trim(),
      referenceAvatarId,
      prompt: portraitPrompt.trim(),
      model,
    };
    setPortraitImages((prev) => [...(prev || []), newImage]);
    setPortraitDialogOpen(false);
    setPortraitPreviewUrl('');
    message.success('形象照已添加');
  };

  // 关闭添加形象照 dialog
  const handleClosePortraitDialog = () => {
    setPortraitDialogOpen(false);
    setPortraitPreviewUrl('');
  };

  const handleDeleteFullBody = (index: number) => {
    setFullBodyImages((prev) => {
      const next = (prev || []).filter((_, i) => i !== index);
      setFullBodyIndex((cur) => Math.min(cur, Math.max(0, next.length - 1)));
      return next;
    });
  };

  const handleDeletePortrait = (index: number) => {
    setPortraitImages((prev) => (prev || []).filter((_, i) => i !== index));
  };

  const openImagePreview = (images: string[], title: string, startIndex = 0) => {
    setPreviewImages(images);
    setPreviewCurrentIndex(startIndex);
    setPreviewTitle(title);
    setPreviewOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      message.warning('请输入角色名称');
      return;
    }
    const character: NewCharacter = {
      ...draftCharacter,
      name: name.trim(),
    };
    onCreate(character);
  };

  const handleCancel = () => {
    onCancel();
  };


  const allSelected = selections.every((s) => s.trim() !== '');
  const canGenerateAvatar = name.trim() && allSelected;

  const stepItems = [
    { title: '选择属性' },
    { title: '生成头像' },
    { title: '完善角色' },
  ];

  // 渲染左侧头像占位/预览（含图像模型选择和生成按钮）
  const renderAvatarPanel = (size: 'normal' | 'large' = 'normal') => {
    const isLarge = size === 'large';
    const sizeClass = isLarge ? 'w-64 h-64' : 'w-52 h-52';
    return (
      <div className="flex flex-col items-center gap-4 w-full">
        {avatar ? (
          <div
            className={`relative ${sizeClass} rounded-full overflow-hidden border border-border group cursor-pointer`}
            onClick={() => onOpenAvatarPreview?.(draftCharacter as InstantCharacter)}
          >
            <img src={avatar} alt="角色头像" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="flex items-center gap-1 text-white text-sm">
                <Eye size={16} />
                <span>查看大图</span>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`${sizeClass} rounded-full bg-bg-tertiary border border-border flex items-center justify-center`}
          >
            <User size={isLarge ? 96 : 80} className="text-text-muted" />
          </div>
        )}

        {/* 图像模型选择放在生成按钮上方 */}
        <div className="w-full space-y-1">
          <span className="text-xs text-text-secondary">图像模型</span>
          <Select
            value={selectedModel}
            onChange={setSelectedModel}
            options={imageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
            size="small"
            className="w-full"
            popupMatchSelectWidth={false}
            disabled={isGeneratingAvatar}
          />
        </div>

        {isGeneratingAvatar ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <Spin size="small" />
            <span>生成中...</span>
          </div>
        ) : (
          <Button
            type="primary"
            icon={avatar ? <RefreshCw size={16} /> : <Sparkles size={16} />}
            onClick={handleGenerateAvatar}
            loading={isGeneratingAvatar}
            disabled={!canGenerateAvatar}
            className="w-full !text-white"
          >
            {avatar ? '重新生成头像' : '生成头像'}
          </Button>
        )}
      </div>
    );
  };

  // 渲染角色配置摘要标签
  const renderSummaryTags = () => (
    <div className="flex flex-wrap gap-2">
      {[
        { label: '性别', value: selections[0] },
        { label: '年龄段', value: selections[1] },
        { label: '性格', value: selections[2] },
        { label: '外貌', value: selections[3] },
        { label: '职业', value: selections[4] },
      ].map((item, idx) =>
        item.value ? (
          <span
            key={idx}
            className="px-2 py-1 rounded-md bg-bg-secondary text-xs text-text-secondary border border-border"
          >
            {item.label}: {item.value}
          </span>
        ) : null,
      )}
    </div>
  );

  // Step 1：分组单步选择属性
  const renderStep1 = () => {
    const currentGroup = CHARACTER_STEP_OPTIONS[attrStep];
    const currentOptions = getAvailableOptions(attrStep, selections);
    const progressPercent = Math.round(((attrStep + 1) / CHARACTER_STEP_OPTIONS.length) * 100);
    const currentSelected = selections[attrStep];

    return (
      <div className="space-y-5">
        {/* 进度与标题 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium text-text-primary">
              {currentGroup.title}
            </h3>
            <span className="text-xs text-text-secondary">
              {attrStep + 1} / {CHARACTER_STEP_OPTIONS.length}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 选项网格 */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
          {currentOptions.map((option) => {
            const isSelected = currentSelected === option;
            return (
              <motion.button
                key={option}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => handleSelectOption(attrStep, option)}
                className={`
                  p-2.5 rounded-lg border text-xs font-medium transition-all text-left truncate
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

        {/* 已完成摘要 */}
        <div className="rounded-xl bg-bg-tertiary p-3">
          <div className="text-xs text-text-secondary mb-2">已选配置</div>
          {selections.some((s) => s.trim() !== '') ? (
            renderSummaryTags()
          ) : (
            <span className="text-xs text-text-muted">请选择 {currentGroup.title}</span>
          )}
        </div>

        {/* 底部导航 */}
        <div className="flex justify-between gap-3 pt-2">
          <Button
            onClick={handleAttrPrev}
            disabled={attrStep === 0}
            icon={<ChevronLeft size={16} />}
          >
            上一步
          </Button>
          <Button
            type="primary"
            onClick={handleAttrNext}
            disabled={!currentSelected}
            icon={<ChevronRight size={16} />}
            className="!text-white"
          >
            下一步
          </Button>
        </div>
      </div>
    );
  };

  // Step 2：编辑与生成头像
  const renderStep2 = () => (
    <div className="flex gap-6">
      <div className="flex-shrink-0 w-56 flex flex-col items-center gap-4 pt-2">
        {renderAvatarPanel('normal')}
      </div>
      <div className="flex-1 min-w-0 space-y-4">
        {/* 名称 */}
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入角色名称"
            size="large"
            className="flex-1"
          />
          <Button size="large" icon={<Shuffle size={16} />} onClick={handleRandomName}>
            随机
          </Button>
        </div>

        {/* 统一的头像提示词编辑框 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">头像生成提示词</span>
            <span className="text-[10px] text-text-muted">可直接编辑，或返回上一步重选属性</span>
          </div>
          <Input.TextArea
            value={avatarPrompt}
            onChange={(e) => setAvatarPrompt(e.target.value)}
            placeholder="描述角色头像的提示词，例如：陆景琛，男性，青年，冷酷孤傲，剑眉星目，职业是总裁。高清头像，正面照，细腻五官。"
            rows={4}
          />
        </div>

      </div>
    </div>
  );

  // Step 3：完全参照剧本 CharacterCard 的左右分栏布局
  const renderStep3 = () => {
    const hasFullBody = fullBodyImages && fullBodyImages.length > 0;
    const hasPortrait = portraitImages && portraitImages.length > 0;
    const currentFullBody = hasFullBody ? fullBodyImages![fullBodyIndex] : null;
    const currentAvatarUrl = avatarImages?.[0]?.imageUrl;

    return (
      <div className="flex gap-5 items-start">
        {/* 左侧：角色信息与头像 */}
        <div className="flex-1 min-w-0">
          {/* 头像 + 名称/描述/操作 */}
          <div className="flex items-start gap-4 mb-4">
            {/* 头像预览（参照剧本 box） */}
            <div
              className="relative w-24 h-24 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer"
              onClick={() => currentAvatarUrl && openImagePreview([currentAvatarUrl], `${name} - 头像`)}
            >
              {currentAvatarUrl ? (
                <>
                  <img
                    src={currentAvatarUrl}
                    alt={name}
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-base font-semibold bg-transparent border-border"
                placeholder="角色名称"
              />
              <Input
                value={selections[3] ? `${selections[0] || ''}，${selections[1] || ''}，${selections[3]}` : ''}
                onChange={(e) => {
                  // 简化的描述输入：直接更新 appearance
                  const newAppearance = e.target.value;
                  const newSelections = [...selections];
                  newSelections[3] = newAppearance;
                  setSelections(newSelections);
                }}
                className="text-sm text-text-secondary bg-transparent border-border"
                placeholder="角色描述"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-muted whitespace-nowrap">图片模型:</span>
                <Select
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={imageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
                  size="small"
                  popupMatchSelectWidth={false}
                  className="min-w-[120px]"
                />
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  <ModelPriceTag model={imageModels.find((m) => m.id === selectedModel)} />
                </span>
                <Button
                  onClick={handleGenerateAvatar}
                  loading={isGeneratingAvatar}
                  icon={<ImageIcon size={14} />}
                  size="small"
                  className="bg-accent-primary text-white"
                >
                  {avatar ? '重生成头像' : '生成头像'}
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  icon={<Upload size={14} />}
                  size="small"
                  className="text-text-secondary border-border"
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    // 简化的本地上传：直接预览
                    const url = URL.createObjectURL(file);
                    setAvatar(url);
                    setAvatarImages([{ imageUrl: url, name: '头像', isPortrait: true }]);
                    message.success('头像已选择（创建时将上传）');
                  }}
                />
              </div>
            </div>
          </div>

          {/* 头像提示词 */}
          <div className="flex items-start gap-2 mb-3">
            <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">头像提示词</span>
            <Input.TextArea
              value={avatarPrompt}
              onChange={(e) => setAvatarPrompt(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              className="flex-1 bg-bg-tertiary border-border text-sm"
              placeholder="请输入头像生成提示词"
            />
          </div>

          {/* 全身提示词 */}
          <div className="flex items-start gap-2">
            <span className="text-xs text-text-muted whitespace-nowrap mt-1.5">全身提示词</span>
            <Input.TextArea
              value={imagePrompt}
              onChange={(e) => {
                setImagePrompt(e.target.value);
                setViewsPrompt(e.target.value);
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
              value={voicePrompt}
              onChange={(e) => setVoicePrompt(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 4 }}
              className="flex-1 bg-bg-tertiary border-border text-sm"
              placeholder="描述角色的声音特征，如：年轻女性，普通话，语速中等，温柔细腻..."
            />
          </div>

          {/* 形象照网格 */}
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-text-muted">形象照</span>
              <span className="text-xs text-text-muted">({portraitImages?.length || 0}/5)</span>
            </div>
            <div className="flex items-start gap-3 flex-wrap">
              {portraitImages?.map((img, index) => (
                <div key={`portrait-${index}`} className="flex flex-col items-center gap-1">
                  <div
                    className="relative h-32 rounded-lg overflow-hidden bg-bg-tertiary flex-shrink-0 group cursor-pointer border border-border"
                    style={{ aspectRatio: '9/16', width: '72px' }}
                    onClick={() => img.imageUrl && openImagePreview([img.imageUrl], `${name} - 形象照 ${index + 1}`)}
                  >
                    {img.imageUrl && (
                      <img
                        src={img.imageUrl}
                        alt={img.name || `形象照 ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    )}
                    {/* hover 操作按钮 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // 重新生成：删除后再次点击"+"按钮
                          handleDeletePortrait(index);
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
                  <span className="text-xs text-text-secondary text-center truncate max-w-[72px]" title={img.name}>
                    {img.name || `形象照${index + 1}`}
                  </span>
                </div>
              ))}
              {/* 添加按钮 */}
              {(portraitImages?.length || 0) < 5 && (
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={handleOpenAddPortrait}
                    className="h-32 rounded-lg border-2 border-dashed border-border hover:border-accent-primary/60 flex items-center justify-center text-text-muted hover:text-accent-primary transition-colors bg-bg-tertiary/50 px-3"
                    style={{ aspectRatio: '9/16', width: '72px' }}
                    title="添加形象照"
                  >
                    {isGeneratingPortrait ? (
                      <div className="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Plus size={20} />
                    )}
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
            onClick={() => currentFullBody?.imageUrl && openImagePreview([currentFullBody.imageUrl], `${name} - 全身照`)}
          >
            {isGeneratingViews ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-10">
                <Spin size="default" />
                <span className="mt-2 text-xs text-white">生成中...</span>
              </div>
            ) : currentFullBody?.imageUrl ? (
              <>
                <img
                  src={currentFullBody.imageUrl}
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
            {currentFullBody?.imageUrl && !isGeneratingViews && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleGenerateViews();
                }}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title="重新生成"
              >
                <RefreshCw size={12} className="text-white" />
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
              value={viewsModel}
              onChange={setViewsModel}
              options={imageToImageModels.map((m) => ({ value: m.id, label: m.name, disabled: m.disabled }))}
              size="small"
              popupMatchSelectWidth={false}
              style={{ minWidth: 90 }}
            />
            <div className="flex items-center gap-2">
              <Button
                type="text"
                size="small"
                onClick={handleGenerateViews}
                loading={isGeneratingViews}
                disabled={!avatar}
                className="text-accent-primary hover:text-accent-primary/80 px-3 h-[24px] py-0 border border-border flex-1 text-xs"
                title={avatar ? '使用当前头像作为参考生成全身照' : '请先生成头像'}
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
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = URL.createObjectURL(file);
                setFullBodyImages([{ imageUrl: url, name: '全身照', isPortrait: false, prompt: imagePrompt }]);
                message.success('全身照已选择（创建时将上传）');
              }}
            />
          </div>

        </div>
      </div>
    );
  };

  // 底部操作栏
  const renderFooter = () => {
    if (wizardStep === 0) {
      return null; // Step 1 自己有按钮
    }

    if (wizardStep === 1) {
      return (
        <div className="flex justify-between gap-3 pt-2">
          <Button onClick={() => setWizardStep(0)}>上一步</Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            直接创建角色
          </Button>
        </div>
      );
    }

    if (wizardStep === 2) {
      return (
        <div className="flex justify-between gap-3 pt-2">
          <Button onClick={() => setWizardStep(1)}>上一步</Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            icon={<UserPlus size={16} />}
            className="!text-white"
          >
            创建角色
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <Modal
        open={open}
        onCancel={handleCancel}
        width={1000}
        centered
        footer={null}
        destroyOnHidden
        maskClosable={false}
        title={
          <div className="flex items-center gap-2 text-text-primary">
            <UserPlus size={20} className="text-accent-primary" />
            <span>创建角色</span>
          </div>
        }
      >
        <div className="py-4 space-y-5">
          <Steps
            current={wizardStep}
            size="small"
            onChange={(step) => {
              // 仅允许回退到已访问的步骤，或进入已解锁的步骤
              if (step <= wizardStep) {
                if (step === 0) setAttrStep(0);
                setWizardStep(step);
              } else if (step === 1 && allSelected) {
                setWizardStep(1);
              } else if (step === 2 && avatar) {
                setWizardStep(2);
              }
            }}
            items={stepItems}
          />

          <div>
            {wizardStep === 0 && renderStep1()}
            {wizardStep === 1 && renderStep2()}
            {wizardStep === 2 && renderStep3()}
          </div>

          {renderFooter()}
        </div>
      </Modal>

      {/* 添加形象照 dialog（与 MultiViewModal 保持一致） */}
      <Modal
        open={portraitDialogOpen}
        onCancel={handleClosePortraitDialog}
        onOk={handleConfirmPortrait}
        title="添加形象照"
        okText="确认添加"
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
              {isGeneratingPortrait ? (
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
              loading={isGeneratingPortrait}
              onClick={handleGeneratePortraitInDialog}
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
                  options={textModels.map((m) => ({
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
                <ModelPriceTag model={imageModels.find((m) => m.id === portraitModel)} />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ImagePreviewModal
        isOpen={previewOpen}
        images={previewImages}
        currentIndex={previewCurrentIndex}
        onClose={() => setPreviewOpen(false)}
        onPrev={() => setPreviewCurrentIndex((prev) => (prev === 0 ? previewImages.length - 1 : prev - 1))}
        onNext={() => setPreviewCurrentIndex((prev) => (prev === previewImages.length - 1 ? 0 : prev + 1))}
        title={previewTitle}
      />
    </>
  );
};
