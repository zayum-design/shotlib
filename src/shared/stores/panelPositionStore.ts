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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelPosition = 'left' | 'right';

interface PanelPositionState {
  position: PanelPosition;
  setPosition: (position: PanelPosition) => void;
}

export const usePanelPositionStore = create<PanelPositionState>()(
  persist(
    (set) => ({
      position: 'left',
      setPosition: (position) => set({ position }),
    }),
    {
      name: 'shotlib_panel_position',
      partialize: (state) => ({ position: state.position }),
    },
  ),
);
