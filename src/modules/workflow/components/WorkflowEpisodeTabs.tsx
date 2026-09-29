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

import React from 'react';
import { Clapperboard, Plus, X } from 'lucide-react';

interface WorkflowEpisodeTabsProps {
  episodeList: number[];
  currentEpisode: number;
  isSwitchingEpisode: boolean;
  episodesCount: number;
  onSwitchEpisode: (ep: number) => void;
  onDeleteEpisode: (ep: number) => void;
  onCreateNewEpisode: () => void;
}

/**
 * WorkflowPage 分集 Tab 栏组件：分集切换 + 删除 + 新建
 */
export const WorkflowEpisodeTabs: React.FC<WorkflowEpisodeTabsProps> = ({
  episodeList,
  currentEpisode,
  isSwitchingEpisode,
  episodesCount,
  onSwitchEpisode,
  onDeleteEpisode,
  onCreateNewEpisode,
}) => {
  return (
    <div className="border-b border-border bg-bg-secondary/50">
      <div className="w-full px-6 max-md:px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 max-md:overflow-x-auto max-md:flex-1 max-md:whitespace-nowrap [&::-webkit-scrollbar]:hidden">
            {episodeList.map((ep) => (
              <div
                key={ep}
                className={`
                  flex items-center gap-1 text-sm font-medium
                  border-b-2 transition-all relative
                  ${currentEpisode === ep
                    ? 'text-accent-primary border-accent-primary'
                    : 'text-text-muted border-transparent hover:text-text-primary hover:border-border'
                  }
                `}
              >
                <button
                  onClick={() => onSwitchEpisode(ep)}
                  disabled={isSwitchingEpisode}
                  className={`
                    flex items-center gap-2 px-5 py-3 max-md:px-3 max-md:py-2
                    ${isSwitchingEpisode ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <Clapperboard size={16} />
                  第{ep}集
                </button>
                {ep !== 1 && ep === Math.max(...episodeList) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEpisode(ep);
                    }}
                    className="mr-2 p-0.5 rounded hover:bg-red-500/20 hover:text-red-500 text-text-muted transition-colors"
                    title="删除分集"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={onCreateNewEpisode}
            disabled={isSwitchingEpisode || episodesCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white border border-accent-primary/30 hover:bg-accent-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium max-md:flex-shrink-0 max-md:px-2 max-md:py-1.5"
          >
            <Plus size={16} />
            <span className="max-md:hidden">新建分集</span>
          </button>
        </div>
      </div>
    </div>
  );
};
