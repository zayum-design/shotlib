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

import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiPreviewEnabled, syncApiPreviewFromSettings } from '@/shared/stores/apiPreviewStore';

export function useInstantApiPreview() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewData, setPreviewData] = useState<any>(null);
  const previewConfirmRef = useRef<(() => void) | null>(null);

  // 初始化时从 settingsRepo 同步开关状态(默认 false)
  useEffect(() => {
    void syncApiPreviewFromSettings();
  }, []);

  const openPreviewDialog = useCallback((title: string, data: any, onConfirm: () => void) => {
    // 如果全局关闭了提交模型 JSON 预览，直接执行确认动作
    if (!getApiPreviewEnabled()) {
      onConfirm();
      return;
    }
    setPreviewTitle(title);
    // 如果 data 已经有 local 和 remote，直接使用（后端返回的 preview 格式）
    // 否则只展示原始数据，避免两个标签页显示相同内容
    const previewData = data?.local && data?.remote ? data : data;
    setPreviewData(previewData);
    previewConfirmRef.current = onConfirm;
    setPreviewOpen(true);
  }, []);

  // 通用 API preview 辅助函数：调用后端 preview API，获取 local/remote 后显示 dialog
  const showApiPreview = useCallback(
    async (title: string, previewPromise: Promise<any>, fallbackData: any, onConfirm: () => void) => {
      try {
        const res = await previewPromise;
        const preview = res?.data?.preview;
        if (preview?.local && preview?.remote) {
          openPreviewDialog(title, preview, onConfirm);
        } else {
          console.warn('[showApiPreview] 后端未返回 preview 数据，使用 fallback', { title, res, fallbackData });
          openPreviewDialog(title, fallbackData, onConfirm);
        }
      } catch (err) {
        console.warn('[showApiPreview] 获取 preview 失败，使用 fallback', { title, error: err, fallbackData });
        openPreviewDialog(title, fallbackData, onConfirm);
      }
    },
    [openPreviewDialog]
  );

  const handlePreviewConfirm = useCallback(() => {
    setPreviewOpen(false);
    previewConfirmRef.current?.();
    previewConfirmRef.current = null;
  }, []);

  return {
    previewOpen,
    setPreviewOpen,
    previewTitle,
    previewData,
    openPreviewDialog,
    showApiPreview,
    handlePreviewConfirm,
  };
}
