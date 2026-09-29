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
import type { InstantCharacter } from '@/shared/types/project';
import { useDramaPresets } from '@/modules/workflow/hooks/useDramaPresets';
import { message } from '@/shared/utils/message';

export function useInstantAvatarModal({
  executeGenerateAvatar,
}: {
  executeGenerateAvatar: (char: InstantCharacter, requestData: { prompt: string; model: string }) => Promise<void>;
}) {
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [avatarCurrentStep, setAvatarCurrentStep] = useState(0);
  const [avatarSelections, setAvatarSelections] = useState<string[]>(['', '', '', '']);
  const [avatarModel, setAvatarModel] = useState('');
  const [avatarTargetChar, setAvatarTargetChar] = useState<InstantCharacter | null>(null);
  const { avatarOptions } = useDramaPresets();

  const avatarTotalSteps = avatarOptions.steps.length + 1;
  const isAvatarLastStep = avatarCurrentStep === avatarTotalSteps - 1;

  const getAvatarStepOptions = useCallback(
    (stepIndex: number, selections: string[]): string[] => {
      const step = (avatarOptions.steps as any[])[stepIndex];
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
      if (avatarCurrentStep < (avatarOptions.steps as any[]).length) {
        setAvatarCurrentStep(avatarCurrentStep + 1);
      }
    },
    [avatarCurrentStep, avatarSelections, avatarOptions.steps]
  );

  const buildModalAvatarPrompt = useCallback(() => {
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

  const handleGenerateAvatarFromModal = useCallback(async () => {
    const finalPrompt = buildModalAvatarPrompt();
    if (!finalPrompt.trim()) {
      message.warning('请完成选择或输入头像描述');
      return;
    }
    if (!avatarTargetChar) {
      message.warning('未选择目标角色');
      return;
    }
    setIsGeneratingAvatar(true);
    try {
      const requestData = { prompt: finalPrompt, model: avatarModel };
      await executeGenerateAvatar(avatarTargetChar, requestData);
      setAvatarModalOpen(false);
      setAvatarPrompt('');
      setAvatarCurrentStep(0);
      setAvatarSelections(['', '', '', '']);
      setAvatarTargetChar(null);
    } finally {
      setIsGeneratingAvatar(false);
    }
  }, [buildModalAvatarPrompt, avatarTargetChar, avatarModel, executeGenerateAvatar]);

  const resetAvatarModal = useCallback(() => {
    setAvatarModalOpen(false);
    setAvatarPrompt('');
    setAvatarCurrentStep(0);
    setAvatarSelections(['', '', '', '']);
    setAvatarTargetChar(null);
  }, []);

  return {
    avatarModalOpen,
    setAvatarModalOpen,
    isGeneratingAvatar,
    setIsGeneratingAvatar,
    avatarPrompt,
    setAvatarPrompt,
    avatarCurrentStep,
    setAvatarCurrentStep,
    avatarSelections,
    setAvatarSelections,
    avatarModel,
    setAvatarModel,
    avatarTargetChar,
    setAvatarTargetChar,
    avatarTotalSteps,
    isAvatarLastStep,
    avatarOptions,
    getAvatarStepOptions,
    handleAvatarSelect,
    buildModalAvatarPrompt,
    handleRandomAvatarPrompt,
    handleGenerateAvatarFromModal,
    resetAvatarModal,
  };
}
