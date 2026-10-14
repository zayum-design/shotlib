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
 * 短剧项目列表(参照云端版 DramaProjectList):
 * 卡片 = 名称 + 类型/比例/集数/片段数标签 + 大图标 + 资产统计 + 创建时间;
 * 统计为纯本地计算(loadProjectsStats),无后端。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Clapperboard,
  Plus,
  Clock,
  MoreVertical,
  Users,
  ImageIcon,
  Film,
  Music,
  Circle,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Button, Card, Dropdown } from 'antd';
import type { Project } from '@/shared/types/project';
import { loadProjectsStats, type ProjectStats } from '../projectStats';

interface DramaProjectListProps {
  projects: Project[];
  trashed?: boolean;
  onCreateProject: () => void;
  onOpenProject: (project: Project) => void;
  onOpenEdit: (project: Project, e: React.MouseEvent) => void;
  onDeleteProject: (id: string) => void;
  onRestoreProject?: (id: string) => void;
  onPurgeProject?: (id: string) => void;
  formatDate: (dateStr: string) => string;
}

const EMPTY_STATS: ProjectStats = {
  characterCount: 0,
  sceneCount: 0,
  segmentCount: 0,
  audioCount: 0,
  hasData: false,
};

/** 资产统计组件 */
const AssetStats: React.FC<{
  stats: ProjectStats;
  type: 'script' | 'instant';
}> = ({ stats, type }) => {
  const items = [];

  if (type === 'script') {
    if (stats.characterCount > 0) {
      items.push({ icon: Users, label: '角色', count: stats.characterCount });
    }
    if (stats.sceneCount > 0) {
      items.push({ icon: ImageIcon, label: '场景', count: stats.sceneCount });
    }
    if (stats.segmentCount > 0) {
      items.push({ icon: Film, label: '片段', count: stats.segmentCount });
    }
    if (stats.audioCount > 0) {
      items.push({ icon: Music, label: '音频', count: stats.audioCount });
    }
  } else {
    if (stats.characterCount > 0) {
      items.push({ icon: Users, label: '角色', count: stats.characterCount });
    }
    if (stats.sceneCount > 0) {
      items.push({ icon: ImageIcon, label: '场景', count: stats.sceneCount });
    }
    if (stats.segmentCount > 0) {
      items.push({ icon: Film, label: '分镜', count: stats.segmentCount });
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-muted mt-2 mb-2">
        <Circle size={12} className="text-text-muted" />
        <span>暂无资产</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3 mt-2 mb-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-1 text-xs text-text-secondary"
          >
            <Icon size={13} className="text-text-muted" />
            <span className="font-medium text-text-primary">{item.count}</span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};

export const DramaProjectList: React.FC<DramaProjectListProps> = ({
  projects,
  trashed,
  onCreateProject,
  onOpenProject,
  onOpenEdit,
  onDeleteProject,
  onRestoreProject,
  onPurgeProject,
  formatDate,
}) => {
  const [statsMap, setStatsMap] = useState<Record<string, ProjectStats>>({});

  // 异步加载每个项目的本地统计
  const loadAllStats = useCallback(async (projectList: Project[]) => {
    const newMap = await loadProjectsStats(projectList);
    setStatsMap(newMap);
  }, []);

  useEffect(() => {
    if (projects.length > 0) {
      loadAllStats(projects);
    }
  }, [projects, loadAllStats]);

  if (projects.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-20"
      >
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-bg-secondary flex items-center justify-center">
          <Clapperboard size={40} className="text-text-muted" />
        </div>
        <h3 className="text-xl font-medium text-text-primary mb-2">
          {trashed ? '回收站为空' : '暂无项目'}
        </h3>
        <p className="text-text-secondary mb-6">
          {trashed ? '没有已删除的项目' : '点击上方按钮创建你的第一个项目'}
        </p>
        {!trashed && (
          <Button
            type="primary"
            size="large"
            icon={<Plus size={18} />}
            onClick={onCreateProject}
            className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
          >
            新建项目
          </Button>
        )}
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((project, index) => {
        const stats = statsMap[project.id] || EMPTY_STATS;

        return (
          <motion.div
            key={project.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card
              className={`bg-bg-secondary border-border ${
                trashed
                  ? 'cursor-default opacity-80'
                  : 'cursor-pointer hover:border-accent-primary/50'
              } transition-all group h-full`}
              onClick={trashed ? undefined : () => onOpenProject(project)}
              styles={{ body: { height: '100%', padding: '16px' } }}
            >
              <div className="flex flex-col h-full">
                {/* 头部：标题/标签 + 大图标/更多按钮 */}
                <div className="flex items-end justify-between gap-3 mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-medium text-text-primary mb-2">
                      {project.name}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          project.type === 'instant'
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-blue-500/10 text-blue-500'
                        }`}
                      >
                        {project.type === 'instant' ? '即时创作' : '剧本模式'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500">
                        {project.aspectRatio}
                      </span>
                      {project.episodeCount && project.episodeCount > 1 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                          {project.episodeCount}集
                        </span>
                      ) : null}
                      {stats.segmentCount > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-500">
                          {stats.segmentCount}片段
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0">
                    <div>
                      {project.type === 'instant' ? (
                        <Clapperboard size={64} className="text-amber-500" />
                      ) : (
                        <Clapperboard size={64} className="text-accent-primary" />
                      )}
                    </div>
                    {trashed ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="small"
                          icon={<RotateCcw size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreProject?.(project.id);
                          }}
                        >
                          恢复
                        </Button>
                        <Button
                          size="small"
                          danger
                          icon={<Trash2 size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPurgeProject?.(project.id);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    ) : (
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'edit',
                              label: '修改项目',
                              onClick: (e) =>
                                onOpenEdit(project, e.domEvent as React.MouseEvent),
                            },
                            {
                              key: 'delete',
                              label: '删除',
                              danger: true,
                              onClick: (e) => {
                                e.domEvent.stopPropagation();
                                onDeleteProject(project.id);
                              },
                            },
                          ],
                        }}
                        trigger={['click']}
                        placement="bottomRight"
                      >
                        <Button
                          type="text"
                          icon={<MoreVertical size={16} />}
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 flex-shrink-0"
                        />
                      </Dropdown>
                    )}
                  </div>
                </div>

                {/* 资产统计 */}
                <AssetStats stats={stats} type={project.type} />

                {/* 底部：创建时间 */}
                <div className="flex items-center gap-2 text-xs text-text-muted pt-2 mt-auto border-t border-border/50">
                  <Clock size={12} className="text-text-muted" />
                  <span>创建于 {formatDate(project.createdAt)}</span>
                </div>
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
};
