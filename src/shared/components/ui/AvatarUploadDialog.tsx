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
 * 本地上传图片对话框(纯前端精简版)
 *
 * 原版含「真人资产 / 素材库 / 扫码上传」等依赖服务端的 tab,开源版仅保留本地上传。
 * props 签名与原版兼容:资产库相关 props 保留但不再渲染对应 tab。
 */
import React, { useEffect, useRef, useState } from "react";
import { Modal, Upload, Button, message } from "antd";
import type { UploadFile } from "antd";
import { ImagePlus } from "lucide-react";
import type { UserMaterialItem } from "@/shared/api/userMaterialApi";

export type { UserMaterialItem } from '@/shared/api/userMaterialApi';

export interface AvatarUploadDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void>;
  /** 多文件本地上传确认(multiple 为 true 时优先于 onConfirm) */
  onConfirmFiles?: (files: File[]) => Promise<void>;
  /** 兼容原版签名:服务端资产库已在开源版移除,传入无效 */
  showAssetTab?: boolean;
  /** 兼容原版签名:原版用于隐藏本地上传 tab(仅显示服务端资产),开源版恒显示本地上传 */
  hideLocalTab?: boolean;
  onSelectAsset?: (asset: UserMaterialItem) => Promise<void>;
  onSelectAssets?: (assets: UserMaterialItem[]) => Promise<void>;
  showCharacterLibraryTab?: boolean;
  onSelectCharacterAsset?: (asset: UserMaterialItem) => Promise<void>;
  onSelectCharacterAssets?: (assets: UserMaterialItem[]) => Promise<void>;
  showSceneLibraryTab?: boolean;
  sceneLibraryType?: string;
  onSelectSceneAsset?: (asset: UserMaterialItem) => Promise<void>;
  onSelectSceneAssets?: (assets: UserMaterialItem[]) => Promise<void>;
  /** 本地上传允许视频/音频(默认仅图片) */
  allowMedia?: boolean;
  /** 多选模式:本地上传可多文件(需配套 onConfirmFiles) */
  multiple?: boolean;
  /** 本地上传最大文件数(multiple 为 true 时生效) */
  maxCount?: number;
  title?: string;
  okText?: string;
  uploadLabel?: string;
}

export const AvatarUploadDialog: React.FC<AvatarUploadDialogProps> = ({
  open,
  onClose,
  onConfirm,
  onConfirmFiles,
  allowMedia = false,
  multiple = false,
  maxCount = 9,
  title = "本地上传图片",
  okText = "确认上传",
  uploadLabel = "头像",
}) => {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const objectUrlRef = useRef<string>("");
  const selectedFilesRef = useRef<Map<string, File>>(new Map());

  // 关闭时清理预览与对象 URL
  useEffect(() => {
    if (!open) {
      setFileList([]);
      setPreviewUrl("");
      selectedFilesRef.current.clear();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    }
  }, [open]);

  const accept = allowMedia ? "image/*,video/*,audio/*" : "image/*";

  const handleBeforeUpload = (file: File) => {
    if (multiple) {
      if (selectedFilesRef.current.size >= maxCount) {
        message.warning(`最多上传 ${maxCount} 个文件`);
        return Upload.LIST_IGNORE;
      }
      const uid = `${file.name}-${file.size}-${Date.now()}`;
      selectedFilesRef.current.set(uid, file);
      setFileList((prev) => [
        ...prev,
        {
          uid,
          name: file.name,
          size: file.size,
          type: file.type,
          originFileObj: file as unknown as UploadFile["originFileObj"],
        } as UploadFile,
      ]);
      // 图片类型生成首张预览
      if (!previewUrl && file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      }
      return Upload.LIST_IGNORE;
    }

    // 单选模式:替换当前选择
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(file.type.startsWith("image/") ? url : "");
    setFileList([
      {
        uid: "single",
        name: file.name,
        size: file.size,
        type: file.type,
        originFileObj: file as unknown as UploadFile["originFileObj"],
      } as UploadFile,
    ]);
    return Upload.LIST_IGNORE;
  };

  const handleRemove = (file: UploadFile) => {
    if (multiple) {
      selectedFilesRef.current.delete(file.uid);
      setFileList((prev) => prev.filter((f) => f.uid !== file.uid));
      return;
    }
    setFileList([]);
    setPreviewUrl("");
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  };

  const handleOk = async () => {
    if (multiple) {
      const files = Array.from(selectedFilesRef.current.values());
      if (!files.length) {
        message.warning("请先选择文件");
        return;
      }
      setUploading(true);
      try {
        if (onConfirmFiles) {
          await onConfirmFiles(files);
        } else {
          await onConfirm(files[0]);
        }
        onClose();
      } catch (err) {
        message.error((err as Error)?.message || "上传失败");
      } finally {
        setUploading(false);
      }
      return;
    }

    const file = fileList[0]?.originFileObj as File | undefined;
    if (!file) {
      message.warning(`请先选择${uploadLabel}`);
      return;
    }
    setUploading(true);
    try {
      await onConfirm(file);
      onClose();
    } catch (err) {
      message.error((err as Error)?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={handleOk}
      okText={okText}
      cancelText="取消"
      confirmLoading={uploading}
      width={480}
      destroyOnClose
    >
      <div className="py-2">
        <Upload.Dragger
          fileList={fileList}
          beforeUpload={handleBeforeUpload}
          onRemove={handleRemove}
          accept={accept}
          multiple={multiple}
          maxCount={multiple ? maxCount : 1}
          showUploadList={{
            showPreviewIcon: false,
            showRemoveIcon: true,
          }}
        >
          <div className="py-4 flex flex-col items-center gap-2">
            <ImagePlus size={32} className="text-text-muted" />
            <p className="text-sm text-text-primary">点击或拖拽{uploadLabel}到此处</p>
            <p className="text-xs text-text-muted">
              {allowMedia ? "支持图片" + "/视频/音频" : "支持 PNG、JPG、WebP 格式图片"}
              {multiple ? `,最多 ${maxCount} 个` : ""}
            </p>
          </div>
        </Upload.Dragger>

        {previewUrl && (
          <div className="mt-3 flex justify-center">
            <img
              src={previewUrl}
              alt="预览"
              className="max-h-48 rounded-lg border border-current/10"
            />
          </div>
        )}

        {!previewUrl && fileList.length > 0 && !multiple && (
          <p className="mt-2 text-xs text-text-muted text-center">
            {fileList[0]?.name}
          </p>
        )}

        {multiple && fileList.length > 0 && (
          <p className="mt-2 text-xs text-text-muted text-center">
            已选择 {fileList.length} / {maxCount} 个文件
          </p>
        )}
      </div>
    </Modal>
  );
};
