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

import { useState, useEffect } from 'react';
import { Tabs, Button, Tooltip, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { Users, Map, Plus, UserPlus, User, Image as ImageIcon, MoreHorizontal, Check, Lock, Unlock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { userStorage } from '@/shared/utils/userScopedStorage';
import { localApi } from '@/storage';
import { readAnyCompliance } from '@/modules/workflow/providers/compliance-factory';
import type { NewCharacter } from './CreateCharacterDialog';
import type { NewScene } from './CreateSceneDialog';

/** 从缓存读取图片合规状态 */
const getIsCompliant = (img: any): boolean => {
  if (!img?.assetId) return false;
  const imgData = localApi.getCachedImageData(img.assetId);
  const compliance = imgData ? readAnyCompliance(imgData) : undefined;
  return !!compliance?.isCompliant;
};

interface LeftSidebarProps {
  characters: Array<NewCharacter & { avatarImages?: Array<{ imageUrl?: string; assetId?: string }> }>;
  scenes: NewScene[];
  onAddCharacter: () => void;
  onAddScene: () => void;
  onDragStartItem?: (data: { type: 'character' | 'scene'; refId: string }) => void;
  onDragEndItem?: () => void;
  onDeleteCharacter?: (char: NewCharacter) => void;
  onOpenMultiView?: (char: NewCharacter) => void;
  onOpenAvatarPreview?: (char: NewCharacter) => void;
  onGenerateCharacterViews?: (char: NewCharacter) => void;
  onEditScene?: (scene: NewScene) => void;
  onDeleteScene?: (scene: NewScene) => void;
  onOpenScenePreview?: (scene: NewScene) => void;
  onOpenSceneImagesPreview?: (scene: NewScene, images: string[]) => void;
  aspectRatio?: string;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = (props) => {
  const {
    characters,
    scenes,
    onAddCharacter,
    onAddScene,
    onDragStartItem,
    onDragEndItem,
    onDeleteCharacter,
    onOpenMultiView,
    onOpenAvatarPreview,
    onEditScene,
    onDeleteScene,
    onOpenSceneImagesPreview,
    aspectRatio = '16:9',
  } = props;
  const [pinned, setPinned] = useState(() => {
    try {
      return userStorage.getItem('instant_left_sidebar_pinned') === 'true';
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState(!pinned);

  // 固定状态持久化
  useEffect(() => {
    try {
      userStorage.setItem('instant_left_sidebar_pinned', String(pinned));
    } catch {
      // ignore
    }
  }, [pinned]);

  const aspectClass =
    aspectRatio === '9:16'
      ? 'aspect-[9/16]'
      : aspectRatio === '21:9'
      ? 'aspect-[21/9]'
      : 'aspect-[16/9]';

  const getCharMenuItems = (char: NewCharacter): MenuProps['items'] => [
    {
      key: 'delete',
      label: <span className="text-accent-error">删除</span>,
      onClick: () => onDeleteCharacter?.(char),
    },
  ];

  const getSceneMenuItems = (scene: NewScene): MenuProps['items'] => [
    {
      key: 'edit',
      label: '编辑',
      onClick: () => onEditScene?.(scene),
    },
    {
      key: 'delete',
      label: <span className="text-accent-error">删除</span>,
      onClick: () => onDeleteScene?.(scene),
    },
  ];

  const tabItems = [
    {
      key: 'characters',
      label: collapsed ? (
        <Tooltip title="角色" placement="top">
          <span className="flex items-center justify-center w-full">
            <Users size={16} />
          </span>
        </Tooltip>
      ) : (
        <div className="flex items-center justify-between px-1 w-full">
          <div className="flex items-center">
            <Users size={14} />
            <span className="ml-1.5">角色</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddCharacter();
            }}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded-md bg-accent-primary/10 text-accent-primary hover:bg-accent-primary hover:text-white transition-colors"
            title="新增角色"
          >
            <UserPlus size={14} />
          </button>
        </div>
      ),
      children: (
        <div className="flex flex-col flex-1 min-h-0">
          <div className={`flex-1 overflow-y-auto pr-1 ${collapsed ? 'space-y-3' : 'space-y-2'}`}>
            {characters.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <Users size={32} className="mb-2 opacity-50" />
                {!collapsed && <p className="text-sm">暂无角色</p>}
                {!collapsed && (
                  <Button type="primary" icon={<UserPlus size={16} />} onClick={onAddCharacter} className="mt-3">
                    添加角色
                  </Button>
                )}
              </div>
            ) : (
              characters.map((char) => {
                const isMale = char.gender === '男性';
                const isFemale = char.gender === '女性';
                const avatarSizeClass = collapsed ? 'w-10 h-10' : 'w-12 h-12';
                const avatarContent = (
                  <div className={`relative inline-block ${avatarSizeClass}`}>
                    {char.avatar ? (
                      <img
                        src={char.avatar}
                        alt={char.name}
                        draggable={false}
                        className={`rounded-full bg-bg-secondary object-cover flex-shrink-0 ${avatarSizeClass}`}
                      />
                    ) : (
                      <div
                        className={`rounded-full flex items-center justify-center flex-shrink-0 ${avatarSizeClass} ${
                          isMale ? 'bg-blue-500/20' : isFemale ? 'bg-pink-500/20' : 'bg-bg-secondary'
                        }`}
                      >
                        <User
                          size={collapsed ? 18 : 20}
                          className={`${isMale ? 'text-blue-400' : isFemale ? 'text-pink-400' : 'text-text-muted'}`}
                        />
                      </div>
                    )}
                    {/* 检查所有类型的图片是否已合规 */}
                    {(char.avatarImages?.some(img => getIsCompliant(img)) ||
                      char.portraitImages?.some(img => getIsCompliant(img)) ||
                      char.fullBodyImages?.some(img => getIsCompliant(img))) && (
                      <Tooltip title="已通过合规检查">
                        <div className={`absolute -top-0.5 -right-0.5 z-10 bg-cyan-500 text-white rounded-full flex items-center justify-center shadow-sm ${collapsed ? 'w-3 h-3' : 'w-3.5 h-3.5'}`}>
                          <Check size={collapsed ? 7 : 8} strokeWidth={4} />
                        </div>
                      </Tooltip>
                    )}
                  </div>
                );

                return (
                  <div
                    key={char.id}
                    draggable
                    onDragStart={(e) => {
                      const data = { type: 'character' as const, refId: char.id };
                      e.dataTransfer.clearData();
                      e.dataTransfer.setData('text/plain', JSON.stringify(data));
                      e.dataTransfer.setData('Text', JSON.stringify(data));
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStartItem?.(data);
                    }}
                    onDragEnd={() => onDragEndItem?.()}
                    className={`flex rounded-xl bg-bg-tertiary border border-border hover:border-accent-primary/30 transition-colors cursor-grab active:cursor-grabbing select-none ${
                      collapsed ? 'justify-center p-2' : 'items-center gap-3 p-3'
                    }`}
                  >
                    {collapsed ? (
                      <Tooltip
                        title={
                          <div className="flex flex-col items-center gap-2 max-w-xs">
                            {char.avatar ? (
                              <img src={char.avatar} alt={char.name} className="w-32 h-32 rounded-full object-cover" />
                            ) : (
                              <div
                                className={`w-32 h-32 rounded-full flex items-center justify-center ${
                                  isMale ? 'bg-blue-500/20' : isFemale ? 'bg-pink-500/20' : 'bg-bg-tertiary border border-border'
                                }`}
                              >
                                <User
                                  size={48}
                                  className={`${isMale ? 'text-blue-400' : isFemale ? 'text-pink-400' : 'text-text-muted'}`}
                                />
                              </div>
                            )}
                            <div className="text-center">
                              <p className="font-medium text-text-primary">{char.name}</p>
                              <p className="text-xs text-text-secondary">{char.gender} · {char.ageGroup} · {char.personality} · {char.appearance} · {char.occupation}</p>
                              {char.avatarPrompt && (
                                <p className="text-[10px] text-text-muted mt-1 max-w-[200px] line-clamp-3">{char.avatarPrompt}</p>
                              )}
                            </div>
                          </div>
                        }
                        placement="right"
                      >
                        <div className="cursor-pointer" onClick={() => onOpenAvatarPreview?.(char)}>
                          {avatarContent}
                        </div>
                      </Tooltip>
                    ) : (
                      <>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <Tooltip
                            title={
                              <div className="flex flex-col items-center gap-2 max-w-xs">
                                {char.avatar ? (
                                  <img src={char.avatar} alt={char.name} className="w-32 h-32 rounded-full object-cover" />
                                ) : (
                                  <div
                                    className={`w-32 h-32 rounded-full flex items-center justify-center ${
                                      isMale ? 'bg-blue-500/20' : isFemale ? 'bg-pink-500/20' : 'bg-bg-tertiary border border-border'
                                    }`}
                                  >
                                    <User
                                      size={48}
                                      className={`${isMale ? 'text-blue-400' : isFemale ? 'text-pink-400' : 'text-text-muted'}`}
                                    />
                                  </div>
                                )}
                                <div className="text-center">
                                  <p className="font-medium text-text-primary">{char.name}</p>
                                  <p className="text-xs text-text-secondary">{char.gender} · {char.ageGroup} · {char.personality} · {char.appearance} · {char.occupation}</p>
                                  {char.avatarPrompt && (
                                    <p className="text-[10px] text-text-muted mt-1 max-w-[200px] line-clamp-3">{char.avatarPrompt}</p>
                                  )}
                                </div>
                              </div>
                            }
                            placement="right"
                          >
                            <div
                              className="cursor-pointer"
                              onClick={() => onOpenMultiView?.(char)}
                              title="查看多视图"
                            >
                              {avatarContent}
                            </div>
                          </Tooltip>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-text-primary truncate">{char.name}</p>
                            <Dropdown menu={{ items: getCharMenuItems(char) }} placement="bottomRight">
                              <Button
                                type="text"
                                size="small"
                                icon={<MoreHorizontal size={16} />}
                                className="text-text-secondary hover:text-text-primary flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Dropdown>
                          </div>
                          <p className="text-xs text-text-secondary break-words">{char.gender} · {char.ageGroup} · {char.personality} · {char.appearance} · {char.occupation}</p>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'scenes',
      label: collapsed ? (
        <Tooltip title="场景" placement="top">
          <span className="flex items-center justify-center w-full">
            <Map size={16} />
          </span>
        </Tooltip>
      ) : (
        <div className="flex items-center justify-between px-1 w-full">
          <div className="flex items-center">
            <Map size={14} />
            <span className="ml-1.5">场景</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAddScene();
            }}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded-md bg-accent-primary/10 text-accent-primary hover:bg-accent-primary hover:text-white transition-colors"
            title="新增场景"
          >
            <Plus size={14} />
          </button>
        </div>
      ),
      children: (
        <div className="flex flex-col flex-1 min-h-0">
          <div className={`flex-1 overflow-y-auto pr-1 ${collapsed ? 'space-y-3' : 'space-y-2'}`}>
            {scenes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <Map size={32} className="mb-2 opacity-50" />
                {!collapsed && <p className="text-sm">暂无场景</p>}
                {!collapsed && (
                  <Button type="primary" icon={<Plus size={16} />} onClick={onAddScene} className="mt-3">
                    新建场景
                  </Button>
                )}
              </div>
            ) : (
              scenes.map((scene) => {
                const sceneImages = scene.imageUrls?.length ? scene.imageUrls : scene.imageUrl ? [scene.imageUrl] : [];
                const sceneImgClass = collapsed
                  ? 'w-10 h-10'
                  : aspectRatio === '9:16'
                    ? `w-12 ${aspectClass}`
                    : aspectRatio === '21:9'
                      ? `w-28 ${aspectClass}`
                      : `w-20 ${aspectClass}`;
                const imgContent = scene.imageUrl ? (
                  <div
                    className={`rounded-lg overflow-hidden bg-bg-secondary flex-shrink-0 ${sceneImgClass}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditScene?.(scene);
                    }}
                  >
                    <img
                      src={scene.imageUrl}
                      alt={scene.name}
                      draggable={false}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div
                    className={`rounded-lg bg-bg-secondary flex items-center justify-center flex-shrink-0 ${sceneImgClass}`}
                  >
                    <ImageIcon size={collapsed ? 18 : 18} className="text-text-muted" />
                  </div>
                );
                return (
                  <div
                    key={scene.id}
                    draggable
                    onDragStart={(e) => {
                      const data = { type: 'scene' as const, refId: scene.id };
                      e.dataTransfer.clearData();
                      e.dataTransfer.setData('text/plain', JSON.stringify(data));
                      e.dataTransfer.setData('Text', JSON.stringify(data));
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStartItem?.(data);
                    }}
                    onDragEnd={() => onDragEndItem?.()}
                    className={`flex rounded-xl bg-bg-tertiary border border-border hover:border-accent-primary/30 transition-colors cursor-grab active:cursor-grabbing select-none ${
                      collapsed ? 'justify-center p-2' : 'items-start gap-3 p-3'
                    }`}
                  >
                    {collapsed ? (
                      <Tooltip
                        title={
                          <div className="flex flex-col items-center gap-2 max-w-xs">
                            {scene.imageUrl ? (
                              <div className={`rounded-lg overflow-hidden ${aspectRatio === '9:16' ? 'w-16' : aspectRatio === '21:9' ? 'w-40' : 'w-32'} ${aspectClass}`}>
                                <img src={scene.imageUrl} alt={scene.name} className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <div className={`rounded-lg bg-bg-tertiary border border-border flex items-center justify-center ${aspectRatio === '9:16' ? 'w-16' : aspectRatio === '21:9' ? 'w-40' : 'w-32'} ${aspectClass}`}>
                                <ImageIcon size={32} className="text-text-muted" />
                              </div>
                            )}
                            <div className="text-center">
                              <p className="font-medium text-text-primary">{scene.name}</p>
                              <p className="text-xs text-text-secondary">{scene.prompt}</p>
                            </div>
                          </div>
                        }
                        placement="right"
                      >
                        {imgContent}
                      </Tooltip>
                    ) : (
                      <>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <div className="cursor-pointer">
                            {imgContent}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-sm font-medium text-text-primary truncate">{scene.name}</p>
                            <Dropdown menu={{ items: getSceneMenuItems(scene) }} placement="bottomRight">
                              <Button
                                type="text"
                                size="small"
                                icon={<MoreHorizontal size={16} />}
                                className="text-text-secondary hover:text-text-primary flex-shrink-0 -mt-1 -mr-1"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Dropdown>
                          </div>
                          {/* 提示词最多 3 行，超出省略号，悬停显示全文 */}
                          <Tooltip title={scene.prompt} placement="topLeft">
                            <p className="text-xs text-text-secondary line-clamp-3 break-words">{scene.prompt}</p>
                          </Tooltip>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div
      className={`h-full flex-1 bg-bg-secondary/95 backdrop-blur-md border-r border-border flex flex-col overflow-hidden z-20 transition-all duration-200 ${
        collapsed ? 'w-20' : 'w-[204px]'
      }`}
      onMouseEnter={() => !pinned && setCollapsed(false)}
      onMouseLeave={() => !pinned && setCollapsed(true)}
    >
      <div className="flex items-center justify-end px-2 py-2 border-b border-border gap-1">
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            title={collapsed ? '展开' : '缩进'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button
            onClick={() => {
              const next = !pinned;
              setPinned(next);
              setCollapsed(!next);
            }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              pinned
                ? 'text-accent-primary bg-accent-primary/10'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
            title={pinned ? '取消固定' : '固定侧边栏'}
          >
            {pinned ? <Unlock size={16} /> : <Lock size={16} />}
          </button>
        </div>
      </div>
      <Tabs
        defaultActiveKey="characters"
        items={tabItems}
        animated={false}
        className={`flex-1 flex flex-col instant-sidebar-tabs ${collapsed ? 'instant-sidebar-tabs-collapsed' : ''}`}
        tabBarStyle={{ padding: '0 8px', marginBottom: 0 }}
        style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
      />
    </div>
  );
};
