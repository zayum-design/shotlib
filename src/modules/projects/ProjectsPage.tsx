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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Segmented,
  Select, Space, Tabs, Tooltip, message,
} from 'antd';
import {
  Clapperboard, Film, Inbox, Pencil, RotateCcw, Settings as SettingsIcon,
  Trash2, Zap,
} from 'lucide-react';
import { useProjectStore } from '@/shared/stores/projectStore';
import type { AspectRatio, ProjectType } from '@/shared/types/project';

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '21:9', label: '21:9 宽幕' },
];

interface CreateFormValues {
  name: string;
  type: ProjectType;
  aspectRatio: AspectRatio;
}

/** 项目列表页:新建 / 重命名 / 回收站 / 彻底删除(纯本地数据) */
export default function ProjectsPage() {
  const navigate = useNavigate();
  const {
    projects, trashedProjects, isLoading,
    createProject, updateProject, deleteProject, restoreProject, purgeProject,
  } = useProjectStore();

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [renameForm] = Form.useForm<{ name: string }>();
  const [messageApi, contextHolder] = message.useMessage();

  const openCreate = (type: ProjectType = 'script') => {
    createForm.resetFields();
    createForm.setFieldsValue({ name: '', type, aspectRatio: '9:16' });
    setCreateOpen(true);
  };

  const handleCreate = async (values: CreateFormValues) => {
    try {
      const project = await createProject(values.name.trim(), 'drama', values.type, values.aspectRatio);
      messageApi.success('项目已创建');
      setCreateOpen(false);
      navigate(values.type === 'instant' ? `/instant/${project.id}` : `/workflow/${project.id}`);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '创建失败');
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const { name } = await renameForm.validateFields();
    try {
      await updateProject(renameTarget.id, { name: name.trim() });
      messageApi.success('已重命名');
      setRenameTarget(null);
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : '重命名失败');
    }
  };

  const renderGrid = (list: typeof projects, trashed = false) => (
    <Row gutter={[16, 16]}>
      {list.map((p) => (
        <Col key={p.id} xs={24} sm={12} md={8} lg={6}>
          <Card
            hoverable
            size="small"
            onClick={() => !trashed && navigate(p.type === 'instant' ? `/instant/${p.id}` : `/workflow/${p.id}`)}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {p.type === 'instant' ? (
                  <Zap size={16} style={{ color: 'var(--accent-warning)', flexShrink: 0 }} />
                ) : (
                  <Film size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                )}
                <span
                  style={{
                    color: 'var(--text-primary)', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title={p.name}
                >
                  {p.name}
                </span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, display: 'flex', gap: 8 }}>
                <span>{p.aspectRatio}</span>
                <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                {trashed ? (
                  <>
                    <Tooltip title="恢复">
                      <Button
                        type="text" size="small" icon={<RotateCcw size={14} />}
                        onClick={async () => {
                          await restoreProject(p.id);
                          messageApi.success('已恢复');
                        }}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="彻底删除该项目?"
                      description="项目数据与图片将被永久清除,不可恢复"
                      okButtonProps={{ danger: true }}
                      onConfirm={async () => {
                        await purgeProject(p.id);
                        messageApi.success('已彻底删除');
                      }}
                    >
                      <Tooltip title="彻底删除">
                        <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                      </Tooltip>
                    </Popconfirm>
                  </>
                ) : (
                  <>
                    <Tooltip title="重命名">
                      <Button
                        type="text" size="small" icon={<Pencil size={14} />}
                        onClick={() => {
                          setRenameTarget({ id: p.id, name: p.name });
                          renameForm.setFieldsValue({ name: p.name });
                        }}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除该项目?"
                      description="项目将移入回收站,可随时恢复"
                      onConfirm={async () => {
                        await deleteProject(p.id);
                        messageApi.success('已移入回收站');
                      }}
                    >
                      <Tooltip title="删除">
                        <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
                      </Tooltip>
                    </Popconfirm>
                  </>
                )}
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Clapperboard size={26} style={{ color: 'var(--accent-primary)' }} />
          <div>
            <h1 style={{ color: 'var(--text-primary)', fontSize: 22, margin: 0 }}>ShotLib</h1>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>AI 短剧创作工作台 · 数据保存在本地浏览器</span>
          </div>
        </div>
        <Space>
          <Button icon={<SettingsIcon size={14} />} onClick={() => navigate('/settings')}>设置</Button>
          <Button type="primary" onClick={() => openCreate('script')}>新建项目</Button>
        </Space>
      </div>

      <Tabs
        defaultActiveKey="active"
        items={[
          {
            key: 'active',
            label: `项目 (${projects.length})`,
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Segmented
                    options={[
                      { label: '剧本模式', value: 'script', icon: <Film size={14} /> },
                      { label: '即时创作', value: 'instant', icon: <Zap size={14} /> },
                    ]}
                    onChange={(v) => openCreate(v as ProjectType)}
                    value={null}
                  />
                </div>
                {isLoading ? null : projects.length === 0 ? (
                  <Empty
                    description={<span style={{ color: 'var(--text-secondary)' }}>还没有项目,点击「新建项目」开始创作</span>}
                    style={{ padding: '60px 0' }}
                  />
                ) : (
                  renderGrid(projects)
                )}
              </>
            ),
          },
          {
            key: 'trash',
            label: (
              <span><Inbox size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />回收站 ({trashedProjects.length})</span>
            ),
            children: trashedProjects.length === 0 ? (
              <Empty description={<span style={{ color: 'var(--text-secondary)' }}>回收站为空</span>} style={{ padding: '60px 0' }} />
            ) : (
              renderGrid(trashedProjects, true)
            ),
          },
        ]}
      />

      {/* 新建项目 */}
      <Modal
        title="新建项目"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如:都市逆袭之最强打工人" maxLength={50} />
          </Form.Item>
          <Form.Item name="type" label="创作模式">
            <Select
              options={[
                { value: 'script', label: '剧本模式 — 分步工作流:剧本 → 分解 → 片段 → 视频' },
                { value: 'instant', label: '即时创作 — 画布模式:场景卡片自由编排' },
              ]}
            />
          </Form.Item>
          <Form.Item name="aspectRatio" label="画面比例">
            <Select options={ASPECT_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重命名 */}
      <Modal
        title="重命名项目"
        open={!!renameTarget}
        onCancel={() => setRenameTarget(null)}
        onOk={handleRename}
        okText="保存"
        cancelText="取消"
        forceRender
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input maxLength={50} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
