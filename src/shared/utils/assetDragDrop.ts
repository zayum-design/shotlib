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
 * assetDragDrop.ts — 项目资产库拖拽替换工具
 *
 * 流程：WorkflowProjectAssetDrawer 的图片项 draggable 拖出（携带 assetId/url/assetType），
 * 各落点（角色头像/多视图/形象照/场景图）通过 assetDropTarget 接收，
 * assetType 不匹配时提示「类型不匹配」。
 */
import { message } from '@/shared/utils/message';

/** 拖拽载荷：image_asset 行的引用信息 */
export interface DraggedProjectAsset {
  assetId: string;
  url: string;
  assetType: string; // image_asset 的 asset_type：character_image / scene_image / frame_image 等
}

const MIME = 'application/x-project-asset';

/**
 * 同窗口拖拽载荷的模块级缓存。
 * 部分浏览器（Safari）在 dragover 阶段不暴露自定义 dataTransfer types，
 * 仅靠 MIME 判断会导致落点无法 preventDefault、drop 不触发（表现为"拖动没效果"）。
 * 同窗口拖拽时以该缓存为准，dataTransfer 仅作跨窗口/兜底。
 */
let currentDragAsset: DraggedProjectAsset | null = null;

/** asset_type → 中文标签（用于类型不匹配提示） */
const ASSET_TYPE_LABELS: Record<string, string> = {
  character_image: '角色图片',
  scene_image: '场景图片',
  frame_image: '帧图片',
  character_voice: '音色',
};

export function assetTypeLabel(assetType: string): string {
  return ASSET_TYPE_LABELS[assetType] || assetType || '未知类型';
}

/** 拖出方：dragstart 时调用 */
export function startAssetDrag(e: React.DragEvent, asset: DraggedProjectAsset) {
  currentDragAsset = asset;
  e.dataTransfer.setData(MIME, JSON.stringify(asset));
  e.dataTransfer.effectAllowed = 'copy';
}

/** 拖出方：dragend 时调用（清理缓存，避免残留状态影响后续拖拽判断） */
export function endAssetDrag() {
  currentDragAsset = null;
}

/** 读取本次拖拽载荷（优先模块缓存，兜底 dataTransfer） */
function readDraggedAsset(e: React.DragEvent): DraggedProjectAsset | null {
  if (currentDragAsset) return currentDragAsset;
  try {
    const raw = e.dataTransfer.getData(MIME);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

/**
 * 落点方：生成 onDragOver/onDrop 处理器。
 * - dragover 仅识别本项目资产拖拽并允许放置（类型校验在 drop 时统一处理，保证不匹配也有提示）
 * - drop 时 assetType 不在 accept 列表 → 提示「类型不匹配」，否则回调 onDropAsset
 */
export function assetDropTarget(
  accept: string[],
  targetLabel: string,
  onDropAsset: (asset: DraggedProjectAsset) => void,
): Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDrop'> {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (currentDragAsset || e.dataTransfer.types.includes(MIME)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    onDrop: (e: React.DragEvent) => {
      const asset = readDraggedAsset(e);
      currentDragAsset = null;
      if (!asset) return;
      e.preventDefault();
      e.stopPropagation();
      if (!asset.assetId || !asset.url) return;
      if (!accept.includes(asset.assetType)) {
        const acceptLabels = accept.map(assetTypeLabel).join('/');
        message.warning(`类型不匹配：${targetLabel}仅支持${acceptLabels}，拖入的是${assetTypeLabel(asset.assetType)}`);
        return;
      }
      onDropAsset(asset);
    },
  };
}
