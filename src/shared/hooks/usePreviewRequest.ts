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

import { useState, useRef, useCallback } from 'react';

export interface PreviewRequestData {
  endpoint: string;
  body: any;
  apiDocUrl?: string;
}

export interface UsePreviewRequestOptions {
  enabled: boolean;
  fetchPreview?: (endpoint: string, body: any) => Promise<any>;
}

export function usePreviewRequest(options: UsePreviewRequestOptions) {
  const { enabled, fetchPreview } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const pendingActionRef = useRef<(() => Promise<any> | any) | null>(null);
  const pendingResolveRef = useRef<((value: any) => void) | null>(null);
  const pendingRejectRef = useRef<((reason?: any) => void) | null>(null);

  const previewRequest = useCallback(
    async (requestData: PreviewRequestData | PreviewRequestData[], action: () => Promise<any> | any) => {
      if (!enabled) {
        return action();
      }

      let previewData: any = requestData;

      if (fetchPreview) {
        if (Array.isArray(requestData)) {
          // 批量请求：并行获取所有 preview
          const results = await Promise.all(
            requestData.map(async (req) => {
              if (!req.endpoint) return req;
              try {
                const response = await fetchPreview(req.endpoint, req.body);
                if (response?.success && response.data?.preview) {
                  return response.data.preview;
                }
              } catch {
                // fallback
              }
              return req;
            })
          );
          previewData = results;
        } else if (requestData.endpoint) {
          try {
            const response = await fetchPreview(requestData.endpoint, requestData.body);
            if (response?.success && response.data?.preview) {
              previewData = response.data.preview;
            }
          } catch {
            // fallback to original data
          }
        }
      }

      setData(previewData);
      pendingActionRef.current = action;
      setIsOpen(true);

      return new Promise<any>((resolve, reject) => {
        pendingResolveRef.current = resolve;
        pendingRejectRef.current = reject;
      });
    },
    [enabled, fetchPreview]
  );

  const handleSend = useCallback(async () => {
    setIsOpen(false);
    if (pendingActionRef.current) {
      try {
        const result = await pendingActionRef.current();
        pendingResolveRef.current?.(result);
      } catch (e) {
        pendingRejectRef.current?.(e);
      } finally {
        pendingActionRef.current = null;
        pendingResolveRef.current = null;
        pendingRejectRef.current = null;
      }
    }
    setData(null);
  }, []);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    pendingRejectRef.current?.(new Error('用户取消预览'));
    pendingActionRef.current = null;
    pendingResolveRef.current = null;
    pendingRejectRef.current = null;
    setData(null);
  }, []);

  return {
    isOpen,
    data,
    previewRequest,
    handleSend,
    handleCancel,
  };
}
