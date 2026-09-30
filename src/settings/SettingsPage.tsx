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
 * 设置页:API Key 管理 / 代理配置 / 默认模型 / 数据管理
 *
 * - API Key 仅存浏览器 IndexedDB(settingsRepo),永不上传
 * - 代理:全局 URL + 每厂商直连/代理开关(厂商有默认建议,用户可覆盖)
 * - 数据:项目导出(JSON,图片内联)/ 导入 / 彻底删除 / 清空全部 / 存储用量
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeft,
  Cloud,
  Database,
  Download,
  Eraser,
  ExternalLink,
  Import,
  KeyRound,
  RotateCcw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createAdapter } from '@/ai/core/adapter-factory';
import { buildProxyUrl } from '@/ai/core/client';
import {
  getAllProviderConfigs,
  getModelsByType,
  getProviderProxyDefault,
  type ModelInfo,
  type ProviderConfig,
} from '@/ai/core/model-registry';
import { exportProject, importProject } from '@/storage/exportImport';
import { idbClearAll, localApi, settingsRepo } from '@/storage';
import type { ProxyMode, AppSettings } from '@/storage/settingsRepo';
import type { Project } from '@/storage/types';

/** 项目列表项:updated_at 是 snake_case(实体形状) */
type ProjectRow = Project;

const { Text, Title } = Typography;

/** 变体统计文案:按类型分组展示启用数量 */
function summarizeVariants(config: ProviderConfig): string {
  const counts: Record<string, number> = {};
  for (const v of config.variants || []) {
    if (v.enabled === false) continue;
    counts[v.type] = (counts[v.type] || 0) + 1;
  }
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    video: '视频',
    music: '音乐',
    voice: '语音',
  };
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${labels[t] || t} ×${n}`);
  return parts.length ? parts.join(' · ') : '无启用模型';
}

// ---------- API Key 区块 ----------

/** 单厂商 Key 卡片 */
function ProviderKeyCard({ config }: { config: ProviderConfig }) {
  const { message } = AntdApp.useApp();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testMsg, setTestMsg] = useState('');

  // 文本适配器存在才提供测试(用最小文本请求验证 Key 真实有效)
  const textAdapter = useMemo(
    () =>
      createAdapter(config.id, 'text') as
        | { process(req: import('@/ai/core/types').UnifiedModelRequest): Promise<unknown> }
        | undefined,
    [config.id],
  );
  const firstTextVariant = useMemo(
    () => (config.variants || []).find((v) => v.enabled !== false && v.type === 'text'),
    [config],
  );

  useEffect(() => {
    let alive = true;
    settingsRepo.getApiKey(config.id).then((key) => {
      if (alive) setValue(key);
    });
    return () => {
      alive = false;
    };
  }, [config.id]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await settingsRepo.setApiKey(config.id, value.trim());
      message.success(`已保存 ${config.name} API Key`);
      setTestResult(null);
    } finally {
      setSaving(false);
    }
  }, [config.id, config.name, value, message]);

  const handleTest = useCallback(async () => {
    const key = value.trim();
    if (!key) {
      message.warning('请先填写 API Key');
      return;
    }
    if (!textAdapter || !firstTextVariant) return;
    setTesting(true);
    setTestResult(null);
    try {
      await settingsRepo.setApiKey(config.id, key);
      await textAdapter.process({
        modelId: firstTextVariant.id,
        taskType: 'text',
        operation: 'generate',
        input: { text: '你好' },
        parameters: { maxTokens: 8 },
        options: { timeout: 30000 },
      });
      setTestResult('ok');
    } catch (error) {
      setTestResult('fail');
      setTestMsg((error as Error).message || '测试失败');
    } finally {
      setTesting(false);
    }
  }, [config.id, value, textAdapter, firstTextVariant, message]);

  return (
    <Card size="small" styles={{ body: { padding: '12px 16px' } }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Space size={8} wrap>
            <Text strong>{config.name}</Text>
            <Text type="secondary" className="text-xs">{summarizeVariants(config)}</Text>
            {testResult === 'ok' && <Tag color="success" bordered={false}>Key 有效</Tag>}
          </Space>
          {config.description && (
            <div>
              <Text type="secondary" className="text-xs">{config.description}</Text>
            </div>
          )}
        </div>
        {config.apiDocUrl && (
          <a
            href={config.apiDocUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            <Space size={2}>控制台获取 Key <ExternalLink size={12} /></Space>
          </a>
        )}
      </div>
      <Space.Compact className="mt-2 w-full max-w-xl">
        <Input.Password
          placeholder={`填写 ${config.name} API Key`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <Button
          type="primary"
          ghost
          icon={<Save size={14} />}
          loading={saving}
          onClick={handleSave}
        >
          保存
        </Button>
        {textAdapter && firstTextVariant && (
          <Button icon={<Zap size={14} />} loading={testing} onClick={handleTest}>
            测试
          </Button>
        )}
      </Space.Compact>
      {testResult === 'fail' && (
        <div className="mt-2">
          <Text type="danger" className="text-xs break-all">{testMsg}</Text>
        </div>
      )}
    </Card>
  );
}

function ApiKeySection() {
  const providers = useMemo(() => getAllProviderConfigs(), []);
  return (
    <Card
      title={<Space size={8}><KeyRound size={16} /> API Key 管理</Space>}
      extra={
        <Text type="secondary" className="text-xs">
          Key 仅保存在本机浏览器,不上传任何服务器
        </Text>
      }
    >
      <div className="flex flex-col gap-3">
        {providers.map((config) => (
          <ProviderKeyCard key={config.id} config={config} />
        ))}
      </div>
    </Card>
  );
}

// ---------- 代理区块 ----------

function ProxySection() {
  const { message } = AntdApp.useApp();
  const [proxyUrl, setProxyUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [modes, setModes] = useState<Record<string, ProxyMode>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    let alive = true;
    settingsRepo.get().then((s) => {
      if (!alive) return;
      setProxyUrl(s.proxyUrl);
      setSavedUrl(s.proxyUrl);
      setModes(s.providerProxyMode || {});
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleSaveUrl = useCallback(async () => {
    setSaving(true);
    try {
      const url = proxyUrl.trim();
      await settingsRepo.save({ proxyUrl: url });
      setSavedUrl(url);
      setTestResult(null);
      message.success('代理地址已保存');
    } finally {
      setSaving(false);
    }
  }, [proxyUrl, message]);

  /** 代理连通性测试:经代理请求一个厂商域名,收到任何 HTTP 响应即视为通 */
  const handleTestProxy = useCallback(async () => {
    if (!savedUrl) {
      message.warning('请先保存代理地址');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const target = buildProxyUrl(savedUrl, 'https://api.deepseek.com');
      const resp = await fetch(target, { method: 'GET' });
      // 404/405 也说明代理可达(厂商根路径本身没有 GET 资源)
      setTestResult('ok');
      setTestMsg(`代理可达(HTTP ${resp.status})`);
    } catch (error) {
      setTestResult('fail');
      setTestMsg((error as Error).message || '代理不可达');
    } finally {
      setTesting(false);
    }
  }, [savedUrl, message]);

  /** 当前实际生效模式:用户覆盖 > 厂商默认建议(且需已配置代理地址) */
  const currentMode = useCallback(
    (providerId: string) => {
      const override = modes[providerId];
      if (override === 'proxy') return true;
      if (override === 'direct') return false;
      return getProviderProxyDefault(providerId) && !!savedUrl;
    },
    [modes, savedUrl],
  );

  const handleModeChange = useCallback(
    async (providerId: string, useProxy: boolean) => {
      const next = {
        ...modes,
        [providerId]: (useProxy ? 'proxy' : 'direct') as ProxyMode,
      };
      setModes(next);
      await settingsRepo.save({ providerProxyMode: next });
    },
    [modes],
  );

  const handleResetMode = useCallback(
    async (providerId: string) => {
      const next = { ...modes };
      delete next[providerId];
      setModes(next);
      await settingsRepo.save({ providerProxyMode: next });
    },
    [modes],
  );

  const providers = useMemo(() => getAllProviderConfigs(), []);

  return (
    <Card title={<Space size={8}><Cloud size={16} /> 代理配置</Space>}>
      <Alert
        type="info"
        showIcon
        className="mb-3"
        message="部分厂商接口不允许浏览器跨域直连,需经轻量代理转发(部署说明见项目 README);其余厂商可直连。"
      />
      <Space.Compact className="w-full max-w-xl">
        <Input
          placeholder="代理地址(如 https://your-worker.workers.dev)"
          value={proxyUrl}
          onChange={(e) => setProxyUrl(e.target.value)}
        />
        <Button
          type="primary"
          ghost
          icon={<Save size={14} />}
          loading={saving}
          onClick={handleSaveUrl}
        >
          保存
        </Button>
        <Button icon={<Zap size={14} />} loading={testing} onClick={handleTestProxy}>
          测试
        </Button>
      </Space.Compact>
      {testResult === 'ok' && (
        <div className="mt-2">
          <Text type="secondary" className="text-xs">{testMsg}</Text>
        </div>
      )}
      {testResult === 'fail' && (
        <div className="mt-2">
          <Text type="danger" className="text-xs">{testMsg}</Text>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {providers.map((config) => {
          const providerDefault = getProviderProxyDefault(config.id);
          const hasOverride = modes[config.id] !== undefined;
          return (
            <div
              key={config.id}
              className="flex items-center justify-between gap-3 flex-wrap rounded border border-current/10 px-3 py-2"
            >
              <Space size={8} wrap>
                <Text strong className="text-sm">{config.name}</Text>
                <Tag bordered={false} color={providerDefault ? 'orange' : 'default'}>
                  默认建议:{providerDefault ? '代理' : '直连'}
                </Tag>
                {hasOverride && (
                  <Tooltip title="恢复厂商默认建议">
                    <Button
                      type="text"
                      size="small"
                      icon={<RotateCcw size={12} />}
                      onClick={() => handleResetMode(config.id)}
                    />
                  </Tooltip>
                )}
              </Space>
              <Space size={8}>
                <Text type="secondary" className="text-xs">直连</Text>
                <Switch
                  size="small"
                  checked={currentMode(config.id)}
                  disabled={!savedUrl}
                  onChange={(checked) => handleModeChange(config.id, checked)}
                />
                <Text type="secondary" className="text-xs">代理</Text>
              </Space>
            </div>
          );
        })}
      </div>
      {!savedUrl && (
        <div className="mt-2">
          <Text type="secondary" className="text-xs">
            未配置代理地址时,所有厂商均直连。
          </Text>
        </div>
      )}
    </Card>
  );
}

// ---------- 默认模型区块 ----------

function DefaultModelsSection() {
  const [defaults, setDefaults] = useState<AppSettings['defaultModels']>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    settingsRepo.get().then((s) => {
      if (!alive) return;
      setDefaults(s.defaultModels || {});
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleChange = useCallback(
    async (key: 'text' | 'image' | 'video', value?: string) => {
      const next = { ...defaults };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      setDefaults(next);
      await settingsRepo.save({ defaultModels: next });
    },
    [defaults],
  );

  const modelOptions = useCallback(
    (models: ModelInfo[]) =>
      models.map((m) => ({
        value: m.id,
        label: `${m.name}(${m.provider || ''})`,
      })),
    [],
  );

  const textModels = useMemo(() => getModelsByType('text'), []);
  const imageModels = useMemo(() => getModelsByType('image'), []);
  const videoModels = useMemo(() => getModelsByType('video'), []);

  if (!loaded) return null;

  return (
    <Card
      title="默认模型"
      extra={<Text type="secondary" className="text-xs">未显式指定模型时的全局回退</Text>}
    >
      <div className="flex flex-col gap-3 max-w-xl">
        <div className="flex items-center gap-3">
          <Text className="w-16 shrink-0">文本</Text>
          <Select
            className="flex-1"
            allowClear
            placeholder="选择默认文本模型"
            options={modelOptions(textModels)}
            value={defaults.text}
            onChange={(v) => handleChange('text', v)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-16 shrink-0">图片</Text>
          <Select
            className="flex-1"
            allowClear
            placeholder="选择默认图片模型"
            options={modelOptions(imageModels)}
            value={defaults.image}
            onChange={(v) => handleChange('image', v)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-16 shrink-0">视频</Text>
          <Select
            className="flex-1"
            allowClear
            placeholder="选择默认视频模型"
            options={modelOptions(videoModels)}
            value={defaults.video}
            onChange={(v) => handleChange('video', v)}
          />
        </div>
      </div>
    </Card>
  );
}

// ---------- 对象存储(OSS)区块 ----------

function OssSection() {
  const { message } = AntdApp.useApp();
  const [oss, setOss] = useState<AppSettings['oss']>();
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let alive = true;
    settingsRepo.get().then((s) => {
      if (!alive) return;
      setOss(s.oss);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    async (patch: Partial<NonNullable<AppSettings['oss']>>) => {
      const next = { provider: 'aliyun' as const, bucket: '', region: '', accessKeyId: '', accessKeySecret: '', ...oss, ...patch };
      setOss(next);
      await settingsRepo.save({ oss: next });
    },
    [oss],
  );

  /** 连通性测试:上传一个 1x1 PNG 并立即删除,验证凭证/权限/公共读 */
  const handleTest = useCallback(async () => {
    if (!oss?.bucket || !oss.accessKeyId || !oss.accessKeySecret) {
      message.warning('请先填写 Bucket / AccessKeyId / AccessKeySecret');
      return;
    }
    setTesting(true);
    try {
      const { uploadBlobToOss } = await import('@/ai/services/oss-upload.service');
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const testId = `oss-test-${Date.now()}`;
      const url = await uploadBlobToOss(blob, oss as NonNullable<AppSettings['oss']>, 'shotlib/_test', testId);
      message.success(`OSS 连通正常:${url}`);
    } catch (e) {
      message.error(`OSS 测试失败:${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }, [oss, message]);

  if (!loaded) return null;
  const enabled = !!oss?.bucket && !!oss?.accessKeyId && !!oss?.accessKeySecret;

  return (
    <Card
      title="对象存储(OSS)"
      extra={
        <Space>
          <Button size="small" loading={testing} onClick={handleTest}>测试连接</Button>
          <Text type="secondary" className="text-xs">生成图片立即上传</Text>
        </Space>
      }
    >
      <div className="flex flex-col gap-3 max-w-xl">
        <Text type="secondary" className="text-xs">
          配置后,生成的图片立即上传 OSS 并以持久公网 URL 进入业务数据,解决厂商产物 URL 过期(如火山 TOS 24h)
          导致后续视频生成参考图失效的问题。要求 Bucket 为<b>公共读</b>;上传请求自动经「代理地址」转发,无需为 OSS 单独配 CORS。
        </Text>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">服务商</Text>
          <Select
            className="flex-1"
            value={oss?.provider || 'aliyun'}
            options={[{ value: 'aliyun', label: '阿里云 OSS' }, { value: 'amazon', label: 'S3 兼容(预留)' }]}
            onChange={(v) => update({ provider: v })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">Bucket</Text>
          <Input
            placeholder="如 files-shotlib(公共读)"
            value={oss?.bucket}
            onChange={(e) => update({ bucket: e.target.value.trim() })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">Region</Text>
          <Input
            placeholder="如 oss-cn-beijing"
            value={oss?.region}
            onChange={(e) => update({ region: e.target.value.trim() })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">AccessKeyId</Text>
          <Input
            placeholder="RAM 访问密钥 ID"
            value={oss?.accessKeyId}
            onChange={(e) => update({ accessKeyId: e.target.value.trim() })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">AccessKeySecret</Text>
          <Input.Password
            placeholder="RAM 访问密钥 Secret(仅存本机)"
            value={oss?.accessKeySecret}
            onChange={(e) => update({ accessKeySecret: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3">
          <Text className="w-24 shrink-0">自定义域名</Text>
          <Input
            placeholder="可选,公共访问基址/CDN(如 https://cdn.example.com)"
            value={oss?.publicBaseUrl}
            onChange={(e) => update({ publicBaseUrl: e.target.value.trim() || undefined })}
          />
        </div>
        <Text type={enabled ? 'success' : 'secondary'} className="text-xs">
          {enabled ? '✓ 已启用:生成图片将立即上传' : '未配置完整:生成图片仅存浏览器本地(厂商 URL 会过期)'}
        </Text>
      </div>
    </Card>
  );
}

// ---------- 提交模型预览 dialog 开关 ----------

function PreviewDialogSection() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    settingsRepo.get().then((s) => {
      if (!alive) return;
      setEnabled(s.showPreviewRequestDialog === true);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleChange = useCallback(async (checked: boolean) => {
    setEnabled(checked);
    await settingsRepo.save({ showPreviewRequestDialog: checked });
  }, []);

  if (!loaded) return null;

  return (
    <Card title="提交模型预览" extra={<Text type="secondary" className="text-xs">调试选项</Text>}>
      <div className="flex items-center justify-between max-w-xl">
        <div>
          <Text className="block">提交模型前显示请求 JSON 预览 dialog</Text>
          <Text type="secondary" className="text-xs">开启后，每次调用模型前会先弹出 JSON 预览确认；关闭则直接提交。</Text>
        </div>
        <Switch checked={enabled} onChange={handleChange} />
      </div>
    </Card>
  );
}

// ---------- 数据管理区块 ----------

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function DataSection() {
  const { message, modal } = AntdApp.useApp();
  const [activeProjects, setActiveProjects] = useState<ProjectRow[]>([]);
  const [trashedProjects, setTrashedProjects] = useState<ProjectRow[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const [active, trashed] = await Promise.all([
      localApi.getProjects('active'),
      localApi.getProjects('trashed'),
    ]);
    setActiveProjects(active.data || []);
    setTrashedProjects(trashed.data || []);
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      setUsage({ used: est.usage || 0, quota: est.quota || 0 });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 导出项目为 JSON 文件下载(图片以 base64 内联) */
  const handleExport = useCallback(
    async (project: ProjectRow) => {
      setExporting(project.id);
      try {
        const bundle = await exportProject(project.id);
        const blob = new Blob([JSON.stringify(bundle, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `shotlib-${project.name}-${date}.json`;
        a.click();
        URL.revokeObjectURL(url);
        message.success(`已导出「${project.name}」`);
      } catch (error) {
        message.error(`导出失败:${(error as Error).message}`);
      } finally {
        setExporting(null);
      }
    },
    [message],
  );

  const handleImport = useCallback(
    async (file: File) => {
      setImporting(true);
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        const result = await importProject(bundle);
        if (result.success) {
          message.success('导入成功,已生成新项目');
          await refresh();
        } else {
          message.error(result.message || '导入失败');
        }
      } catch (error) {
        message.error(`导入失败:${(error as Error).message}`);
      } finally {
        setImporting(false);
      }
    },
    [message, refresh],
  );

  const handlePurge = useCallback(
    async (project: ProjectRow) => {
      await localApi.purgeProject(project.id);
      message.success(`已彻底删除「${project.name}」`);
      await refresh();
    },
    [message, refresh],
  );

  const handleClearAll = useCallback(async () => {
    await idbClearAll();
    message.success('已清空全部本地数据(含设置)');
    await refresh();
  }, [message, refresh]);

  const percent =
    usage && usage.quota > 0 ? Math.round((usage.used / usage.quota) * 1000) / 10 : 0;

  const renderProjectRow = (project: ProjectRow, trashed: boolean) => (
    <div
      key={project.id}
      className="flex items-center justify-between gap-3 flex-wrap rounded border border-current/10 px-3 py-2"
    >
      <div className="min-w-0">
        <Text strong className="text-sm">{project.name}</Text>
        <Text type="secondary" className="text-xs ml-2">
          更新于 {new Date(project.updated_at).toLocaleString()}
        </Text>
      </div>
      <Space size={4}>
        {trashed && (
          <Button
            size="small"
            onClick={async () => {
              await localApi.restoreProject(project.id);
              message.success(`已恢复「${project.name}」`);
              await refresh();
            }}
          >
            恢复
          </Button>
        )}
        <Button
          size="small"
          icon={<Download size={13} />}
          loading={exporting === project.id}
          onClick={() => handleExport(project)}
        >
          导出
        </Button>
        <Popconfirm
          title="彻底删除该项目及其全部数据?"
          description="删除后无法恢复(回收站中也将移除)"
          okButtonProps={{ danger: true }}
          onConfirm={() => handlePurge(project)}
        >
          <Button size="small" danger icon={<Trash2 size={13} />}>
            删除
          </Button>
        </Popconfirm>
      </Space>
    </div>
  );

  return (
    <Card title={<Space size={8}><Database size={16} /> 数据管理</Space>}>
      {usage && (
        <div className="mb-4 max-w-xl">
          <div className="flex items-center justify-between mb-1">
            <Text type="secondary" className="text-xs">浏览器存储用量</Text>
            <Text type="secondary" className="text-xs">
              {formatBytes(usage.used)} / {formatBytes(usage.quota)}
            </Text>
          </div>
          <Progress percent={percent} size="small" showInfo={false} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {activeProjects.length === 0 && trashedProjects.length === 0 ? (
          <Empty description="暂无项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            {activeProjects.map((p) => renderProjectRow(p, false))}
            {trashedProjects.length > 0 && (
              <Text type="secondary" className="text-xs mt-2">回收站</Text>
            )}
            {trashedProjects.map((p) => renderProjectRow(p, true))}
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <label>
          <Button icon={<Import size={14} />} loading={importing}>
            导入项目 JSON
          </Button>
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </label>
        <Button
          danger
          icon={<Eraser size={14} />}
          onClick={() => {
            modal.confirm({
              title: '清空全部本地数据?',
              content: '将删除所有项目、图片与设置(API Key),不可恢复。请先导出需要保留的项目。',
              okText: '全部清空',
              okButtonProps: { danger: true },
              onOk: handleClearAll,
            });
          }}
        >
          清空全部数据
        </Button>
      </div>
    </Card>
  );
}

// ---------- 页面主体 ----------

export default function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    settingsRepo.get().finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Space className="mb-4">
          <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
            返回
          </Button>
          <Title level={4} className="!mb-0">设置</Title>
          {loading && <Spin size="small" />}
        </Space>
        <div className="flex flex-col gap-5">
          <ApiKeySection />
          <ProxySection />
          <DefaultModelsSection />
          <OssSection />
          <PreviewDialogSection />
          <DataSection />
        </div>
        <div className="mt-6 flex items-center gap-2">
          <Text type="secondary" className="text-xs">
            所有数据(项目、图片、Key)仅保存在本机浏览器,导出 JSON 即为完整备份。
          </Text>
        </div>
      </div>
    </div>
  );
}
