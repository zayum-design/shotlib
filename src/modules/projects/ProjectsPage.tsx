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
 * 首页(参照云端版 /create/drama 首页 CreatePage standalone 布局):
 * 全局 Header(logo + 主题切换 + 设置) + 短剧 Tab + 项目列表(标题区/新建/回收站)
 * + 新建项目弹窗 + 修改项目弹窗 + 删除确认。
 * 数据全部来自本地 projectStore(IndexedDB),无登录态。
 */
import { useEffect, useState } from 'react';
import { Clapperboard, Plus, Trash2, ArrowLeft, Film, Settings } from 'lucide-react';
import { Input, Button, Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/shared/stores/projectStore';
import { ThemeToggle } from '@/shared/components/ui/ThemeToggle';
import type { Project, AspectRatio, ProjectType } from '@/shared/types/project';
import { useWorkflowStore } from '../workflow/stores/workflowStore';
import { DramaProjectList } from './components/DramaProjectList';
import { CreateProjectModal, EditProjectModal } from './components/CreateProjectModals';
import { invalidateProjectStats } from './projectStats';

/** 首页 Tab 配置(仅短剧工作流一个创作模块) */
const createTabs: Array<{ key: 'drama'; label: string; icon: typeof Clapperboard }> = [
  { key: 'drama', label: '短剧', icon: Clapperboard },
];

export const ProjectsPage = () => {
  const navigate = useNavigate();
  const {
    projects,
    createProject,
    updateProject,
    deleteProject,
    restoreProject,
    purgeProject,
    loadTrashedProjects,
    trashedProjects,
    setCurrentProject,
    init,
  } = useProjectStore();
  const clearStore = useWorkflowStore((s) => s.clearStore);

  const [activeTab] = useState<'drama'>('drama');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [view, setView] = useState<'active' | 'trashed'>('active');
  const [creationMode, setCreationMode] = useState<'script' | 'instant' | null>('script');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editAspectRatio, setEditAspectRatio] = useState<AspectRatio>('9:16');

  // 挂载时加载项目列表
  useEffect(() => {
    init();
  }, [init]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      message.warning('请输入项目名称');
      return;
    }
    if (!creationMode) {
      message.warning('请选择创作模式');
      return;
    }
    const project = await createProject(
      newProjectName.trim(),
      'drama',
      creationMode as ProjectType,
      aspectRatio,
    );
    clearStore();
    setNewProjectName('');
    setCreationMode('script');
    setAspectRatio('9:16');
    setIsModalOpen(false);
    message.success('项目创建成功');

    if (creationMode === 'instant') {
      navigate(`/instant/${project.id}`);
    } else {
      navigate(`/workflow/${project.id}`);
    }
  };

  const handleModeChange = (mode: 'script' | 'instant', checked: boolean) => {
    if (checked) {
      setCreationMode(mode);
    } else {
      setCreationMode(null);
    }
  };

  const handleDeleteProject = (id: string) => {
    setDeletingId(id);
  };

  // 恢复回收站中的项目
  const handleRestoreProject = async (id: string) => {
    try {
      await restoreProject(id);
      invalidateProjectStats(id);
      message.success('项目已恢复');
    } catch {
      message.error('恢复失败，请重试');
    }
  };

  // 永久删除（硬删除）回收站中的项目
  const handlePurgeProject = (id: string) => {
    Modal.confirm({
      title: '永久删除',
      content: '此操作不可恢复，项目及其所有数据将被彻底删除。确定继续吗？',
      okText: '永久删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await purgeProject(id);
          invalidateProjectStats(id);
          message.success('项目已永久删除');
        } catch {
          message.error('删除失败，请重试');
        }
      },
    });
  };

  const handleOpenEdit = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project);
    setEditProjectName(project.name);
    setEditAspectRatio(project.aspectRatio);
  };

  const handleSaveEdit = () => {
    if (!editingProject) return;
    if (!editProjectName.trim()) {
      message.warning('请输入项目名称');
      return;
    }
    updateProject(editingProject.id, {
      name: editProjectName.trim(),
      aspectRatio: editAspectRatio,
    });
    invalidateProjectStats(editingProject.id);
    setEditingProject(null);
    setEditProjectName('');
    setEditAspectRatio('9:16');
    message.success('项目修改成功');
  };

  const confirmDelete = () => {
    if (deletingId) {
      deleteProject(deletingId);
      invalidateProjectStats(deletingId);
      message.success('项目已删除');
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleOpenProject = (project: Project) => {
    // 重置工作流状态(防止跨项目数据泄露)，设置当前项目并导航到对应页面
    clearStore();
    setCurrentProject(project.id);
    invalidateProjectStats(project.id);
    if (project.type === 'instant') {
      navigate(`/instant/${project.id}`);
    } else {
      navigate(`/workflow/${project.id}`);
    }
  };

  const dramaProjects = projects.filter((p) => p.category === 'drama');

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* 全局 Header：logo + 主题切换 + 设置 */}
      <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center">
                <Film size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-text-primary">ShotLib</h1>
                <p className="text-xs text-text-muted">AI 短剧创作工作台 · 数据保存在本地浏览器</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <ThemeToggle />
              <Button
                icon={<Settings size={16} />}
                onClick={() => navigate('/settings')}
              >
                设置
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab 导航 */}
      <div className="border-b border-border bg-bg-secondary/50">
        <div className="max-w-4xl mx-auto px-6">
          <nav className="flex gap-1">
            {createTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  className={`
                    flex items-center gap-2 px-5 py-4 text-sm font-medium
                    border-b-2 transition-all relative
                    ${
                      isActive
                        ? 'text-accent-primary border-accent-primary'
                        : 'text-text-muted border-transparent hover:text-text-primary hover:border-border'
                    }
                  `}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* 短剧项目列表 */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* 标题区 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-text-primary">
              {view === 'trashed' ? '回收站' : '我的项目'}
            </h2>
            <p className="text-text-secondary mt-1">
              {view === 'trashed'
                ? '恢复或永久删除你的短剧项目'
                : '创建和管理你的短剧项目'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {view === 'active' && (
              <Button
                type="primary"
                size="large"
                icon={<Plus size={18} />}
                onClick={() => setIsModalOpen(true)}
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                新建项目
              </Button>
            )}
            <Button
              size="large"
              icon={view === 'trashed' ? <ArrowLeft size={18} /> : <Trash2 size={18} />}
              onClick={() => {
                const next = view === 'trashed' ? 'active' : 'trashed';
                setView(next);
                if (next === 'trashed') loadTrashedProjects();
              }}
            >
              {view === 'trashed' ? '返回项目列表' : '回收站'}
            </Button>
          </div>
        </div>

        <DramaProjectList
          projects={view === 'trashed' ? trashedProjects : dramaProjects}
          trashed={view === 'trashed'}
          onCreateProject={() => setIsModalOpen(true)}
          onOpenProject={handleOpenProject}
          onOpenEdit={handleOpenEdit}
          onDeleteProject={handleDeleteProject}
          onRestoreProject={handleRestoreProject}
          onPurgeProject={handlePurgeProject}
          formatDate={formatDate}
        />
      </main>

      {/* 新建项目弹窗 */}
      <CreateProjectModal
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          setNewProjectName('');
          setCreationMode('script');
          setAspectRatio('9:16');
        }}
        creationMode={creationMode}
        handleModeChange={handleModeChange}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        newProjectName={newProjectName}
        setNewProjectName={setNewProjectName}
        handleCreateProject={handleCreateProject}
      />

      {/* 修改项目弹窗 */}
      <EditProjectModal
        editingProject={editingProject}
        onCancel={() => {
          setEditingProject(null);
          setEditProjectName('');
          setEditAspectRatio('9:16');
        }}
        editAspectRatio={editAspectRatio}
        setEditAspectRatio={setEditAspectRatio}
        editProjectName={editProjectName}
        setEditProjectName={setEditProjectName}
        handleSaveEdit={handleSaveEdit}
      />

      {/* 删除确认弹窗 */}
      <Modal
        title="删除项目"
        open={!!deletingId}
        onCancel={() => setDeletingId(null)}
        onOk={confirmDelete}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p className="text-text-secondary">
          确定要删除这个项目吗？删除后此项目将放入回收站，可随时恢复或彻底删除。
        </p>
      </Modal>
    </div>
  );
};
