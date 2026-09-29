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
import { generateAvatarApi } from '@/modules/workflow/api/characterApi';
import type { PresetOptions } from '@/modules/workflow/hooks/useDramaPresets';
import type { InstantCharacter } from '@/shared/types/project';
import { message } from '@/shared/utils/message';

interface UseAvatarModalOptions {
  previewRequest: (data: any, action: () => Promise<void> | void) => void;
  avatarOptions: PresetOptions;
  selectedImageModel: string;
}

export function useAvatarModal({ previewRequest, avatarOptions, selectedImageModel }: UseAvatarModalOptions) {
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [avatarCurrentStep, setAvatarCurrentStep] = useState(0);
  const [avatarSelections, setAvatarSelections] = useState<string[]>(['', '', '', '']);
  const [avatarModel, setAvatarModel] = useState(selectedImageModel);
  const [targetCharacter, setTargetCharacter] = useState<InstantCharacter | null>(null);

  const avatarTotalSteps = avatarOptions.steps.length + 1;
  const isAvatarLastStep = avatarCurrentStep === avatarTotalSteps - 1;

  const getAvatarStepOptions = useCallback(
    (stepIndex: number, selections: string[]): string[] => {
      const step = avatarOptions.steps[stepIndex] as any;
      if (step?.optionsByGender) {
        const gender = selections[1];
        return step.optionsByGender[gender] || step.optionsByGender['男'] || [];
      }
      return step?.options || [];
    },
    [avatarOptions.steps]
  );

  const handleAvatarSelect = useCallback(
    (value: string) => {
      const newSelections = [...avatarSelections];
      newSelections[avatarCurrentStep] = value;
      if (avatarCurrentStep === 1) {
        newSelections[2] = '';
        newSelections[3] = '';
      }
      setAvatarSelections(newSelections);
      if (avatarCurrentStep < avatarOptions.steps.length) {
        setAvatarCurrentStep(avatarCurrentStep + 1);
      }
    },
    [avatarCurrentStep, avatarSelections, avatarOptions.steps.length]
  );

  const buildAvatarPrompt = useCallback(() => {
    const [era, gender, style, appearance] = avatarSelections;
    const parts: string[] = [];
    if (era) parts.push(`${era}风格`);
    if (gender) parts.push(`${gender}性`);
    if (style) parts.push(`${style}风格`);
    if (appearance) parts.push(appearance);
    const basePrompt = parts.length > 0 ? `一位${parts.join('、')}的短剧角色` : '一位短剧角色';
    const extra = avatarPrompt.trim();
    return extra ? `${basePrompt}，${extra}` : basePrompt;
  }, [avatarSelections, avatarPrompt]);

  const handleRandomAvatarPrompt = useCallback(() => {
    const gender = avatarSelections[1] || '男';
    const pool = (avatarOptions.randomPools as any)[gender] || (avatarOptions.randomPools as any)['男'];
    setAvatarPrompt(pool[Math.floor(Math.random() * pool.length)]);
  }, [avatarSelections, avatarOptions.randomPools]);

  const openAvatarModalForCharacter = useCallback((char: InstantCharacter) => {
    setTargetCharacter(char);
    setAvatarModalOpen(true);
    setAvatarCurrentStep(0);
    setAvatarSelections(['', '', '', '']);
    setAvatarPrompt('');
    setAvatarModel(char.model || selectedImageModel);
  }, [selectedImageModel]);

  const handleGenerateAvatar = useCallback(async () => {
    const finalPrompt = buildAvatarPrompt();
    if (!finalPrompt.trim()) {
      message.warning('请完成选择或输入头像描述');
      return;
    }
    if (!targetCharacter) {
      message.warning('未选择目标角色');
      return;
    }

    const doGenerate = async () => {
      setIsGeneratingAvatar(true);
      try {
        const response = await generateAvatarApi(
          targetCharacter.id,
          finalPrompt,
          avatarModel,
        );
        if (response.success && response.data?.avatarUrls && response.data.avatarUrls.length > 0) {
          message.success('头像生成成功');
          setAvatarModalOpen(false);
          setAvatarPrompt('');
          setAvatarCurrentStep(0);
          setAvatarSelections(['', '', '', '']);
        } else {
          message.error(response.message || '头像生成失败');
        }
      } catch (e) {
        console.error('生成头像失败:', e);
        message.error('头像生成失败，请重试');
      } finally {
        setIsGeneratingAvatar(false);
      }
    };

    previewRequest(
      {
        endpoint: `/api/creator/character/${targetCharacter.id}/avatar`,
        body: {
          avatarPrompt: finalPrompt,
          model: avatarModel,
        },
      },
      doGenerate
    );
  }, [buildAvatarPrompt, targetCharacter, avatarModel, previewRequest]);

  const resetAvatarModal = useCallback(() => {
    setAvatarModalOpen(false);
    setAvatarPrompt('');
    setAvatarCurrentStep(0);
    setAvatarSelections(['', '', '', '']);
    setTargetCharacter(null);
  }, []);

  return {
    avatarModalOpen,
    setAvatarModalOpen,
    isGeneratingAvatar,
    avatarCurrentStep,
    setAvatarCurrentStep,
    avatarSelections,
    setAvatarSelections,
    avatarPrompt,
    setAvatarPrompt,
    isAvatarLastStep,
    avatarTotalSteps,
    avatarModel,
    setAvatarModel,
    targetCharacter,
    getAvatarStepOptions,
    handleAvatarSelect,
    buildAvatarPrompt,
    handleRandomAvatarPrompt,
    handleGenerateAvatar,
    openAvatarModalForCharacter,
    resetAvatarModal,
  };
}
