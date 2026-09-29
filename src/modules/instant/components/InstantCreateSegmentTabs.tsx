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

interface InstantCreateSegmentTabsProps {
  segments: { id: string; name: string }[];
  activeSegmentId: string | null;
  setActiveSegmentId: (id: string | null) => void;
}

export const InstantCreateSegmentTabs: React.FC<InstantCreateSegmentTabsProps> = ({
  segments,
  activeSegmentId,
  setActiveSegmentId,
}) => {
  if (segments.length <= 1) return null;

  return (
    <div className="bg-bg-secondary border-b border-border px-6 py-2 flex items-center gap-2 overflow-x-auto no-drag flex-shrink-0">
      {segments.map((seg) => {
        const isActive = seg.id === activeSegmentId;
        return (
          <button
            key={seg.id}
            onClick={() => {
              setActiveSegmentId(seg.id);
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('segment', seg.id);
                window.history.replaceState(window.history.state, '', url.toString());
              } catch {
                // ignore
              }
            }}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all
              ${isActive ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}
            `}
          >
            {seg.name}
          </button>
        );
      })}
    </div>
  );
};
