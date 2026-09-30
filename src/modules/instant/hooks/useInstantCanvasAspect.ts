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
 * 画布场景卡显示比例。
 * 产品决策:场景卡显示固定 16:9,不随项目比例变化(与生成比例保持一致)。
 * 保留 aspectRatio 参数以兼容既有调用方签名。
 */
export function useInstantCanvasAspect(_aspectRatio: string | undefined) {
  const canvasAspectClass = 'aspect-[16/9]';
  return { canvasAspectClass };
}
