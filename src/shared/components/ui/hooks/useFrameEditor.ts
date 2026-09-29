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
import { message } from '../../../utils/message';
import { stripVideoPromptSuffix } from '@/modules/workflow/stores/workflowStore.episode.utils';

interface UseFrameEditorOptions {
  episodeId: string;
  firstFramePrompt: string | undefined;
  lastFramePrompt: string | undefined;
  firstLastFrameVideoPrompt: string | undefined;
  updateEpisode: (id: string, data: Partial<unknown>) => void;
}

export function useFrameEditor({
  episodeId,
  firstFramePrompt,
  lastFramePrompt,
  firstLastFrameVideoPrompt,
  updateEpisode,
}: UseFrameEditorOptions) {
  const [isEditingFirstFrame, setIsEditingFirstFrame] = useState(false);
  const [isEditingLastFrame, setIsEditingLastFrame] = useState(false);
  const [firstFramePromptValue, setFirstFramePromptValue] = useState('');
  const [lastFramePromptValue, setLastFramePromptValue] = useState('');

  const [isEditingFirstLastFramePrompt, setIsEditingFirstLastFramePrompt] = useState(false);
  const [firstLastFrameVideoPromptValue, setFirstLastFrameVideoPromptValue] = useState('');

  // 首帧
  const openFirstFrameModal = useCallback(() => {
    setFirstFramePromptValue(firstFramePrompt || '');
    setIsEditingFirstFrame(true);
  }, [firstFramePrompt]);

  const handleFirstFrameConfirm = useCallback(() => {
    updateEpisode(episodeId, { firstFramePrompt: firstFramePromptValue, firstFrameDialogue: '' });
    setIsEditingFirstFrame(false);
    message.success('首帧提示词已保存');
  }, [episodeId, firstFramePromptValue, updateEpisode]);

  const handleFirstFrameCancel = useCallback(() => {
    setIsEditingFirstFrame(false);
    setFirstFramePromptValue('');
  }, []);

  // 尾帧
  const openLastFrameModal = useCallback(() => {
    setLastFramePromptValue(lastFramePrompt || '');
    setIsEditingLastFrame(true);
  }, [lastFramePrompt]);

  const handleLastFrameConfirm = useCallback(() => {
    updateEpisode(episodeId, { lastFramePrompt: lastFramePromptValue, lastFrameDialogue: '' });
    setIsEditingLastFrame(false);
    message.success('尾帧提示词已保存');
  }, [episodeId, lastFramePromptValue, updateEpisode]);

  const handleLastFrameCancel = useCallback(() => {
    setIsEditingLastFrame(false);
    setLastFramePromptValue('');
  }, []);

  // 首尾帧视频提示词（编辑框剥离统一约束后缀，提交时由系统重新追加）
  const openFirstLastFramePromptModal = useCallback(() => {
    setFirstLastFrameVideoPromptValue(stripVideoPromptSuffix(firstLastFrameVideoPrompt || ''));
    setIsEditingFirstLastFramePrompt(true);
  }, [firstLastFrameVideoPrompt]);

  const handleFirstLastFramePromptConfirm = useCallback(() => {
    updateEpisode(episodeId, { firstLastFrameVideoPrompt: firstLastFrameVideoPromptValue });
    setIsEditingFirstLastFramePrompt(false);
    message.success('视频提示词已保存');
  }, [episodeId, firstLastFrameVideoPromptValue, updateEpisode]);

  const handleFirstLastFramePromptCancel = useCallback(() => {
    setIsEditingFirstLastFramePrompt(false);
    setFirstLastFrameVideoPromptValue('');
  }, []);

  return {
    isEditingFirstFrame,
    isEditingLastFrame,
    firstFramePromptValue,
    setFirstFramePromptValue,
    lastFramePromptValue,
    setLastFramePromptValue,
    isEditingFirstLastFramePrompt,
    firstLastFrameVideoPromptValue,
    setFirstLastFrameVideoPromptValue,
    openFirstFrameModal,
    handleFirstFrameConfirm,
    handleFirstFrameCancel,
    openLastFrameModal,
    handleLastFrameConfirm,
    handleLastFrameCancel,
    openFirstLastFramePromptModal,
    handleFirstLastFramePromptConfirm,
    handleFirstLastFramePromptCancel,
  };
}
