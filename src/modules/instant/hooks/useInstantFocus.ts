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

import { useCallback } from 'react';

/**
 * 聚焦到指定场景项（在侧边栏/内容区布局中切换当前活动场景）。
 */
export function useInstantFocus(applySelectedScene: (id: string | null) => void) {
  const focusOnItem = useCallback(
    (itemId: string) => {
      applySelectedScene(itemId);
    },
    [applySelectedScene]
  );

  return { focusOnItem };
}
