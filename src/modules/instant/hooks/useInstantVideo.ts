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
import { useApiPreviewStore } from '@/shared/stores/apiPreviewStore';

export interface UseInstantVideoReturn {
  apiPreviewMode: boolean;
  setApiPreviewMode: (v: boolean) => void;
  videoPreviewOpen: boolean;
  setVideoPreviewOpen: (v: boolean) => void;
  videoPreviewData: any;
  setVideoPreviewData: (v: any) => void;
  videoPreviewItemId: string | null;
  setVideoPreviewItemId: (v: string | null) => void;
}

export const useInstantVideo = (): UseInstantVideoReturn => {
  const { apiPreviewEnabled, setApiPreviewEnabled } = useApiPreviewStore();

  const setApiPreviewMode = useCallback((v: boolean) => {
    setApiPreviewEnabled(v);
  }, [setApiPreviewEnabled]);

  const [videoPreviewOpen, setVideoPreviewOpen] = useState(false);
  const [videoPreviewData, setVideoPreviewData] = useState<any>(null);
  const [videoPreviewItemId, setVideoPreviewItemId] = useState<string | null>(null);

  return {
    apiPreviewMode: apiPreviewEnabled,
    setApiPreviewMode,
    videoPreviewOpen,
    setVideoPreviewOpen,
    videoPreviewData,
    setVideoPreviewData,
    videoPreviewItemId,
    setVideoPreviewItemId,
  };
};
