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

import React, { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { X, Film, Upload, Download, Loader2, Folder, LayoutGrid } from 'lucide-react';
import { ThemeToggle } from '@/shared/components/ui/ThemeToggle';
import { WorkflowProjectAssetDrawer } from './WorkflowProjectAssetDrawer';

interface WorkflowPageHeaderProps {
  projectName?: string;
  projectId?: string;
  saveStatus: 'saved' | 'saving' | 'unsaved';
  onSaveClick: () => void;
  onBack: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownloadData: () => void;
  onConvertToCanvas?: () => void;
  isSyncing: boolean;
  isImporting?: boolean;
  isConvertingToCanvas?: boolean;
}

/**
 * WorkflowPage 顶部 Header：项目名称、保存状态、主题、导入/同步/下载、项目资产库、关闭(X)
 */
export const WorkflowPageHeader: React.FC<WorkflowPageHeaderProps> = ({
  projectName,
  projectId,
  saveStatus,
  onSaveClick,
  onBack,
  fileInputRef,
  onFileChange,
  onDownloadData,
  onConvertToCanvas,
  isSyncing,
  isImporting = false,
  isConvertingToCanvas = false,
}) => {
  const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
  return (
    <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="w-full px-6 py-4 max-md:px-3 max-md:py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center max-md:w-8 max-md:h-8">
              <Film size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-text-primary max-md:text-base">
                {projectName || '剧本转视频工作流'}
              </h1>
              <p className="text-xs text-text-muted max-md:hidden">
                Script to Video Pipeline
              </p>
            </div>
          </div>

          {/* 右侧按钮组 */}
          <div className="flex items-center gap-3 max-md:gap-1.5">
            {/* 保存状态指示器 */}
            <Tooltip title={saveStatus === 'unsaved' ? '点击保存' : '点击再保存一次'}>
              {saveStatus === 'unsaved' ? (
                <button
                  onClick={onSaveClick}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors bg-amber-500/10 text-amber-600 border border-amber-500/20 hover:bg-amber-500/20 cursor-pointer"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="max-md:hidden">未保存</span>
                </button>
              ) : (
                <button
                  onClick={onSaveClick}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 cursor-pointer"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="max-md:hidden">已保存</span>
                </button>
              )}
            </Tooltip>

            {/* 主题切换 */}
            <ThemeToggle />

            {/* 导入数据按钮 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary/50 text-text-primary border border-border hover:bg-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-md:px-2 max-md:py-1.5"
            >
              {isImporting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              <span className="text-sm font-medium max-md:hidden">
                {isImporting ? '导入中...' : '导入数据'}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={onFileChange}
            />

            {/* 下载数据按钮 */}
            <button
              onClick={onDownloadData}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white border border-accent-primary/30 hover:bg-accent-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-md:px-2 max-md:py-1.5"
            >
              {isSyncing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              <span className="text-sm font-medium max-md:hidden">
                {isSyncing ? '同步中...' : '下载数据'}
              </span>
            </button>

            {/* 转无限画布按钮 */}
            {onConvertToCanvas && (
              <button
                onClick={onConvertToCanvas}
                disabled={isConvertingToCanvas}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500 text-white border border-purple-500/30 hover:bg-purple-500/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-md:px-2 max-md:py-1.5"
              >
                {isConvertingToCanvas ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <LayoutGrid size={16} />
                )}
                <span className="text-sm font-medium max-md:hidden">
                  {isConvertingToCanvas ? '转换中...' : '转无限画布'}
                </span>
              </button>
            )}

            {/* 项目资产库 */}
            <Button icon={<Folder size={16} />} onClick={() => setAssetDrawerOpen(true)}>
              项目资产库
            </Button>
            <WorkflowProjectAssetDrawer
              open={assetDrawerOpen}
              onClose={() => setAssetDrawerOpen(false)}
              projectId={projectId}
            />

            {/* 关闭项目（返回项目列表，onBack 内含返回前保存逻辑） */}
            <button
              onClick={onBack}
              title="关闭项目"
              className="flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
