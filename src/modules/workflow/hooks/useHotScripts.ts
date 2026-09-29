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
import { getHotScriptsApi } from '../api/scriptApi';
import { message } from '@/shared/utils/message';

export interface HotScriptItem {
  title: string;
  content: string;
  clicks: number;
}

export function useHotScripts(subStyle?: string) {
  const [hotScripts, setHotScripts] = useState<HotScriptItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchHotScripts = async () => {
      setLoading(true);
      try {
        const res = await getHotScriptsApi(subStyle);
        if (res.success && res.data) {
          setHotScripts(res.data.items || []);
        }
      } catch (e) {
        console.error('获取热门剧本失败:', e);
        message.error('获取热门剧本失败');
      } finally {
        setLoading(false);
      }
    };

    fetchHotScripts();
  }, [subStyle]);

  return { hotScripts, loading };
}
