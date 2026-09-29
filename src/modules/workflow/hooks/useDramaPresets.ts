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

/**
 * 短剧头像预设 Hook(纯前端版)
 *
 * 原版 fetch 后端 /api/creator/character/presets/avatar;
 * 开源版数据源为内置 src/config/presets/drama-avatar-options.json,Hook 签名不变。
 */
import { useState, useEffect } from 'react';
import avatarOptionsJson from '@/config/presets/drama-avatar-options.json';

export interface PresetOptions {
  steps: any[];
  randomPools: Record<string, string[]>;
}

export interface GetDramaPresetsResponse {
  success: boolean;
  data: PresetOptions;
  message?: string;
}

export async function getDramaPresetsApi(): Promise<GetDramaPresetsResponse> {
  return {
    success: true,
    data: avatarOptionsJson as unknown as PresetOptions,
  };
}

export function useDramaPresets() {
  const [avatarOptions, setAvatarOptions] = useState<PresetOptions>({ steps: [], randomPools: {} });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadPresets = async () => {
      setIsLoading(true);
      try {
        const res = await getDramaPresetsApi();
        if (res.success && res.data) {
          setAvatarOptions(res.data);
        }
      } catch (e) {
        console.error('加载短剧预设数据失败:', e);
      } finally {
        setIsLoading(false);
      }
    };
    loadPresets();
  }, []);

  return {
    avatarOptions,
    isLoadingPresets: isLoading,
  };
}
