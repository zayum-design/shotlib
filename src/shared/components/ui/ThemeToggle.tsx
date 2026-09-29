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

import { useRef } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useThemeStore();
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    // View Transition API：以按钮为圆心展开过渡
    if (!document.startViewTransition) {
      toggleTheme();
      return;
    }

    const btn = btnRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      // 取屏幕对角线一半作为最大展开半径
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      document.documentElement.style.setProperty('--vt-x', `${x}px`);
      document.documentElement.style.setProperty('--vt-y', `${y}px`);
      document.documentElement.style.setProperty('--vt-r', `${radius}px`);
    }

    document.startViewTransition(() => {
      toggleTheme();
    });
  };

  return (
    <button
      ref={btnRef}
      onClick={handleClick}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-bg-tertiary/50 border border-border hover:bg-bg-tertiary transition-colors"
      title={theme === 'dark' ? '切换到亮色模式' : '切换到暗黑模式'}
    >
      {theme === 'dark' ? (
        <Sun size={18} className="text-amber-400" />
      ) : (
        <Moon size={18} className="text-indigo-500" />
      )}
    </button>
  );
};
