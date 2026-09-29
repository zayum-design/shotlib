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

import { useState, useEffect } from 'react';
import { getAgentTypesApi } from '../api/scriptApi';
import { message } from '@/shared/utils/message';

export interface HotScriptItem {
  title: string;
  content: string;
  clicks: number;
}

export interface SubStyleItem {
  id: string;
  name: string;
  description: string;
  promptHint: string;
  hotScripts?: HotScriptItem[];
}

export interface ArtStyleItem {
  id: string;
  name: string;
  promptHint: string;
}

export interface AgentTypeItem {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptHint: string;
  subStyles?: SubStyleItem[];
  artStyles?: ArtStyleItem[];
}

export function useAgentTypes() {
  const [agentTypes, setAgentTypes] = useState<AgentTypeItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAgentTypes = async () => {
      setLoading(true);
      try {
        const res = await getAgentTypesApi();
        if (res.success && res.data) {
          // 内置预设的 subStyles 未填 description 等字段,按 hook 类型兜底
          setAgentTypes((res.data.items || []) as AgentTypeItem[]);
        }
      } catch (e) {
        console.error('获取电影风格失败:', e);
        message.error('获取电影风格失败');
      } finally {
        setLoading(false);
      }
    };

    fetchAgentTypes();
  }, []);

  return { agentTypes, loading };
}