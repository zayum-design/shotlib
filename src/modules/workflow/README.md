# Drama Workflow 模块架构文档

## 一、概述

Drama Workflow 是短剧创作的核心工作流模块，覆盖从**剧本输入 → 剧本编辑 → 剧本分解 → 片段生成 → 视频合成**的完整创作链路。支持多集连载模式，第1集走完整的4步标准流程，第2集+走简化续写流程。

---

## 二、功能设计

### 2.1 核心工作流（第1集：标准4步流程）

| 步骤 | 界面 | 功能 | 产出 |
|------|------|------|------|
| Step 1 | ScriptInput | 输入话题/上传剧本，选择电影风格、子风格、画风、AI技能，生成剧本 | `script` |
| Step 2 | ScriptReview | 查看与编辑生成的剧本，支持重新生成 | 确认后的 `script` |
| Step 3 | ScriptSplit | 解析剧本，提取角色、场景、故事背景、人物关系网 | `characters`, `scenes`, `era`, `relationshipNetwork` |
| Step 4 | EpisodeGenerate | 根据剧本和角色/场景生成片段（Shots），为每个片段生成首帧/尾帧/视频 | `episodes`（片段列表） |

### 2.2 简化工作流（第2集+：续写模式）

| 面板 | 组件 | 功能 |
|------|------|------|
| 剧本续写 | SimplifiedEpisodeFlow - script面板 | 继承上一集话题，基于 `previousEpisodeScript` 生成下一集剧本 |
| 剧本分解 | SimplifiedScriptSplit | 解析剧本，检查本集与上一集复用的角色/场景，仅展示本集活跃资产 |
| 片段列表 | SimplifiedEpisodeFlow - shots面板 | 确认分解后生成片段，展示片段卡片 |
| 项目资产 | ProjectAssetsPanel | 查看跨分集共享的角色、场景、背景、关系网（按当前集活跃ID过滤） |

**全局资产查看**：所有集 sidebar 下方新增独立的资产图标按钮，点击后通过 `GlobalAssetsPanel` 展示当前项目的全部资产（角色、关系网、场景、故事背景），不过滤，供跨集资产管理。

### 2.3 数据模型（v2：项目资产 + 分集数据拆分）

```
┌─────────────────────────────────────────────────────────────┐
│                     Project Assets                          │
│  ├─ characters      角色列表（跨分集共享）                    │
│  ├─ scenes          场景列表（跨分集共享）                    │
│  ├─ era             故事背景（跨分集共享）                    │
│  ├─ relationshipNetwork  人物关系网（跨分集共享）             │
│  ├─ agentType       电影风格                                │
│  ├─ artStyle        画风                                    │
│  ├─ skills          AI技能                                  │
│  └─ models          模型配置                                │
├─────────────────────────────────────────────────────────────┤
│  Episode 1 Data    │  Episode 2 Data   │  Episode N Data   │
│  ├─ topic          │  ├─ topic         │  ├─ topic         │
│  ├─ script         │  ├─ script        │  ├─ script        │
│  ├─ episodes       │  ├─ episodes      │  ├─ episodes      │
│  ├─ previousEpisodeScript          │  ├─ previousEpisodeScript     │
│  ├─ activeCharacterIds             │  ├─ activeCharacterIds        │
│  ├─ activeSceneIds                 │  ├─ activeSceneIds            │
│  └─ isSimplifiedMode: false        │  └─ isSimplifiedMode: true    │
└─────────────────────────────────────────────────────────────┘
```

**localStorage 存储键：**
- 项目资产：`shotlib_workflow_{projectId}_assets`
- 分集数据：`shotlib_workflow_{category}_{type}_{projectId}_episode_{N}`

### 2.4 分集管理规则

| 操作 | 规则 |
|------|------|
| 新建分集 | 当前分集必须有 `episodes`（片段已生成）才能创建下一集 |
| 删除分集 | 只能删除最后一集（非第1集），非最后一集不显示删除按钮 |
| 切换分集 | 保存当前分集数据 → 加载目标分集数据（资产+数据） |
| 第2集+模式 | `isSimplifiedMode = true`，左侧 sidebar + 右侧3面板切换 |

### 2.5 跨集资产合并策略

当第2集+解析剧本时：
1. 新角色与已有角色按 `name` 匹配
2. 匹配成功 → 复用上一集的 `avatarUrls`/`fullBodyUrls`/`imageUrls`，保留新剧本的描述
3. 匹配失败 → 新增角色
4. 场景同理
5. 关系网只保留新剧本中仍然存在的角色之间的关系

---

## 三、前端文件说明

### 3.1 目录结构

```
workflow/
├── pages/
│   └── WorkflowPage.tsx          # 工作流主页面：分集管理 + 步骤渲染 + 顶部工具栏
├── components/
│   ├── WorkflowContainer.tsx     # WorkflowStep 步骤卡片容器组件
│   ├── EpisodeSidebarSteps.tsx   # 第2集+ 左侧 sidebar 导航（4面板切换：续写/分解/片段/资产）
│   ├── SimplifiedEpisodeFlow.tsx # 第2集+ 简化流程主组件（按面板渲染）
│   ├── SimplifiedScriptSplit.tsx # 第2集+ 剧本分解面板（检查复用角色/场景）
│   ├── ProjectAssetsPanel.tsx    # 项目资产面板（按当前集活跃ID过滤）
│   ├── GlobalAssetsPanel.tsx     # 全局资产面板（不过滤，展示全部跨集资产）
│   └── steps/
│       ├── ScriptInput.tsx       # Step 1: 剧本输入（话题+风格选择+生成）
│       ├── ScriptReview.tsx      # Step 2: 剧本编辑（查看/编辑/重新生成）
│       ├── ScriptSplit.tsx       # Step 3: 剧本分解（角色/场景/关系网 Tabs）
│       └── EpisodeGenerate.tsx   # Step 4: 片段生成（片段列表+视频生成）
├── stores/
│   ├── workflowStore.ts          # 核心 Zustand store：状态定义 + v2存储拆分
│   ├── workflowStore.script.ts   # 剧本生成/解析逻辑 + 跨集资产合并
│   ├── workflowStore.character.ts # 角色相关操作（生成头像/全身图/扩图）
│   ├── workflowStore.scene.ts    # 场景相关操作（生成场景图）
│   ├── workflowStore.episode.ts  # 片段/视频生成操作
│   └── workflowStore.frame.ts    # 首帧/尾帧生成操作
├── api/
│   ├── workflowApi.ts            # 工作流 API 封装（剧本/片段/轮询）
│   ├── scriptApi.ts              # 剧本相关 API
│   ├── episodeApi.ts             # 片段相关 API
│   ├── characterApi.ts           # 角色相关 API
│   ├── sceneApi.ts               # 场景相关 API
│   ├── shotApi.ts                # 分镜/视频相关 API
│   ├── modelApi.ts               # 模型列表 API
│   ├── syncApi.ts                # 项目同步 API
│   ├── aiJobApi.ts               # AI 异步任务 API
│   ├── types.ts                  # API 类型定义
│   └── utils.ts                  # API 工具函数
├── hooks/
│   ├── useAgentTypes.ts          # 电影风格/子风格/画风数据获取
│   ├── useSkills.ts              # AI 技能数据获取
│   └── useHotScripts.ts          # 热门剧本数据获取
└── utils/
    └── workflowUtils.ts          # v2 存储工具：键生成 + 资产/数据拆分 + 迁移
```

### 3.2 关键组件说明

#### WorkflowPage.tsx
- **分集 Tab 栏**：显示所有分集，点击切换，当前分集高亮
- **顶部工具栏**：同步到本地/云端、Preview 开关、登录状态
- **渲染分支**：
  - `isSimplifiedMode && currentEpisode !== 1` → 简化模式（sidebar + 3面板）
  - 否则 → 标准4步流程（左侧步骤导航 + 右侧步骤内容）
- **步骤锁定规则**：
  - 第1步剧本生成后 → 第1步输入锁定
  - 第3步完成后 → 第2步剧本编辑锁定
  - 第4步完成后 → 第3步剧本分解锁定

#### workflowStore.ts
- **PROJECT_ASSET_FIELDS**：跨分集共享的字段列表
- **EPISODE_DATA_FIELDS**：分集独立的字段列表（含 `activeCharacterIds`, `activeSceneIds`）
- **hydrateStoreFromStorage()**：从 localStorage v2 格式加载，自动迁移旧数据
- **persistWorkflowState()**：保存时分拆为资产+数据
- **loadWorkflowFromServer()**：从后端加载，本地有数据时跳过后端覆盖

#### workflowStore.script.ts
- **generateScript()**：构建包含 `previousEpisodeScript` 的上下文提示词，调用后端生成
- **parseScript()**：调用后端解析，智能合并新旧角色/场景资产

---

## 四、后端说明

### 4.1 后端目录结构

```
backend/src/apps/portal/creator/
├── modules/project-sync/               # 项目数据同步模块
│   ├── project-sync.controller.ts      # REST API：项目CRUD、数据同步
│   ├── project-sync.service.ts         # 业务逻辑：项目数据存储/读取
│   ├── project-sync.cache.service.ts   # Redis 缓存
│   ├── entities/
│   │   ├── creator-project.entity.ts   # 项目实体
│   │   ├── creator-episode.entity.ts   # 分集实体（按项目分表）
│   │   ├── creator-episode-data.entity.ts  # 分集数据实体
│   │   └── creator-project-data.entity.ts  # 项目资产实体
│   └── dto/
│       ├── project-sync.dto.ts         # 同步请求/响应 DTO
│       └── episode.dto.ts              # 分集 DTO
│
└── shared/modules/create/drama/
    ├── interfaces/controllers/
    │   ├── scripts.controller.ts       # 剧本 API：生成/解析/热门/风格/技能
    │   └── episodes.controller.ts      # 片段 API：生成/视频/首帧/尾帧
    ├── application/services/
    │   └── episodes.service.ts         # 片段业务逻辑
    └── application/dto/
        ├── script.dto.ts               # 剧本 DTO
        └── episode.dto.ts              # 片段 DTO
```

### 4.2 API 接口说明

#### 剧本相关（ScriptsController）

| 方法 | 路径 | 说明 | 关联前端文件 |
|------|------|------|-------------|
| POST | `/api/creator/script/generate` | 生成剧本 | `workflowStore.script.ts` |
| POST | `/api/creator/script/parse` | 解析剧本（提取角色/场景/背景/关系） | `workflowStore.script.ts` |
| GET | `/api/creator/script/hot` | 获取热门剧本推荐 | `useHotScripts.ts` |
| GET | `/api/creator/script/agent-types` | 获取电影风格列表 | `useAgentTypes.ts` |
| GET | `/api/creator/script/skills` | 获取AI技能列表 | `useSkills.ts` |
| GET | `/api/creator/script/job/:id` | 查询异步剧本生成任务状态 | `workflowApi.ts` |

#### 片段相关（EpisodesController）

| 方法 | 路径 | 说明 | 关联前端文件 |
|------|------|------|-------------|
| POST | `/api/creator/episode/generate` | 根据剧本生成片段结构 | `workflowStore.episode.ts` |
| POST | `/api/creator/episode/:id/video` | 生成片段视频 | `workflowStore.episode.ts` |
| POST | `/api/creator/episode/:id/first-frame` | 生成首帧图片 | `workflowStore.frame.ts` |
| POST | `/api/creator/episode/:id/last-frame` | 生成尾帧图片 | `workflowStore.frame.ts` |
| POST | `/api/creator/episode/:id/video-with-frames` | 使用首尾帧生成视频 | `workflowStore.episode.ts` |
| POST | `/api/creator/episode/:id/video-with-references` | 使用参考图生成视频 | `workflowStore.episode.ts` |
| GET | `/api/creator/episode/:id/video-task/:taskId` | 查询视频生成任务状态 | `workflowStore.episode.ts` |

#### 项目同步相关（ProjectSyncController）

| 方法 | 路径 | 说明 | 关联前端文件 |
|------|------|------|-------------|
| POST | `/api/creator/project-sync` | 保存项目数据 | `projectSync.service.ts` |
| GET | `/api/creator/project-sync/:projectId` | 获取项目数据 | `workflowStore.ts` |

### 4.3 核心服务

#### AIModelService
- **generateScript()**：调用大语言模型生成剧本
- **parseScript()**：调用大语言模型解析剧本为结构化数据（角色/场景/背景/关系网）
- **generateEpisodes()**：调用大语言模型根据剧本生成片段结构

#### VideoProcessingService
- 支持多模型视频生成：SVD、Seedance 1.0/1.5/2.0、Wan 等
- 支持文生视频、首尾帧生视频、参考图生视频

#### ImageProcessingService
- 支持多模型图片生成：Seedream、SD 等
- 支持文生图、图生图、角色一致性生成

### 4.4 异步任务（Bull Queue）

后端支持 Redis + Bull 队列实现异步任务：
- `generate-script`：剧本生成
- `parse-script`：剧本解析
- `generate-episode`：片段生成
- `generate-video`：视频生成
- `generate-first-frame`：首帧生成
- `generate-last-frame`：尾帧生成

当 Redis 未启用时，自动回退到同步调用模式。

### 4.5 数据实体

#### CreatorProject（项目）
```typescript
- id: string
- name: string
- category: 'drama' | 'podcast'
- type: string
- userId: string
- aspectRatio: string
- createdAt / updatedAt
```

#### CreatorEpisode（分集）
```typescript
- id: string
- projectId: string
- episodeNumber: number
- createdAt / updatedAt
```

**分表策略**：按 `projectId % 100` 分100张表（`creator_episode_{00~99}`），避免单表数据过大。

#### CreatorEpisodeData（分集数据）
```typescript
- id: string
- episodeId: string
- data: JSON（存储 topic, script, episodes, previousEpisodeScript 等）
```

#### CreatorProjectData（项目资产）
```typescript
- id: string
- projectId: string
- data: JSON（存储 characters, scenes, era, relationshipNetwork 等）
```

---

## 五、前后端交互流程

### 5.1 剧本生成流程

```
用户输入话题 → ScriptInput.tsx
    ↓
workflowStore.generateScript()
    ↓
POST /api/creator/script/generate { topic, model, agentType, skills, async: true }
    ↓
ScriptsController.generateScript()
    ↓
AIModelService.generateScript() → 调用 LLM API
    ↓
返回 { jobId } → 前端轮询
    ↓
GET /api/creator/script/job/:id
    ↓
剧本生成成功 → workflowStore.setState({ script })
    ↓
自动触发 parseScript()
```

### 5.2 片段生成流程

```
用户点击"生成片段" → EpisodeGenerate.tsx / SimplifiedEpisodeFlow.tsx
    ↓
workflowStore.generateEpisodes()
    ↓
POST /api/creator/episode/generate { script, characters, scenes, async: true }
    ↓
EpisodesController.generateEpisode()
    ↓
EpisodesService.generateEpisode() → AIModelService.generateEpisodes()
    ↓
返回片段列表 → workflowStore.setState({ episodes })
    ↓
用户点击"生成视频" → EpisodeCard.tsx
    ↓
POST /api/creator/episode/:id/video { videoPrompt, model }
    ↓
EpisodesService.generateVideo() → VideoProcessingService
    ↓
返回 videoUrl → workflowStore.updateEpisode({ generatedVideoUrl })
```

---

## 六、状态流转图

```
┌─────────────┐     generateScript      ┌─────────────┐
│   Step 0    │ ───────────────────────→│   Step 1    │
│ 剧本输入    │                         │ 剧本编辑    │
│ (topic='')  │                         │ (script有值) │
└─────────────┘                         └─────────────┘
                                               │
                                               │ parseScript
                                               ▼
                                        ┌─────────────┐
                                        │   Step 2    │
                                        │ 剧本分解    │
                                        │(characters  │
                                        │  scenes有值)│
                                        └─────────────┘
                                               │
                                               │ generateEpisodes
                                               ▼
                                        ┌─────────────┐
                                        │   Step 3    │
                                        │ 片段生成    │
                                        │(episodes有值)│
                                        └─────────────┘
                                               │
                                               │ generateVideo
                                               ▼
                                        ┌─────────────┐
                                        │  视频合成   │
                                        │(videoUrl)   │
                                        └─────────────┘
```

---

## 七、关键设计决策

| 决策 | 说明 |
|------|------|
| v2 数据模型拆分 | 项目资产（角色/场景/背景）与分集数据（剧本/片段）分离存储，避免数据膨胀和跨集覆盖 |
| 跨集资产合并 | parseScript 时自动按 name 匹配复用已有角色的图片资源，避免重复生成 |
| activeCharacterIds | 每集记录活跃角色/场景 ID，ProjectAssetsPanel 按 ID 过滤显示，避免显示未使用的资产 |
| 步骤锁定 | 完成后续步骤后锁定前序步骤输入，防止回溯修改导致数据不一致 |
| 新建分集条件 | 当前分集必须有 episodes 才能创建下一集，确保分集按顺序完成 |
| 删除分集限制 | 只能删除最后一集（非第1集），防止中间分集删除导致编号断层 |
| body-parser limit | 后端请求体限制提升到 10MB，支持大剧本/片段数据上传 |
