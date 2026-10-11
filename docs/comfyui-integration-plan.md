# ShotLib 集成 ComfyUI 开发计划

> 目标:把自建 ComfyUI 服务器(Qwen-Image-2.1 文生图/图生图、MiniMax H3 文生视频/参考生视频)接入 ShotLib 的厂商体系,作为新的 provider 类型,复用现有的统一编排、任务轮询、请求日志、OSS 持久化能力。
>
> 起草:2026-10-11 · 适用基线:当前 master

## 0. 背景与可行性结论

| 项 | 现状 | 结论 |
|---|---|---|
| ComfyUI 服务器 | 自用算家云 4090 48G(地址不入库,ComfyUI 0.39.0,已开启 `--enable-cors-header`) | 纯前端可直接跨域调用 |
| 图片模型 | Qwen-Image-2.1 GGUF Q8_0,1024×1024 约 1~2 分钟 | 适合资产图/首尾帧 |
| 视频模型 | MiniMax H3(pruned int8 + nvfp4 TE),960×544 15 秒约 15~30 分钟 | 适合分镜视频,需长轮询 |
| ComfyUI API | `POST /prompt` 提交 → `GET /history/{id}` 查询 → `GET /view?filename=…` 取文件 | 与现有 `CLIENT_SIDE` 轮询模式完全同构 |
| 认证 | 目前无密码 | 阶段五补 token |

**核心思路**:ComfyUI 的一次生成 = 提交一份"工作流 JSON"。适配器把 ShotLib 的统一请求(提示词/尺寸/时长/种子)注入到内置的 API 格式工作流模板里提交,后续完全复用现有 task-runner。

## 1. 工作流模板约定(前置工作,不依赖前端)

内置 4 个 API 格式模板,放 `src/ai/providers/comfyui/workflows/`:

| 模板 | 用途 | 对应 ShotLib 模型 |
|---|---|---|
| `qwen-image-t2v.json` | Qwen 文生图 | 资产图、场景图、首帧 |
| `qwen-image-i2v.json` | Qwen 图生图/编辑 | 角色一致性、局部修改 |
| `h3-t2v.json` | H3 文生视频(含 sulphur 增强可选) | 文生视频分镜 |
| `h3-r2v.json` | H3 参考生视频(多图参考) | 首尾帧/全能参考生视频 |

**参数注入规则**(适配器按节点类型定位,不依赖节点 id):

```jsonc
{
  "inject": {
    "byNodeType": {
      "MiniMaxH3ImageToVideo": { "widget": { "prompt": "{{prompt}}", "width": "{{width}}", "height": "{{height}}", "frames": "{{frames}}" } },
      "KSampler":            { "widget": { "seed": "{{seed}}" } },
      "LoadImage":           { "widget": { "image": "{{uploaded_image}}" } }
    }
  }
}
```

- `{{frames}}` 由统一请求的 `duration` 换算:`frames = duration × 24`,取 4 的倍数(8s=192 / 10s=244 / 12s=292 / 15s=360)
- 分辨率按 ShotLib 的画幅选项映射到 32 倍数对照表(480p/540p/720p × 16:9/9:16/1:1)
- 种子:ShotLib 传 `seed`,ComfyUI 侧 `RandomNoise.noise_seed` 与 `KSampler.seed` 同步注入
- 参考图:ShotLib 生成的图片是 IndexedDB/OSS 里的 blob,提交前先 `PUT /upload/image`(ComfyUI 原生上传接口)拿到文件名,再注入 `LoadImage`

模板维护:先用 ComfyUI 网页调好 → Export (API Format) → 替换文件即可,不改代码。

## 2. 代码改造点(按现有分层落位)

### 2.1 新增 provider 目录 `src/ai/providers/comfyui/`

```
comfyui/
├── comfyui-image.adapter.ts      # 文生图/图生图(同步返回,或短任务)
├── comfyui-video.adapter.ts      # 视频(CLIENT_SIDE 轮询)
├── comfyui-prompt.transformer.ts # 统一请求 → 工作流 JSON 注入
├── comfyui-error.parser.ts       # 解析 4xx / queue full / CUDA OOM / 节点缺失
├── comfyui-workflow-loader.ts    # 模板加载 + 占位符注入引擎
└── workflows/                    # 4 个 API 格式模板 JSON
```

### 2.2 对接现有核心(`src/ai/core/`)

| 文件 | 改动 |
|---|---|
| `adapter-factory.ts` | 注册 `comfyui` provider 类型 |
| `model-registry.ts` | 新增 4 个模型条目:`qwen-image-t2i` / `qwen-image-edit` / `minimax-h3-t2v` / `minimax-h3-r2v`,`pollingMode: 'client_side'`(视频) |
| `task-runner.ts` | 无需改动:ComfyUI 的 `prompt_id` 就是 `taskId`,`/history/{id}` 就是查询接口;**只需把轮询间隔做成按模型配置**(视频 10s、图片 3s),超时上限放宽到 3600s |
| `media.ts` | 新增 `downloadComfyUIView(url)` → blob → 走现有 OSS 上传/IndexedDB 管线(`/view` 返回的 blob 统一按现有图片/视频入库流程处理) |

### 2.3 配置与设置页(`src/settings/`)

- 厂商 Key 管理面板新增 **ComfyUI** 卡片:只填两项——
  - `服务器地址`(默认留空,示例 `http://127.0.0.1:8188`;真实地址不入库)
  - `访问令牌`(预留,阶段五启用;先留空)
- 连通性测试按钮:`GET /system_stats` 通即显示"已连接(ComfyUI x.x.x)"

### 2.4 请求日志面板

现有面板无需改动——adapter 统一走 `client.ts`,方法/路径/耗时/请求体(工作流 JSON)/响应自动入日志。建议把提交的工作流 JSON 里 base64/超长字段截断显示。

## 3. 关键流程时序

```
[文生图]
UI → adapter.transformRequest(统一请求)
   → workflow-loader 注入 prompt/width/height/seed 到 qwen-image-t2v.json
   → POST /prompt {prompt} → {prompt_id}
   → task-runner 轮询 GET /history/{prompt_id}(3s)
   → status.completed → outputs[0].images[0]
   → GET /view?filename=…&type=output → blob
   → 现有管线:OSS 上传 → IndexedDB 存引用 → UI 展示

[文生视频](CLIENT_SIDE,复用视频模型既有交互)
UI → 注入 prompt/width/height/frames/seed 到 h3-t2v.json
   → POST /prompt → {prompt_id} 作为 taskId
   → 轮询 /history/{prompt_id}(10s,上限 3600s)
   → outputs 里 type=output 的视频文件(经 CreateVideo/SaveVideo 节点合成)
   → /view 下载 → blob → OSS/IndexedDB
   → 页面刷新后按 taskId 从 history 恢复(现有"刷新恢复"能力直接生效)
```

**注意**:ComfyUI 0.39 的 history 持久化在 `user/comfyui.db`,服务器重启后任务记录仍在,长视频生成中刷新页面/断网重连都能恢复,与 ShotLib 现有的任务恢复机制互补。

## 4. 实施阶段与验收

### 阶段一:模板与注入引擎(0.5 天) ✅ 2026-10-11 完成
- [x] 用网页导出 4 个 API 格式模板,放入 `workflows/`(`qwen-image-t2i` / `qwen-image-edit` / `h3-t2v` / `h3-fl2v`)
- [x] 实现 `workflow-loader.ts`:模板加载、`__TOKEN__` 占位符注入、数值类型转换、注入后校验(残留占位符即抛错)
- [x] 纯函数冒烟测试:4 模板 × 注入 → 24 项断言全部通过;两个图片/视频模板已对新服务器(0.39.0)实测 `/prompt` 提交,`node_errors` 为空

**验收**:`npm run cli` 或单测里能对模板成功注入参数。✅(冒烟脚本 24/24;服务器端节点校验通过)

### 阶段二:图片链路(1 天) ✅ 代码完成,出图待实测
- [x] `comfyui-image.adapter.ts` + error parser + factory/model-registry 注册
- [x] `/view` 下载 → blob → 现有入库管线(适配器返回 `/view` 地址,与云厂商 URL 同走 `createImageAssets`)
- [x] 设置页 ComfyUI 卡片 + 连通性测试(`GET /system_stats`,显示版本与 GPU 数)
- [ ] 端到端:资产图/场景图/首帧各生成一张,日志面板可见完整请求链(提交链路已实测,完整出图待跑)

**验收**:剧本模式第 3、4 步能选 ComfyUI 模型并出图,刷新后图片仍在。⏳

### 阶段三:视频链路(1~1.5 天) ✅ 代码完成,长任务待实测
- [x] `comfyui-video.adapter.ts`(CLIENT_SIDE 轮询:`submit()` 返回 prompt_id,`query()` 映射 history 状态)
- [x] `duration→frames`(H3 网格 17k+5,夹取 [124, 362])、画幅→分辨率映射表(32 倍数)
- [x] 参考图上传:`POST /upload/image` + 文件名注入 `LoadImage`(h3-fl2v 双图)
- [ ] 长任务验证:15 秒视频全流程,生成中刷新页面能恢复进度

**验收**:分镜视频用 ComfyUI 模型生成成功;请求日志里轮询记录合并显示(与现有视频厂商行为一致)。⏳

### 阶段四:体验增强(1 天,可拆后续迭代)
- [ ] 生成进度百分比:接 ComfyUI WebSocket `/ws`(value 字段里有 step/total),task-runner 增加 `onProgress` 回调透传到现有进度条
- [ ] sulphur 无审查提示词增强作为可选项(模板里带 VisionLLMNode 的版本,配置开关切换两套模板)
- [ ] 批量生成时的队列行为:ComfyUI 单队列顺序执行,批量提交后 UI 显示"排队中 N/M"
- [ ] 爆显存前置提示:按 分辨率×帧数 查表,超限弹确认

### 阶段五:安全与工程化(0.5~1 天)
- [ ] ComfyUI 侧加认证(二选一):启动参数 `--web-user/--web-pass`,或 nginx basic auth;adapter 的 `访问令牌` 配置改为发 `Authorization` 头
- [ ] 服务器地址校验(仅允许 http(s),禁止 file/内网裸 IP 提示)
- [ ] 文档:`docs/comfyui-server-setup.md`(服务器部署/开机自启 tmux/模型清单),README 特性列表补 ComfyUI
- [ ] 开源合规:工作流模板基于 Comfy-Org/Abiray 模型,在模板目录附 `MODEL-LICENSES.md` 注明来源与许可证

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 无密码地址泄露 = 白嫖 GPU | 阶段五前仅自用;地址不进代码仓库默认值(配置项留空,文档只在自己环境写) |
| 15~30 分钟长任务,浏览器关闭即断 | 任务记录存 IndexedDB + ComfyUI history 持久化,重开页面按 taskId 恢复(现有机制) |
| 服务器重启导致 WebSocket 进度中断 | 轮询仍是兜底,history 恢复不受影响 |
| ComfyUI 队列满(并发 1) | error parser 识别 `queue full` → 现有重试/排队 UI |
| OOM(分辨率×帧数超 48G) | 阶段四的显存预估表 + error parser 识别 `CUDA out of memory` 给出"降帧数/降分辨率"建议 |
| 模板与服务器节点版本不匹配 | 注入前校验节点类型存在,缺失时给出"ComfyUI/节点需更新"的明确报错 |
| 跨域 | 已开 `--enable-cors-header`;若用户自建服务器忘开,连通性测试给出提示 |

## 6. 工作量估计

| 阶段 | 工时 |
|---|---|
| 一(模板+注入引擎) | 0.5 天 |
| 二(图片链路) | 1 天 |
| 三(视频链路) | 1~1.5 天 |
| 四(体验增强) | 1 天(可迭代) |
| 五(安全+文档) | 0.5~1 天 |
| **合计** | **约 4~5 天**(阶段一~三为核心,2.5~3 天可上线最小可用版) |
