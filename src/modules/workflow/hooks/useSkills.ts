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
import { getSkillsApi } from '../api/scriptApi';
import { message } from '@/shared/utils/message';

export interface SkillItem {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchSkills = async () => {
      setLoading(true);
      try {
        const res = await getSkillsApi();
        if (res.success && res.data) {
          setSkills(res.data.items || []);
        }
      } catch (e) {
        console.error('获取AI技能失败:', e);
        message.error('获取AI技能失败');
      } finally {
        setLoading(false);
      }
    };

    fetchSkills();
  }, []);

  return { skills, loading };
}