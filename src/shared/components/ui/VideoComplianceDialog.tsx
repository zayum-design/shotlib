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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Modal, Button, Spin } from 'antd';
import { CheckCircle2, AlertTriangle, Shield, Image as ImageIcon } from 'lucide-react';
import {
  getOrCreateAigcGroup,
  createAigcAsset,
} from '@/shared/api/userMaterialApi';
import { ImagePreviewModal } from './ImagePreviewModal';
import type { CharacterImage } from '@/shared/types/index';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import { message } from '../../utils/message';
/** 合规检查通用角色接口（同时支持 workflow Character 和即时创作 InstantCharacter） */
export interface ComplianceCharacter {
  id: string;
  name: string;
  avatarSource?: string;
  avatarImages?: CharacterImage[];
  multiViewImages?: CharacterImage[];
  fullBodyImages?: CharacterImage[];
  portraitImages?: CharacterImage[];
}

/** 合规检查场景接口 */
export interface ComplianceScene {
  id: string;
  name: string;
  imageUrls?: string[];
  imageAssetIds?: string[];
}

/** 合规检查结果详情（用于父组件写入 image_asset.data.seedance） */
export interface ComplianceDetail {
  imageUrl: string;
  assetId?: string; // 火山引擎 AIGC assetId（asset-xxx）
  assetKey?: string; // image_asset 行的 UUID（workflow 模式用于定位 image_asset 行）
  groupId?: string; // AIGC 素材组 ID
  url?: string; // 入库后可访问 URL（createAigcAsset 返回的 sourceUrl）
  characterId?: string;
  sceneId?: string;
  imageType?: 'avatar' | 'fullBody' | 'portrait' | 'scene' | 'frame' | 'ref';
}

interface VideoComplianceDialogProps {
  open: boolean;
  onClose: () => void;
  /** 确认按钮回调；complianceDetails 携带每张图的合规详情（含 groupId/url/assetKey） */
  onConfirm: (assetIdMap: Map<string, string>, complianceDetails?: ComplianceDetail[]) => Promise<void>;
  /** 本次合规检查全部完成后回调（批量更新项目内状态） */
  onCheckComplete?: (successImages: ComplianceDetail[]) => Promise<void>;
  /** 需要检查的图片对应的角色列表（characters/scenes 模式） */
  characters?: ComplianceCharacter[];
  /** 需要检查的场景列表 */
  scenes?: ComplianceScene[];
  /** 通用图片列表（generate 模式：传入时直接作为待检查图片，assetId 作为 assetKey 定位 asset 行） */
  imageList?: { imageUrl: string; imageName: string; assetId?: string }[];
  /** 首尾帧模式：直接审核指定的首尾帧图（assetKey 为 image_asset UUID）。
   *  传非空数组时对话框只审核这些图，跳过 characters/scenes 收集 */
  frameImages?: { imageUrl: string; assetKey: string; imageName: string }[];
  /** 分镜参考附件图（!<ref type="image">）：与角色/场景图一起审核；
   *  assetKey 为 image_asset 行 UUID（历史附件可能缺失，此时合规结果仅当次生效） */
  shotRefImages?: { imageUrl: string; imageName: string; assetKey?: string }[];
  /** 片段ID，用于日志 */
  episodeId: string;
  /** 当前生成的片段提示词（用于过滤只用到的角色/场景图片） */
  shotPrompts?: string[];
}

interface ImageItem {
  id: string;
  characterId?: string;
  characterName?: string;
  sceneId?: string;
  sceneName?: string;
  imageUrl: string;
  imageType: 'avatar' | 'fullBody' | 'portrait' | 'scene' | 'frame' | 'ref';
  imageName: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  assetId?: string; // 火山 AIGC assetId
  assetKey?: string; // image_asset 行 UUID（workflow 模式）
  groupId?: string; // AIGC 素材组 ID
  sourceUrl?: string; // 入库后可访问 URL
  error?: string;
}

export const VideoComplianceDialog: React.FC<VideoComplianceDialogProps> = ({
  open,
  onClose,
  onConfirm,
  onCheckComplete,
  characters = [],
  scenes = [],
  imageList = [],
  shotPrompts = [],
  frameImages = [],
  shotRefImages = [],
}) => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [hasGroup, setHasGroup] = useState(false);
  const [groupId, setGroupId] = useState<string>('');
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState<string>('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState<string[]>([]);

  // 缓存已获取的 groupId，避免重复请求
  const [cachedGroupId, setCachedGroupId] = useState<string | null>(null);

  // 防止重复调用 fetchAigcGroup 的标志
  const fetchInProgressRef = useRef(false);

  // 追踪所有已检查图片的 assetId（不依赖 characters prop 的更新时序）
  const assetIdMapRef = useRef<Map<string, string>>(new Map());

  // 合规检查重入守卫：点击后立即禁用按钮，防止状态提交前重复触发
  const checkingRef = useRef(false);

  // 追踪上一次 open 状态，确保初始化逻辑只在 dialog 打开瞬间执行一次，
  // 避免 collectImages / fetchAigcGroup 函数引用变化导致 useEffect 重复执行，
  // 从而把点击后的 checking loading 和图片 uploading 状态意外重置。
  const prevOpenRef = useRef(false);

  // 获取或创建 AIGC 素材组（优先使用缓存，防止重复请求）
  const fetchAigcGroup = useCallback(async () => {
    // 正在请求中，直接返回
    if (fetchInProgressRef.current) {
      return;
    }

    // 如果已有缓存的 groupId，直接使用
    if (cachedGroupId) {
      setHasGroup(true);
      setGroupId(cachedGroupId);
      setGroupError('');
      return;
    }

    fetchInProgressRef.current = true;
    setGroupLoading(true);
    setGroupError('');
    try {
      const res = await getOrCreateAigcGroup();
      if (res.success && res.data?.groupId) {
        setCachedGroupId(res.data.groupId);
        setHasGroup(true);
        setGroupId(res.data.groupId);
        setGroupError('');
      } else {
        setHasGroup(false);
        setGroupId('');
        setGroupError(res.message || '获取素材组失败');
      }
    } catch (err: any) {
      setHasGroup(false);
      setGroupId('');
      setGroupError(err?.message || '获取素材组失败，请检查网络或登录状态');
    } finally {
      fetchInProgressRef.current = false;
      setGroupLoading(false);
    }
  }, [cachedGroupId]);

  // 打开图片预览
  const openPreview = useCallback((index: number) => {
    setPreviewImages(images.map(i => i.imageUrl));
    setPreviewIndex(index);
    setPreviewOpen(true);
  }, [images]);

  // 收集需要合规检查的图片（仅虚拟人物，且只在当前提示词中用到的）
  const collectImages = useCallback((): ImageItem[] => {
    const items: ImageItem[] = [];
    let id = 0;

    // 通用图片模式（generate）：直接作为待检查图片；assetId 作为 assetKey（asset 行 UUID），
    // 合规完成后父组件据此把 seedance 结果写入 asset 行 data（patchImageAssetData）
    if (imageList && imageList.length > 0) {
      for (const img of imageList) {
        if (!img.imageUrl) continue;
        items.push({
          id: `image-${id++}`,
          imageUrl: img.imageUrl,
          imageType: 'frame',
          imageName: img.imageName || '参考图',
          status: 'pending',
          assetKey: img.assetId,
        });
      }
      return items;
    }

    // 首尾帧模式：只审核传入的首尾帧图，跳过 shotPrompts 解析与 characters/scenes 收集
    if (frameImages && frameImages.length > 0) {
      for (const f of frameImages) {
        if (!f.assetKey || !f.imageUrl) continue;
        const imgData = localApi.getCachedImageData(f.assetKey);
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        const volcAssetId = compliance?.assetId;
        const isSuccess = !!volcAssetId || !!compliance?.isCompliant;
        items.push({
          id: `frame-${id++}`,
          imageUrl: f.imageUrl,
          imageType: 'frame',
          imageName: f.imageName,
          status: isSuccess ? 'success' : 'pending',
          assetId: volcAssetId,
          assetKey: f.assetKey,
        });
      }
      return items;
    }

    // 如果提供了 shotPrompts，解析其中用到的角色 ID 和名称、场景 ID 和名称
    let usedCharacterIds = new Set<string>();
    let usedCharacterNames = new Set<string>();
    let usedSceneIds = new Set<string>();
    let usedSceneNames = new Set<string>();
    if (shotPrompts.length > 0) {
      const allPrompts = shotPrompts.join(' ');
      // 提取 character-id 属性
      for (const match of allPrompts.matchAll(/character-id="([^"]+)"/g)) {
        usedCharacterIds.add(match[1]);
      }
      // 提取角色名称（@<role>...</role> 或 @角色名 格式）
      // 支持带属性的 role 标签，如 @<role character-id="xxx">名称</role>
      for (const match of allPrompts.matchAll(/@<role(?:\s+[^>]*)?>([^<]*?)<\/role>/g)) {
        const name = match[1].trim();
        if (name) usedCharacterNames.add(name);
      }
      for (const match of allPrompts.matchAll(/@([一-龥a-zA-Z0-9_]+)(?![^<]*>)/g)) {
        usedCharacterNames.add(match[1]);
      }
      // 提取 scene-id 属性
      for (const match of allPrompts.matchAll(/scene-id="([^"]+)"/g)) {
        usedSceneIds.add(match[1]);
      }
      // 提取场景名称（#<scene>...</scene> 或 #场景名 格式）
      for (const match of allPrompts.matchAll(/[#@]<scene(?:\s+[^>]*)?>([^<]*?)<\/scene>/g)) {
        const name = match[1].trim();
        if (name) usedSceneNames.add(name);
      }
      for (const match of allPrompts.matchAll(/#([一-龥a-zA-Z0-9_]+)(?![^<]*>)/g)) {
        usedSceneNames.add(match[1]);
      }
    }

    for (const char of characters) {
      // 跳过真人资产类型的角色（他们的图片已经在资产库中了，不需要重复入库）
      // 仅当 avatarSource 字段存在时才检查（即时创作角色无此字段）
      if ('avatarSource' in char && char.avatarSource === 'asset') {
        continue;
      }

      // 如果提供了 shotPrompts，检查该角色是否在提示词中用到
      if (shotPrompts.length > 0) {
        const charUsed = usedCharacterIds.has(char.id) || usedCharacterNames.has(char.name);
        if (!charUsed) {
          continue;
        }
      }

      // 统一构建角色图片项。
      // 合规状态从 image_asset.data 缓存读取，所有模式统一：img.assetId 为 image_asset UUID。
      const pushCharImage = (
        img: CharacterImage,
        imageType: 'avatar' | 'fullBody' | 'portrait',
        defaultName: string,
        prefix: string,
      ) => {
        const assetKey = img.assetId || img.id;
        if (!assetKey) return;
        if (!img.imageUrl) return;
        const cachedVolcId = assetIdMapRef.current.get(img.imageUrl);
        // 从缓存读取合规状态
        const imgData = assetKey ? localApi.getCachedImageData(assetKey) : undefined;
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        const volcAssetId = cachedVolcId || compliance?.assetId;
        const isSuccess = !!volcAssetId || !!compliance?.isCompliant;
        items.push({
          id: `${prefix}-${char.id}-${id++}`,
          characterId: char.id,
          characterName: char.name,
          imageUrl: img.imageUrl,
          imageType,
          imageName: img.name || defaultName,
          status: isSuccess ? 'success' : 'pending',
          assetId: volcAssetId,
          assetKey,
        });
      };

      // 头像图片
      if (char.avatarImages && char.avatarImages.length > 0) {
        for (const img of char.avatarImages) {
          pushCharImage(img, 'avatar', '头像', 'avatar');
        }
      }

      // 多视图（workflow 模式）
      if (char.multiViewImages && char.multiViewImages.length > 0) {
        for (const mv of char.multiViewImages) {
          pushCharImage(mv, 'fullBody', '全身照', 'multiview');
        }
      }

      // 形象照（workflow 模式）
      if (char.fullBodyImages && char.fullBodyImages.length > 0) {
        for (const fb of char.fullBodyImages) {
          pushCharImage(fb, fb.isPortrait ? 'portrait' : 'fullBody', fb.isPortrait ? '形象照' : '全身照', 'fullbody');
        }
      }

      // portraitImages（即时创作模式的形象照）
      if ('portraitImages' in char && char.portraitImages && char.portraitImages.length > 0) {
        for (const img of char.portraitImages) {
          pushCharImage(img, 'portrait', '形象照', 'portrait');
        }
      }
    }

    // 场景图： Seedance 等合规模型要求参考图必须是 assetId，场景图同样需要入库
    for (const scene of scenes) {
      if (!scene.imageUrls || scene.imageUrls.length === 0) continue;
      // 如果提供了 shotPrompts，只检查当前提示词中用到的场景
      if (shotPrompts.length > 0) {
        const sceneUsed = usedSceneIds.has(scene.id) || usedSceneNames.has(scene.name);
        if (!sceneUsed) continue;
      }
      for (let i = 0; i < scene.imageUrls.length; i++) {
        const url = scene.imageUrls[i];
        if (!url) continue;
        const assetKey = scene.imageAssetIds?.[i];
        // 从缓存读合规状态（与 frameImages 分支一致）：优先已入库合规 assetId，其次 dialog 本次检查结果
        const imgData = assetKey ? localApi.getCachedImageData(assetKey) : undefined;
        const compliance = imgData ? readAnyCompliance(imgData) : undefined;
        const volcAssetId = compliance?.assetId || assetIdMapRef.current.get(url);
        const isSuccess = !!volcAssetId || !!compliance?.isCompliant;
        items.push({
          id: `scene-${scene.id}-${i}-${id++}`,
          sceneId: scene.id,
          sceneName: scene.name,
          imageUrl: url,
          imageType: 'scene',
          imageName: `${scene.name} 场景图 ${i + 1}`,
          status: isSuccess ? 'success' : 'pending',
          assetId: volcAssetId,
          // image_asset UUID：合规检查通过后 handleCheckComplete 据此把结果写入 image_asset.data（否则被 assetKey 过滤丢弃）
          assetKey,
        });
      }
    }

    // 分镜参考附件图（!<ref type="image">）：本地上传/素材库选择的图片同样须合规入库。
    // assetKey（image_asset 行 UUID）存在时从缓存读合规状态；缺失时依赖 dialog 本次检查结果。
    for (const ref of shotRefImages) {
      if (!ref.imageUrl) continue;
      const imgData = ref.assetKey ? localApi.getCachedImageData(ref.assetKey) : undefined;
      const compliance = imgData ? readAnyCompliance(imgData) : undefined;
      const volcAssetId = compliance?.assetId || assetIdMapRef.current.get(ref.imageUrl);
      const isSuccess = !!volcAssetId || !!compliance?.isCompliant;
      items.push({
        id: `ref-${id++}`,
        imageUrl: ref.imageUrl,
        imageType: 'ref',
        imageName: ref.imageName || '参考附件',
        status: isSuccess ? 'success' : 'pending',
        assetId: volcAssetId,
        assetKey: ref.assetKey,
      });
    }

    return items;
  }, [characters, scenes, shotPrompts, frameImages, imageList, shotRefImages]);

  // 初始化图片列表：仅在 dialog 打开瞬间（open 从 false → true）执行一次。
  // 不依赖 collectImages / fetchAigcGroup 的引用变化，否则合规检查过程中
  // 父组件传入的 characters/shotPrompts 引用变化（或 fetchAigcGroup 因
  // cachedGroupId 变化重建）会触发本 effect 重复执行，重置 checking 与
  // 图片 uploading 状态，导致点击后按钮和图片没有 loading。
  useEffect(() => {
    const isOpening = open && !prevOpenRef.current;
    prevOpenRef.current = open;

    if (!isOpening) return;

    const items = collectImages();
    setImages(items);
    setChecking(false);
    checkingRef.current = false;
    setConfirming(false);

    // 无需检查的图片时跳过 AIGC 素材组获取
    if (items.length > 0) {
      fetchAigcGroup();
    } else {
      setHasGroup(false);
      setGroupId('');
    }
  }, [open, collectImages, fetchAigcGroup]);

  // 重置状态
  const resetState = () => {
    setImages([]);
    setChecking(false);
    checkingRef.current = false;
    setConfirming(false);
    setHasGroup(false);
    setGroupId('');
    setGroupLoading(false);
    setGroupError('');
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // 执行合规检查 - 上传图片到资产库
  const handleComplianceCheck = async () => {
    // 重入守卫：点击后立即置 loading 并禁用，防止状态提交前的重复点击
    if (checkingRef.current) return;
    checkingRef.current = true;
    // 立即进入 loading 态（按钮禁用 + 转圈），覆盖后续校验/上传/patch 全流程
    setChecking(true);

    try {
      if (images.length === 0) {
        message.warning('没有需要检查的图片');
        return;
      }

      if (!hasGroup || !groupId) {
        message.error('素材组获取失败，请重试');
        return;
      }

      // 修复：只对"待检查"和"失败"的图片重新检查，跳过已成功（已合规）的图片
      const pendingIndices = images
        .map((img, idx) => ({ img, idx }))
        .filter(({ img }) => img.status !== 'success')
        .map(({ idx }) => idx);

      if (pendingIndices.length === 0) {
        message.info('所有图片已完成合规检查');
        return;
      }

      const updatedImages = [...images];

      for (const i of pendingIndices) {
        const img = updatedImages[i];

        // 更新状态为上传中
        updatedImages[i] = { ...img, status: 'uploading' };
        setImages([...updatedImages]);

        try {
          // 将图片 URL 提交到 AIGC 素材组（仅上传，不再入库素材库）
          const res = await createAigcAsset(groupId, img.imageUrl);

          // 返回值平铺：{ assetId, groupId, sourceUrl }
          const { assetId, groupId: complianceGroupId, sourceUrl } =
            res.data || {};
          if (res.success && assetId) {
            updatedImages[i] = {
              ...img,
              status: 'success',
              assetId: assetId,
              groupId: complianceGroupId,
              sourceUrl,
            };
            // 同步更新 assetIdMapRef，确保重新打开时也能识别已检查过的图片
            assetIdMapRef.current.set(img.imageUrl, assetId);
          } else {
            updatedImages[i] = {
              ...img,
              status: 'failed',
              error: res.message || '上传失败'
            };
          }
        } catch (err: any) {
          updatedImages[i] = {
            ...img,
            status: 'failed',
            error: err?.message || '上传失败'
          };
        }

        setImages([...updatedImages]);
      }

      // 检查是否全部成功
      const allSuccess = updatedImages.every(img => img.status === 'success');
      const failedCount = updatedImages.filter(img => img.status === 'failed').length;
      // 仅回传「本次实际检查并成功」的图片（pendingIndices 中的），
      // 已合规的旧图不重新 patch，避免用缺失的 groupId/url 覆盖其原有 seedance。
      const pendingSet = new Set(pendingIndices);
      const currentSuccessImages: ComplianceDetail[] = updatedImages
        .map((img, idx) => ({ img, idx }))
        .filter(({ img, idx }) => img.status === 'success' && pendingSet.has(idx))
        .map(({ img }) => ({
          characterId: img.characterId,
          sceneId: img.sceneId,
          imageUrl: img.imageUrl,
          assetId: img.assetId,
          assetKey: img.assetKey,
          groupId: img.groupId,
          url: img.sourceUrl,
          imageType: img.imageType,
        }));
      if (currentSuccessImages.length > 0) {
        console.log('[VideoComplianceDialog] onCheckComplete successImages:', currentSuccessImages.length);
        // await 让 loading 覆盖 patch（写 image_asset.data.seedance）阶段，避免 patch 进行中按钮可重复点击
        await onCheckComplete?.(currentSuccessImages);
      }
      if (allSuccess) {
        message.success('合规检查完成，所有图片已入库');
      } else if (failedCount > 0) {
        message.warning(`合规检查完成，${failedCount} 张图片仍未通过（可重新点击检查）`);
      } else {
        message.info('合规检查完成（部分图片已合规）');
      }
    } finally {
      setChecking(false);
      checkingRef.current = false;
    }
  };

  // 确认生成
  const handleConfirm = async () => {
    console.log('[VideoComplianceDialog] handleConfirm clicked, images:', images.map(img => ({ id: img.id, status: img.status, assetId: img.assetId })));
    const successImages = images.filter(img => img.status === 'success');
    const failedImages = images.filter(img => img.status === 'failed' || img.status === 'pending');

    if (successImages.length === 0) {
      console.log('[VideoComplianceDialog] no success images, abort');
      message.error('没有可用的合规图片，请先完成合规检查');
      return;
    }

    // 必须全部合规检查通过才能生成视频
    if (failedImages.length > 0) {
      console.log('[VideoComplianceDialog] has failed/pending images, abort');
      const failedNames = failedImages
        .map(img => img.sceneName ? `${img.sceneName} - ${img.imageName}` : `${img.characterName} - ${img.imageName}`)
        .slice(0, 3)
        .join('、');
      const more = failedImages.length > 3 ? ` 等 ${failedImages.length} 张` : '';
      message.error(`有 ${failedImages.length} 张图片未通过合规检查（${failedNames}${more}），请先完成所有图片的合规检查`);
      return;
    }

    await doConfirm(successImages);
  };

  const doConfirm = async (successImages: ImageItem[]) => {
    const assetIdMap = new Map<string, string>();
    const complianceDetails: ComplianceDetail[] = [];
    for (const img of successImages) {
      if (img.assetId) {
        console.log('[VideoComplianceDialog] mapping:', img.imageUrl, '->', img.assetId);
        assetIdMap.set(img.imageUrl, img.assetId);
        complianceDetails.push({
          imageUrl: img.imageUrl,
          assetId: img.assetId,
          assetKey: img.assetKey,
          groupId: img.groupId,
          url: img.sourceUrl,
          characterId: img.characterId,
          sceneId: img.sceneId,
        });
      }
    }
    console.log('[VideoComplianceDialog] final assetIdMap:', assetIdMap?.size);

    setConfirming(true);
    // 修复：先关闭 dialog（用户已确认），再触发视频生成。
    // 视频生成是异步任务（Bull 队列），不需要等待完成才让用户继续操作。
    handleClose();
    try {
      await onConfirm(assetIdMap, complianceDetails);
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    } finally {
      setConfirming(false);
    }
  };

  // 检查状态：所有图片都成功 / 全部 / 部分
  const allSuccess = images.length > 0 && images.every(img => img.status === 'success');
  const anyUploading = images.some(img => img.status === 'uploading');
  const anyFailed = images.some(img => img.status === 'failed');

  // 合规检查完成状态（一旦检查完成并全部成功，则保持禁用状态）
  const isComplianceCheckDone = allSuccess && images.length > 0;

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-accent-primary" />
          <span>视频生成合规检查</span>
        </div>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      width={900}
      destroyOnHidden
    >
      <div className="py-4">
        {/* 图片列表 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">
              {frameImages && frameImages.length > 0 ? '首尾帧图片' : '角色相关图片'}（{images.length} 张）
            </span>
            {images.length > 0 && (
              <span className="text-xs text-text-muted">
                {images.filter(i => i.status === 'success').length} / {images.length} 已入库
                {anyFailed && (
                  <span className="text-red-500 ml-2">
                    （{images.filter(i => i.status === 'failed').length} 张未通过）
                  </span>
                )}
              </span>
            )}
          </div>

          {images.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <ImageIcon size={40} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">没有需要检查的图片</p>
              <p className="text-xs mt-1">仅虚拟人物图片需要合规检查</p>
            </div>
          ) : (
            <div className="columns-4 gap-3 max-h-[400px] overflow-y-auto p-1">
              {images.map((img, idx) => (
                <div
                  key={img.id}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer hover:border-accent-primary break-inside-avoid mb-3 ${
                    img.status === 'success'
                      ? 'border-accent-success'
                      : img.status === 'failed'
                      ? 'border-red-500'
                      : img.status === 'uploading'
                      ? 'border-yellow-500'
                      : 'border-border'
                  }`}
                  onClick={() => openPreview(idx)}
                >
                  <div className="relative w-full bg-bg-tertiary flex items-center justify-center overflow-hidden">
                    <img
                      src={img.imageUrl}
                      alt={`${img.characterName} - ${img.imageName}`}
                      className="w-full h-auto"
                    />

                    {/* 状态叠加层 */}
                    {img.status === 'uploading' && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Spin size="small" />
                      </div>
                    )}

                    {img.status === 'success' && (
                      <div className="absolute top-1 right-1 w-5 h-5 bg-accent-success rounded-full flex items-center justify-center">
                        <CheckCircle2 size={12} className="text-white" />
                      </div>
                    )}

                    {img.status === 'failed' && (
                      <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center p-1">
                        <AlertTriangle size={16} className="text-red-500 mb-1" />
                        <span className="text-xs text-white text-center line-clamp-2">
                          {img.error || '入库失败'}
                        </span>
                      </div>
                    )}

                    {/* 图片信息 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1">
                      <p className="text-[10px] text-white truncate">
                        {img.sceneName || img.characterName || (img.imageType === 'ref' ? '参考附件' : '')}
                      </p>
                      <p className="text-[9px] text-white/70 truncate">
                        {img.imageName}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 素材组状态 */}
        {images.length > 0 && (
          <div className="mb-4 min-h-[24px]">
            {groupLoading && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Spin size="small" />
                <span>正在获取 AIGC 素材组...</span>
              </div>
            )}
            {groupError && !groupLoading && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-red-500">{groupError}</span>
                <Button
                  size="small"
                  onClick={() => fetchAigcGroup()}
                  disabled={groupLoading}
                >
                  重试
                </Button>
              </div>
            )}
            {hasGroup && !groupLoading && !groupError && (
              <div className="flex items-center gap-2 text-xs text-accent-success">
                <CheckCircle2 size={14} />
                <span>素材组已就绪</span>
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button onClick={handleClose} disabled={anyUploading || confirming}>
            取消
          </Button>
          <Button
            onClick={handleComplianceCheck}
            disabled={!hasGroup || images.length === 0 || checking || anyUploading || groupLoading || isComplianceCheckDone}
            loading={checking}
          >
            {isComplianceCheckDone ? '已检查完毕' : checking ? '检查中...' : '合规检查'}
          </Button>
          <Button
            type="primary"
            onClick={handleConfirm}
            disabled={!allSuccess || anyUploading || confirming}
            loading={confirming}
          >
            {confirming
              ? '生成中...'
              : allSuccess
                ? '生成视频'
                : `等待合规检查（${images.filter(i => i.status === 'success').length}/${images.length}）`}
          </Button>
        </div>
      </div>

      {/* 图片预览 */}
      <ImagePreviewModal
        isOpen={previewOpen}
        images={previewImages}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        onPrev={() => setPreviewIndex(i => Math.max(0, i - 1))}
        onNext={() => setPreviewIndex(i => Math.min(previewImages.length - 1, i + 1))}
        title={previewImages[previewIndex] ? (images[previewIndex]?.sceneName || images[previewIndex]?.characterName || '') + ' - ' + (images[previewIndex]?.imageName || '') : ''}
      />
    </Modal>
  );
};