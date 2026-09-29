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

import { useState } from 'react';
import { Drawer, Button, Card, Tag, Badge, Space, Input, Select, Tooltip, Empty, Tabs, Progress } from 'antd';
import { ChevronUp, ChevronDown, Trash2, Copy, Calendar, Clock, Search, AlertCircle, CheckCircle, Info, AlertTriangle, ListTodo, Loader2, X, RefreshCw, Terminal } from 'lucide-react';
import { useLogStore, type LogEntry, type LogLevel } from '../../stores/logStore';
import { useTaskQueueStore, type TaskEntry, type TaskStatus } from '../../stores/taskQueueStore';
import { motion } from 'framer-motion';

const levelColors: Record<LogLevel, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const levelIcons: Record<LogLevel, React.ReactNode> = {
  info: <Info size={14} />,
  success: <CheckCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  error: <AlertCircle size={14} />,
};

const levelColorClasses: Record<LogLevel, string> = {
  info: 'bg-blue-500/20 text-blue-500',
  success: 'bg-green-500/20 text-green-500',
  warning: 'bg-orange-500/20 text-orange-500',
  error: 'bg-red-500/20 text-red-500',
};

const taskStatusColors: Record<TaskStatus, string> = {
  pending: 'default',
  running: 'processing',
  polling: 'blue',
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
};

const taskStatusLabels: Record<TaskStatus, string> = {
  pending: '等待中',
  running: '执行中',
  polling: '轮询中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const taskTypeLabels: Record<string, string> = {
  'script-generate': '剧本生成',
  'script-parse': '剧本解析',
  'character-avatar': '角色头像',
  'character-views': '角色多视图',
  'character-fullbody': '角色全身图',
  'scene-image': '场景图像',
  'episode-generate': '片段生成',
  'episode-video': '片段视频',
  'first-frame': '首帧生成',
  'last-frame': '尾帧生成',
  'frame-expand': '首帧/尾帧扩图',
  'music-generate': '音乐生成',
  'mv2-script': 'MV2剧本',
  'mv2-asset-prompts': 'MV2资产提示词',
  'mv2-analyze-lyrics': 'MV2歌词分析',
  'mv2-avatar': 'MV2头像',
  'mv2-portrait': 'MV2形象照',
  'mv2-views': 'MV2多视图',
  'mv2-scene': 'MV2场景',
  'mv2-shot': 'MV2分镜图',
  'mv2-video': 'MV2视频',
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
};

// ==================== LogItem ====================

interface LogItemProps {
  log: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const LogItem: React.FC<LogItemProps> = ({ log, isExpanded, onToggle }) => {
  const levelColor = levelColors[log.level];
  const levelIcon = levelIcons[log.level];
  const levelColorClass = levelColorClasses[log.level];

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatJson = (obj: unknown): string => {
    if (!obj) return 'null';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className="bg-bg-secondary border-border mb-2 hover:border-border-active transition-all cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${levelColorClass}`}>
              {levelIcon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-medium text-text-primary truncate">{log.message}</span>
                <Tag color={levelColor} className="text-xs px-1.5 py-0.5">{log.level.toUpperCase()}</Tag>
                {log.vendor && <Tag color="geekblue" className="text-xs px-1.5 py-0.5">{log.vendor}</Tag>}
                {log.model && <Tag color="purple" className="text-xs px-1.5 py-0.5">{log.model}</Tag>}
                {log.duration && <Tag color="cyan" className="text-xs px-1.5 py-0.5">{log.duration}ms</Tag>}
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(log.timestamp)}</span>
                <span className="flex items-center gap-1"><Clock size={12} />{formatTime(log.timestamp)}</span>
                {log.source && <span className="bg-bg-tertiary px-2 py-0.5 rounded">{log.source}</span>}
                {log.method && <Tag color="blue" className="text-xs px-1.5 py-0.5">{log.method}</Tag>}
              </div>
            </div>
          </div>
          <Button type="text" size="small" icon={isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            className="text-text-muted hover:text-text-primary" onClick={(e) => { e.stopPropagation(); onToggle(); }} />
        </div>

        {isExpanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.2 }}
            className="mt-4 pt-4 border-t border-border">
            <div className="space-y-3">
              {!!log.url && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-secondary">URL</span>
                    <Tooltip title="复制URL"><Button type="text" size="small" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(log.url!); }} /></Tooltip>
                  </div>
                  <div className="text-sm text-text-primary font-mono bg-bg-tertiary p-2 rounded break-all">{log.method} {log.url}</div>
                </div>
              )}
              {!!log.request && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-secondary">请求数据</span>
                    <Tooltip title="复制JSON"><Button type="text" size="small" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(formatJson(log.request)); }} /></Tooltip>
                  </div>
                  <pre className="text-xs text-text-primary font-mono bg-bg-tertiary p-2 rounded overflow-auto whitespace-pre-wrap break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxHeight: 'none' }}>{formatJson(log.request)}</pre>
                </div>
              )}
              {!!log.response && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-secondary">响应数据</span>
                    <Tooltip title="复制JSON"><Button type="text" size="small" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(formatJson(log.response)); }} /></Tooltip>
                  </div>
                  <pre className="text-xs text-text-primary font-mono bg-bg-tertiary p-2 rounded overflow-auto whitespace-pre-wrap break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxHeight: 'none' }}>{formatJson(log.response)}</pre>
                </div>
              )}
              {!!log.rawResponse && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-secondary">原始模型响应</span>
                    <Tooltip title="复制JSON"><Button type="text" size="small" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(formatJson(log.rawResponse)); }} /></Tooltip>
                  </div>
                  <pre className="text-xs text-text-primary font-mono bg-bg-tertiary p-2 rounded overflow-auto whitespace-pre-wrap break-all" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxHeight: 'none' }}>{formatJson(log.rawResponse)}</pre>
                </div>
              )}
              {!!log.error && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-secondary">错误信息</span>
                    <Tooltip title="复制错误"><Button type="text" size="small" icon={<Copy size={12} />} onClick={(e) => { e.stopPropagation(); copyToClipboard(String(log.error)); }} /></Tooltip>
                  </div>
                  <div className="text-sm text-accent-error bg-accent-error/10 p-2 rounded">{String(log.error)}</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </Card>
    </motion.div>
  );
};

// ==================== TaskItem ====================

interface TaskItemProps {
  task: TaskEntry;
}

const TaskItem: React.FC<TaskItemProps> = ({ task }) => {
  const { removeTask } = useTaskQueueStore();
  const isActive = task.status === 'pending' || task.status === 'running' || task.status === 'polling';
  const duration = task.updatedAt - task.createdAt;

  return (
    <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className="bg-bg-secondary border-border mb-2 hover:border-border-active transition-all">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              isActive ? 'bg-accent-primary/20 text-accent-primary' : task.status === 'completed' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
            }`}>
              {isActive ? <Loader2 size={16} className="animate-spin" /> : task.status === 'completed' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-sm font-medium text-text-primary truncate">{task.name}</span>
                <Tag color={taskStatusColors[task.status]} className="text-xs px-1.5 py-0.5">{taskStatusLabels[task.status]}</Tag>
                <Tag color="purple" className="text-xs px-1.5 py-0.5">{taskTypeLabels[task.type] || task.type}</Tag>
              </div>
              <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                <span className="flex items-center gap-1"><Calendar size={12} />{formatDate(task.createdAt)} {formatTime(task.createdAt)}</span>
                {duration > 0 && <span className="flex items-center gap-1"><Clock size={12} />耗时 {formatDuration(duration)}</span>}
                <span className="bg-bg-tertiary px-2 py-0.5 rounded flex items-center gap-1">
                  <RefreshCw size={10} />
                  轮询 {task.pollCount} 次
                </span>
              </div>
              {typeof task.progress === 'number' && isActive && (
                <div className="mt-2">
                  <Progress percent={task.progress} size="small" status="active" strokeColor="#6366f1" />
                </div>
              )}
              {task.error && (
                <div className="mt-2 text-xs text-accent-error bg-accent-error/10 p-2 rounded">{task.error}</div>
              )}
            </div>
          </div>
          <Button type="text" size="small" icon={<X size={14} />} className="text-text-muted hover:text-text-primary"
            onClick={() => removeTask(task.id)} />
        </div>
      </Card>
    </motion.div>
  );
};

// ==================== LogTab ====================

const LogTab: React.FC = () => {
  const { logs, clearLogs } = useLogStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [vendorFilter, setVendorFilter] = useState<string>('all');

  const handleToggle = (id: string) => {
    const newExpandedIds = new Set(expandedIds);
    if (newExpandedIds.has(id)) newExpandedIds.delete(id);
    else newExpandedIds.add(id);
    setExpandedIds(newExpandedIds);
  };

  const filteredLogs = logs
    .filter((log) => {
      if (searchText) {
        const searchLower = searchText.toLowerCase();
        const matchesSearch =
          log.message.toLowerCase().includes(searchLower) ||
          (log.model && log.model.toLowerCase().includes(searchLower)) ||
          (log.vendor && log.vendor.toLowerCase().includes(searchLower)) ||
          (log.url && log.url.toLowerCase().includes(searchLower)) ||
          (log.source && log.source.toLowerCase().includes(searchLower));
        if (!matchesSearch) return false;
      }
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;
      if (methodFilter !== 'all' && log.method !== methodFilter) return false;
      if (vendorFilter !== 'all' && log.vendor !== vendorFilter) return false;
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const sources = Array.from(new Set(logs.map((log) => log.source)));
  const methods = Array.from(new Set(logs.map((log) => log.method).filter(Boolean)));
  const vendors = Array.from(new Set(logs.map((log) => log.vendor).filter(Boolean)));

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 p-3 bg-bg-secondary rounded-lg border border-border">
        <div className="flex items-center gap-3 flex-wrap">
          <Input placeholder="搜索日志..." prefix={<Search size={16} className="text-text-muted" />}
            value={searchText} onChange={(e) => setSearchText(e.target.value)} className="flex-1 max-w-xs bg-bg-tertiary border-border" size="small" />
          <Select value={levelFilter} onChange={setLevelFilter} className="w-28" size="small"
            options={[{ value: 'all', label: '全部级别' }, { value: 'info', label: '信息' }, { value: 'success', label: '成功' }, { value: 'warning', label: '警告' }, { value: 'error', label: '错误' }]} />
          <Select value={methodFilter} onChange={setMethodFilter} className="w-28" size="small"
            options={[{ value: 'all', label: '全部方法' }, ...methods.map((m) => ({ value: m, label: m }))]} />
          <Select value={vendorFilter} onChange={setVendorFilter} className="w-36" size="small"
            options={[{ value: 'all', label: '全部厂商' }, ...vendors.map((v) => ({ value: v, label: v }))]} />
          <Select value={sourceFilter} onChange={setSourceFilter} className="w-32" size="small"
            options={[{ value: 'all', label: '全部来源' }, ...sources.map((source) => ({ value: source, label: source }))]} />
          <div className="text-xs text-text-muted ml-auto">共 {filteredLogs.length} 条日志（总计 {logs.length} 条）</div>
        </div>
      </div>
      <div className="flex-1 overflow-auto pr-1">
        {filteredLogs.length === 0 ? (
          <Empty description={<div className="py-8"><div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-tertiary flex items-center justify-center"><AlertCircle size={32} className="text-text-muted" /></div><h4 className="text-text-primary mb-2">暂无日志</h4><p className="text-text-secondary text-sm">{logs.length === 0 ? '尚未记录任何AI模型请求' : '没有匹配的日志'}</p></div>} />
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log) => (
              <LogItem key={log.id} log={log} isExpanded={expandedIds.has(log.id)} onToggle={() => handleToggle(log.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== TaskQueueTab ====================

const TaskQueueTab: React.FC = () => {
  const { tasks, clearCompleted, clearAll } = useTaskQueueStore();
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filteredTasks = tasks
    .filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      if (typeFilter !== 'all' && task.type !== typeFilter) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeCount = tasks.filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'polling').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const taskTypes = Array.from(new Set(tasks.map((t) => t.type)));

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 p-3 bg-bg-secondary rounded-lg border border-border">
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={statusFilter} onChange={setStatusFilter} className="w-32" size="small"
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'pending', label: '等待中' },
              { value: 'running', label: '执行中' },
              { value: 'polling', label: '轮询中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '失败' },
            ]} />
          <Select value={typeFilter} onChange={setTypeFilter} className="w-36" size="small"
            options={[{ value: 'all', label: '全部类型' }, ...taskTypes.map((type) => ({ value: type, label: taskTypeLabels[type] || type }))]} />
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-text-muted">进行中: <span className="text-accent-primary font-medium">{activeCount}</span></span>
            <span className="text-xs text-text-muted">已完成: <span className="text-green-500 font-medium">{completedCount}</span></span>
            <span className="text-xs text-text-muted">失败: <span className="text-red-500 font-medium">{failedCount}</span></span>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto pr-1">
        {filteredTasks.length === 0 ? (
          <Empty description={<div className="py-8"><div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-tertiary flex items-center justify-center"><ListTodo size={32} className="text-text-muted" /></div><h4 className="text-text-primary mb-2">暂无任务</h4><p className="text-text-secondary text-sm">当前没有生成任务在队列中</p></div>} />
        ) : (
          <div className="space-y-1">
            {filteredTasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-xs text-text-muted">共 {tasks.length} 个任务</span>
        <Space>
          <Button type="text" size="small" danger disabled={completedCount === 0} onClick={clearCompleted}>清除已完成</Button>
          <Button type="text" size="small" danger disabled={tasks.length === 0} onClick={clearAll}>清除全部</Button>
        </Space>
      </div>
    </div>
  );
};

// ==================== LogPanel ====================

interface LogPanelProps {
  open?: boolean;
  onClose?: () => void;
  placement?: 'left' | 'right' | 'top' | 'bottom';
}

export const LogPanel: React.FC<LogPanelProps> = ({ open, onClose, placement = 'bottom' }) => {
  const { isLogPanelOpen, setLogPanelOpen } = useLogStore();
  const { isTaskPanelOpen, setTaskPanelOpen } = useTaskQueueStore();

  // 当外部控制 open 时，同步两个面板状态
  const isOpen = open !== undefined ? open : isLogPanelOpen || isTaskPanelOpen;
  const activeTab = isTaskPanelOpen && !isLogPanelOpen ? 'tasks' : 'logs';

  const handleClose = () => {
    setLogPanelOpen(false);
    setTaskPanelOpen(false);
    onClose?.();
  };

  const handleTabChange = (key: string) => {
    if (key === 'logs') {
      setLogPanelOpen(true);
      setTaskPanelOpen(false);
    } else {
      setLogPanelOpen(false);
      setTaskPanelOpen(true);
    }
  };

  const { tasks } = useTaskQueueStore();
  const activeTaskCount = tasks.filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'polling').length;
  const { logs } = useLogStore();

  return (
    <Drawer
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center">
            <Terminal size={18} className="text-accent-primary" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-text-primary">AI 请求与任务中心</h3>
            <p className="text-xs text-text-muted">查看模型请求日志和生成任务队列</p>
          </div>
        </div>
      }
      placement={placement}
      size={placement === 'left' || placement === 'right' ? 960 : '80%'}
      open={isOpen}
      onClose={handleClose}
      className="[&_.ant-drawer-content]:bg-bg-primary [&_.ant-drawer-wrapper-body]:bg-bg-primary [&_.ant-drawer-body]:bg-bg-primary [&_.ant-drawer-header]:bg-bg-secondary [&_.ant-drawer-title]:text-text-primary [&_.ant-drawer-close]:text-text-muted"
      extra={
        <Space>
          <Button type="text" danger icon={<Trash2 size={16} />} onClick={() => { useLogStore.getState().clearLogs(); useTaskQueueStore.getState().clearAll(); }}>
            清空全部
          </Button>
        </Space>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        className="h-full [&_.ant-tabs-content]:h-full [&_.ant-tabs-tabpane]:h-full"
        items={[
          {
            key: 'logs',
            label: (
              <span className="flex items-center gap-1">
                AI模型请求日志 <Badge count={logs.length} overflowCount={999} color="blue" />
              </span>
            ),
            children: <LogTab />,
          },
          {
            key: 'tasks',
            label: (
              <span className="flex items-center gap-1">
                生成任务队列 {activeTaskCount > 0 && <Badge count={activeTaskCount} color="red" />}
              </span>
            ),
            children: <TaskQueueTab />,
          },
        ]}
      />
    </Drawer>
  );
};
