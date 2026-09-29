# ShotLib — 开源 AI 短剧创作工作台

纯前端的 AI 短剧创作工具:在浏览器里完成 **剧本 → 审阅 → 分镜 → 资产图 → 首尾帧 → 视频** 的完整链路,以及画布式「即时创作」模式。无后端、无账号,你的 API Key 与全部数据只存在你自己的浏览器里。

> 内置两种创作模式:
> - **剧本模式**(5 步工作流):生成剧本 → 剧本审阅/修改 → 剧本分解(角色/场景/道具)→ 资产图生成 → 分镜片段与视频生成
> - **即时创作**(无限画布):场景卡片自由编排,角色/场景/分镜/视频即点即生成

## 功能特性

- 📝 **剧本生成与改编**:题材工艺库 + 事件分桶(防剧情提前泄露)+ 上集结尾状态(跨集连续性锚点)
- 🎭 **角色资产管理**:头像 / 三视图 / 形象照生成,按分集引用
- 🏞 **场景与道具**:多视角场景图、场景属性向导与随机灵感库
- 🎬 **分镜与视频**:AI 分镜 → 首尾帧生成 → 图生视频 / 首尾帧生视频 / 全能参考生视频,任务自动轮询与刷新恢复
- 🧩 **即时创作画布**:拖拽编排场景卡,分镜编辑器、镜头级首尾帧
- 🔑 **自带 Key**:支持 7 家厂商、文本/图片/视频/音乐共 20+ 个模型,前端统一编排
- 🛡 **数据本地化**:项目 / 分集 / 生成的图片全部存在浏览器 IndexedDB,支持 JSON 导出/导入

## 快速开始

```bash
# 要求 Node.js >= 20
npm install
npm run dev          # http://localhost:5173
npm run build        # 产出到 dist/
```

首次使用:进入任意创作页,点击右上角「设置」→ 填入你的 API Key。

## 配置 API Key

在 **设置 → API Key** 中填入你在对应厂商平台申请的密钥(仅保存在你的浏览器本地,不会上传到任何服务器):

| 厂商 | 用途 | 控制台入口 |
|---|---|---|
| 火山引擎(即梦/豆包) | 文本 / 图片 / 视频 | [火山方舟控制台](https://console.volcengine.com/ark) |
| 阿里云百炼 | 图片 / 视频 | [百炼控制台](https://bailian.console.aliyun.com/) |
| DeepSeek | 文本 | [开放平台](https://platform.deepseek.com/) |
| Moonshot(Kimi) | 文本 | [开放平台](https://platform.moonshot.cn/) |
| MiniMax | 文本 / 视频 | [开放平台](https://platform.minimaxi.com/) |
| Suno | 音乐(占位) | — |

> 模型清单与能力(时长上限 / 参考图 / 首尾帧等)内置于 `src/config/models/*.json`,可自行增删变体。

## 网络与代理(重要)

部分厂商接口**不允许浏览器跨域直连**(CORS 限制),典型如火山方舟、阿里云百炼、MiniMax;DeepSeek / Moonshot 可直接直连。对受限厂商,应用支持把请求经你自有的轻量代理转发:

### 方案 A:Cloudflare Worker(推荐,免费额度充足)

1. 登录 Cloudflare Dashboard → Workers & Pages → Create Worker
2. 粘贴 [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js) 全部内容,Deploy
3. (强烈建议)在 Worker 的 Settings → Variables 添加 `ACCESS_TOKEN`,开启简单鉴权
4. 应用「设置 → 网络」:填入 Worker 地址,并为对应厂商打开「走代理」

### 方案 B:本机 Node 代理(本地开发)

```bash
node proxy/node-proxy.mjs            # 默认监听 8787
# ACCESS_TOKEN=your-secret node proxy/node-proxy.mjs
```

应用「设置 → 网络」填入 `http://localhost:8787`。

### 各厂商默认建议

以 `src/config/models/*.json` 中的 `proxyDefault` 为准(当前:aliyun / minimaxi / volcengine 默认建议走代理,deepseek / moonshot 直连)。每个厂商都可以在设置中手动覆盖。

## 数据与隐私

- **不采集任何数据**:没有后端、没有埋点、没有账号体系。剧本、分集数据、生成的图片、API Key 全部存在你浏览器的 IndexedDB / localStorage 中。
- **AI 调用直达厂商**:浏览器把请求(携带你的 Key)直接发往(或经你自建代理转发)对应厂商接口,除此之外没有任何第三方经手。
- **请自行备份**:清理浏览器站点数据会清空全部项目。重要项目请定期使用「设置 → 数据管理」导出 JSON。
- 视频生成结果返回的是厂商对象存储的临时 URL,有效期由厂商决定,建议及时下载保存。

## 目录结构

```
├── proxy/                  # 可选轻量代理(CF Worker / Node 单文件)
├── src/
│   ├── ai/                 # AI 编排层:厂商 adapter、统一 SDK、视频任务轮询器
│   ├── config/             # 模型清单 / 提示词模板 / 预设数据(全部内置)
│   ├── modules/
│   │   ├── projects/       # 项目列表(两种模式互通)
│   │   ├── workflow/       # 剧本模式 5 步工作流
│   │   └── instant/        # 即时创作画布
│   ├── settings/           # 设置页(API Key / 网络 / 默认模型 / 数据管理)
│   ├── shared/             # 通用组件 / store / 工具
│   └── storage/            # IndexedDB 仓储层(项目/分集/图片/设置)
```

## 已知限制(相对内部完整版)

- ❌ 服务端视频合成(ffmpeg 拼接)、TTS 配音、智能扩图(需云厂商签名密钥)、剪映导出
- ❌ 多端云同步 / 团队协作;异步任务队列(改为浏览器端直连 + 前端轮询)
- ⚠️ 个别厂商视频接口仅接受公网参考图 URL 时,本地 blob 图片会以 data URL 传入,如遇厂商拒绝请改用支持 base64 的模型

## 开发

```bash
npx tsc --noEmit -p tsconfig.app.json   # 类型检查
npm run lint
npm run build
```

新增厂商 / 模型:在 `src/config/models/` 增加配置、`src/ai/providers/` 实现 adapter(参照现有 7 家),不改业务代码。

## License

[Apache-2.0](LICENSE)
