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
 * workflowStore.ts — 短剧工作流主 Store
 *
 * 通过 Zustand slice 模式组合各功能模块：
 * - script：剧本生成/解析
 * - character：角色管理/头像/形象照
 * - scene：场景管理
 * - episode：片段生成与编辑
 * - frame：首尾帧生成
 * - batch：批量生成
 * - model：模型加载
 *
 * 存储同步相关逻辑已拆分到 workflowStore.storage.ts / workflowStore.sync.ts。
 */
import { create } from 'zustand';
import { TEXT_MODELS, IMAGE_MODELS, VIDEO_MODELS } from '@/shared/types/index';
import type { Character, Episode, Scene, Prop, Era, RelationshipNetwork, ModelConfig, AudioAsset } from '@/shared/types/index';
import { setApiPreviewEnabled, getApiPreviewEnabled } from '@/shared/stores/apiPreviewStore';
import { persistWorkflowState } from './workflowStore.sync';
import { localApi } from '@/storage';
import type { PreviewRequestData } from '@/shared/hooks/usePreviewRequest';
import { saveGuard } from '../utils/workflowSaveGuard';
import { getEpisodeVideoUrl } from '../utils/workflowUtils';
import { message } from '@/shared/utils/message';
import { createScriptSlice } from './workflowStore.script';
import type { AssetPromptChanges, AssetPromptChangeItem, EpisodePromptChanges, EpisodePromptChangeItem } from '../api/scriptApi';
import { createCharacterSlice } from './workflowStore.character';
import { createSceneSlice } from './workflowStore.scene';
import { createPropSlice } from './workflowStore.prop';
import { createEpisodeSlice } from './workflowStore.episode';
import { createFrameSlice } from './workflowStore.frame';
import { createBatchSlice } from './workflowStore.batch';
import { createModelSlice } from './workflowStore.model';

// ========== 全局 Preview 回调 ==========
// Preview 请求回调注册（用于在 zustand store 中触发 React preview modal）
// 返回 Promise 以便调用方可以等待用户确认并获取 action 执行结果
let previewRequestRef: ((requestData: PreviewRequestData | PreviewRequestData[], action: () => Promise<any> | any) => Promise<any>) | null = null;

// 批量上下文标记：批量函数执行子任务时设为 true，子任务跳过自己的 preview，避免重复弹窗
let skipPreviewRef = false;

export function setWorkflowPreviewRequestCallback(
  callback: ((requestData: PreviewRequestData | PreviewRequestData[], action: () => Promise<any> | any) => Promise<any>) | null
) {
  previewRequestRef = callback;
}

// 批量函数在执行子任务前调用 setSkipPreview(true)，结束后调用 setSkipPreview(false)
export function setSkipPreview(value: boolean) {
  skipPreviewRef = value;
}

export function shouldPreview(): boolean {
  if (skipPreviewRef) return false;
  return getApiPreviewEnabled() && !!previewRequestRef;
}

// ========== 全局剧本生成完成回调 ==========
// 用于在 store 中通知 UI 剧本已生成成功，需要跳转到 step2
let scriptGeneratedCallbackRef: (() => void) | null = null;

export function setScriptGeneratedCallback(callback: (() => void) | null) {
  scriptGeneratedCallbackRef = callback;
}

export function notifyScriptGenerated() {
  scriptGeneratedCallbackRef?.();
}

export async function triggerPreview(
  requestData: PreviewRequestData | PreviewRequestData[],
  action: () => Promise<any> | void
): Promise<any> {
  if (previewRequestRef) {
    return await previewRequestRef(requestData, action as () => Promise<any> | any);
  } else {
    return action();
  }
}

// ========== 状态接口 ==========
export interface WorkflowState {
  // 当前项目/分集标识（唯一状态源，不再使用 window 全局变量）
  currentProjectId: string;
  currentEpisodeNumber: number;

  // 当前步骤
  currentStep: number;

  // 剧本相关
  topic: string;
  script: string;
  textModel: string;
  agentType: string;  // 智能体类型（小说类型）
  artStyle: string;   // 画风选择
  artStylePromptHint: string; // 画风的提示词
  skills: string[];       // 技能选择
  genre: string;          // 剧本类型（对应后端 genres 预设）
  creationMode: string;   // 创作模式：drama(付费短剧，默认) / story(故事短片) / mood(氛围情绪短片)，项目级

  // 角色相关
  characters: Character[];
  imageModel: string;

  // 场景相关
  scenes: Scene[];
  sceneModel: string;

  // 道具相关（剧本分解产出的关键道具，项目级资产）
  props: Prop[];

  // 故事背景相关
  era: Era | null;
  eraModel: string;

  // 人物关系网
  relationshipNetwork: RelationshipNetwork | null;

  // 分集叙事纲要（剧本分解产出：戏剧功能/情绪弧线/事件分桶/结尾状态）
  // 用于分镜生成时注入事件密度防火墙；旧项目数据无此字段时为空数组
  episodeOutlines: Array<{
    episodeNumber?: number;
    dramaticFunction?: string;
    emotionalArc?: string[];
    eventBuckets?: {
      thisEpisode?: string[];
      reservedForLater?: string[];
      doNotShowYet?: string[];
    };
    cliffhanger?: string;
    endingState?: string;
  }>;

  // 上一集剧本（用于新建分集时生成下一集剧本参考）
  previousEpisodeScript: string;
  /** 上一集逐片段概述（新建分集时从上一集片段列表提取，续写提示词的跨集剧情上下文） */
  previousEpisodeFragments: Array<{ title: string; description: string }>;

  // 故事梗概（当前分集）与上一集故事梗概（续集生成用）
  summary: string;
  previousEpisodeSummary: string;

  // 片段相关
  episodes: Episode[];
  videoModel: string;
  // 片段时长上限（秒）:15 或 30,30s 仅 seedance2.5 等长片段模型支持
  episodeMaxDuration: number;

  // 视频合成（Step5）：当前分集片段合并后的成片 URL
  composedVideoUrl: string;
  isComposing: boolean;

  // 加载状态
  isGeneratingScript: boolean;
  isParsingScript: boolean;
  isReviewingScript: boolean;
  isReviewingAssets: boolean;
  isReviewingEpisodes: boolean;
  isGeneratingEpisodes: boolean;

  // 导入锁：防止导入进行中切换项目导致数据写错
  isImporting: boolean;

  // 模型列表
  textModels: ModelConfig[];
  imageModels: ModelConfig[];
  videoModels: ModelConfig[];

  // Preview 模式
  previewEnabled: boolean;

  // 简化模式（第2集+）
  isSimplifiedMode: boolean;

  // 本集是否为大结局（选择结局方向时标记）
  isEnding: boolean;

  // 当前分集活跃的角色/场景ID（用于按分集过滤显示）
  activeCharacterIds: string[];
  activeSceneIds: string[];
  // 当前分集活跃的道具ID（与角色/场景同机制：道具为项目级资产，按分集过滤显示）
  activePropIds: string[];

  // 音频资产
  audioAssets: AudioAsset[];

  // 合规缓存版本：+1 触发订阅组件重渲染，从 localApi.getCachedImageData 读取最新合规状态
  imageComplianceVersion: number;

  // 音色模型
  voiceModel: string;
  voiceModels: ModelConfig[];

  // 场景图画面比例（后端 env CREATOR_SCENE_IMAGE_ASPECT_RATIO 下发，null 表示回退到项目比例）
  sceneImageAspectRatio: string | null;


  // Actions
  setCurrentProjectId: (projectId: string) => void;
  setCurrentEpisodeNumber: (episodeNumber: number) => void;
  setTopic: (topic: string) => void;
  setPreviewEnabled: (enabled: boolean) => void;
  setScript: (script: string) => void;
  setTextModel: (model: string) => void;
  setAgentType: (type: string) => void;
  setArtStyle: (artStyle: string, promptHint?: string) => void;
  setSkills: (skills: string[]) => void;
  setGenre: (genre: string) => void;
  setCreationMode: (mode: string) => void;
  setImageModel: (model: string) => void;
  setVideoModel: (model: string) => void;
  setEpisodeMaxDuration: (seconds: number) => void;
  setVoiceModel: (model: string) => void;
  setPreviousEpisodeScript: (script: string) => void;
  setPreviousEpisodeSummary: (summary: string) => void;
  setSummary: (summary: string) => void;
  setSimplifiedMode: (enabled: boolean) => void;
  setIsEnding: (isEnding: boolean) => void;
  setIsImporting: (isImporting: boolean) => void;

  generateScript: (subStyle?: string, artStyle?: string, regenerateSummary?: boolean) => Promise<boolean>;
  parseScript: (options?: { replace?: boolean }) => Promise<void>;
  /** 校验审阅剧本（mode=review 返回审阅报告）或按修改要求修改剧本（mode=modify 返回修改后的新剧本，不直接应用，需确认后调用 applyModifiedScript） */
  reviewScript: (mode: 'review' | 'modify', requirement?: string) => Promise<string | null>;
  /** 确认应用修改后的剧本（差异对比确认后调用），更新剧本并持久化 */
  applyModifiedScript: (newScript: string) => Promise<void>;
  /** 校验审阅角色/场景提示词（mode=review 返回审阅报告）或按修改要求修改提示词（mode=modify 返回修改结果，不直接应用，需勾选确认后调用 applyAssetPromptChanges） */
  reviewAssetPrompts: (mode: 'review' | 'modify', requirement?: string) => Promise<string | AssetPromptChanges | null>;
  /** 应用勾选的资产提示词修改项，更新角色/场景并持久化 */
  applyAssetPromptChanges: (items: AssetPromptChangeItem[]) => Promise<void>;
  /** 校验审阅片段/分镜提示词（mode=review 返回审阅报告）或按修改要求修改提示词（mode=modify 返回修改结果，不直接应用，需勾选确认后调用 applyEpisodePromptChanges） */
  reviewEpisodePrompts: (mode: 'review' | 'modify', requirement?: string) => Promise<string | EpisodePromptChanges | null>;
  /** 应用勾选的片段提示词修改项，更新片段/分镜并持久化 */
  applyEpisodePromptChanges: (items: EpisodePromptChangeItem[]) => Promise<void>;
  updateCharacter: (id: string, updates: Partial<Character>) => void;
  updateCharacterFullBody: (
    characterId: string,
    index: number,
    updates: Partial<NonNullable<Character['fullBodyImages']>[number]>,
    isMultiView?: boolean,
  ) => void;
  generateAvatar: (characterId: string, model?: string) => Promise<void>;
  generateAgeVariantAvatar: (characterId: string, targetAge: number, model?: string) => Promise<{ imageUrl: string; assetId?: string } | null>;
  generateCharacterViews: (characterId: string, avatarIndex?: number, model?: string) => Promise<void>;
  regenerateFullBody: (characterId: string, index: number, isMultiView?: boolean) => Promise<void>;
  generatePortrait: (characterId: string, portraitPrompt: string, model?: string, name?: string) => Promise<{ imageUrl: string; assetId?: string } | null>;
  addPortraitImages: (characterId: string, images: { imageUrl: string; prompt?: string; name?: string }[]) => void;
  removePortraitImage: (characterId: string, index: number) => void;
  removeCharacter: (id: string) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  addScene: (scene: Scene) => void;
  removeScene: (id: string) => void;
  regenerateSceneImage: (sceneId: string, index: number) => Promise<void>;
  generateSceneImages: (sceneId: string, model?: string, selectedViews?: number[]) => Promise<void>;
  updateProp: (id: string, updates: Partial<Prop>) => void;
  addProp: (prop: Prop) => void;
  removeProp: (id: string) => void;
  regeneratePropImage: (propId: string, index: number) => Promise<void>;
  generatePropImages: (propId: string, model?: string) => Promise<void>;
  updateEra: (updates: Partial<Era>) => void;
  generateEpisodes: () => Promise<void>;
  updateEpisode: (id: string, updates: Partial<Episode>) => void;
  addEpisode: () => string;
  reorderEpisodes: (fromIndex: number, toIndex: number) => void;
  insertEpisodeAfter: (afterEpisodeId: string, episode: Episode) => string;
  removeEpisode: (episodeId: string) => void;
  deriveEpisodeFromVideo: (episodeId: string) => Promise<{ newEpisodeId: string } | null>;
  generateEpisodeVideo: (episodeId: string, assetIdMap?: Map<string, string>) => Promise<void>;
  getEpisodeVideoPreviewData: (episodeId: string) => { endpoint: string; body: any } | null;
  pollVideoTaskStatus: (episodeId: string, taskId: string, taskQueueTaskId?: string) => Promise<void>;
  /** [Step5] 合并当前分集已生成的片段视频为完整短片 */
  composeEpisodeVideos: () => Promise<void>;
  checkPendingVideoTasks: () => void;
  resumeBullVideoPolling: (taskQueueTaskId: string, jobId: string, episodeId: string) => void;
  generateFirstFrame: (episodeId: string, model?: string) => Promise<void>;
  generateLastFrame: (episodeId: string, model?: string) => Promise<void>;
  generateShotReferenceImage: (episodeId: string, shotIndex: number, model?: string) => Promise<void>;
  batchGenerateReferenceImages: (model?: string) => Promise<void>;
  batchGenerateEpisodeShotReferences: (episodeId: string, model?: string) => Promise<void>;
  batchGenerateEpisodeFrames: (episodeId: string, model?: string) => Promise<void>;
  batchGenerateAvatars: (model?: string, options?: { force?: boolean; clearDerived?: boolean }) => Promise<void>;
  batchGeneratePortraits: (model?: string, force?: boolean) => Promise<void>;
  batchGenerateScenes: (model?: string, selectedViews?: number[]) => Promise<void>;
  batchGenerateProps: (model?: string) => Promise<void>;
  setCurrentStep: (step: number) => void;
  loadModels: () => Promise<void>;
  /** 清空 store 数据（项目切换/退出时调用，只清除分集级和显示字段，保留项目级配置） */
  clearStore: () => void;
  resetLoadingStates: () => void;
  resetAfterStep1: () => void;
  resetAfterStep2: () => void;
  resetAfterStep3: () => void;

  // 音频资产
  addAudioAsset: (asset: AudioAsset) => void;
  removeAudioAsset: (id: string) => void;
  setAudioAssets: (assets: AudioAsset[]) => void;

  /** 合规缓存版本 +1，触发订阅组件重渲染 */
  bumpImageComplianceVersion: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  (set, get) => {
    // 注册全局引用，供 sync.save/sync.beforeunload 等同步上下文使用（避免循环依赖）
    if (typeof window !== 'undefined') {
      (window as any).__shotlib_workflow_store = { getState: () => get(), setState: set };
    }
    return {
    currentProjectId: '',
    currentEpisodeNumber: 1,

    currentStep: 0,
    topic: '',
    script: '',
    textModel: TEXT_MODELS[0].id,
    agentType: 'realism', // 默认写实主义
    artStyle: '', // 画风，默认空，会在第1步自动设置
    artStylePromptHint: '', // 画风的提示词
    skills: ['character', 'scene', 'dialogue', 'plot'], // 默认技能
    genre: '', // 剧本类型，默认空，会在第1步加载类型列表后自动设置为第一个
    creationMode: 'drama', // 创作模式，默认付费短剧（兼容存量项目）
    characters: [],
    imageModel: IMAGE_MODELS[0].id,
    scenes: [],
    props: [],
    sceneModel: IMAGE_MODELS[0].id, // 默认无可用图片模型
    era: null,
    eraModel: IMAGE_MODELS[0].id, // 默认无可用图片模型
    relationshipNetwork: null,
    episodeOutlines: [],
    previousEpisodeScript: '',
    previousEpisodeFragments: [],
    summary: '',
    previousEpisodeSummary: '',
    episodes: [],
    videoModel: VIDEO_MODELS[0].id,
    episodeMaxDuration: 15,
    composedVideoUrl: '',
    isComposing: false,
    isGeneratingScript: false,
    isParsingScript: false,
    isReviewingScript: false,
    isReviewingAssets: false,
    isReviewingEpisodes: false,
    isGeneratingEpisodes: false,
    isImporting: false,

    // 模型列表初始值
    textModels: TEXT_MODELS,
    imageModels: IMAGE_MODELS,
    videoModels: VIDEO_MODELS,
    voiceModels: [],
    voiceModel: '',
    sceneImageAspectRatio: null,

    previewEnabled: false,
    isSimplifiedMode: false,
    isEnding: false,
    activeCharacterIds: [],
    activeSceneIds: [],
    activePropIds: [],
    audioAssets: [],
    imageComplianceVersion: 0,

    setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),

    setCurrentEpisodeNumber: (currentEpisodeNumber) => set({ currentEpisodeNumber }),

    setTopic: (topic) => set({ topic }),

    setScript: (script) => set({ script }),

    setTextModel: (textModel) => {
      set({ textModel });
    },

    setAgentType: (agentType) => set({ agentType }),

    setArtStyle: (artStyle, promptHint) => set({ artStyle, artStylePromptHint: promptHint || '' }),

    setSkills: (skills) => set({ skills }),

    setGenre: (genre) => set({ genre }),
    setCreationMode: (creationMode) => set({ creationMode }),

    setImageModel: (imageModel) => {
      set({ imageModel });
    },

    setVideoModel: (videoModel) => {
      set({ videoModel });
    },

    setEpisodeMaxDuration: (episodeMaxDuration) => {
      set({ episodeMaxDuration });
    },

    setVoiceModel: (voiceModel) => {
      set({ voiceModel });
    },

    setPreviewEnabled: (previewEnabled) => {
      set({ previewEnabled });
      // 同步到全局 preview 状态
      try {
        setApiPreviewEnabled(previewEnabled);
      } catch {
        // ignore
      }
    },

    setPreviousEpisodeScript: (previousEpisodeScript) => set({ previousEpisodeScript }),

    setPreviousEpisodeSummary: (previousEpisodeSummary) => set({ previousEpisodeSummary }),

    setSummary: (summary) => set({ summary }),

    setSimplifiedMode: (isSimplifiedMode) => set({ isSimplifiedMode }),

    setIsEnding: (isEnding) => set({ isEnding }),
    setIsImporting: (isImporting) => set({ isImporting }),

    updateCharacter: (id, updates) => {
      if (updates.model !== undefined) {
        const target = get().characters.find((c) => c.id === id);
        console.log(`[ModelPersist] 角色模型变更: ${target?.name}(${id.slice(0, 8)}) -> ${updates.model}`);
      }
      set((state) => ({
        characters: state.characters.map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      }));
    },

    updateCharacterFullBody: (characterId, index, updates, isMultiView = false) => {
      set((state) => ({
        characters: state.characters.map((c) => {
          if (c.id !== characterId) return c;
          if (isMultiView) {
            const newMultiViewImages = [...(c.multiViewImages || [])];
            newMultiViewImages[index] = { ...newMultiViewImages[index], ...updates };
            return {
              ...c,
              multiViewImages: newMultiViewImages,
            };
          }
          const newFullBodyImages = [...(c.fullBodyImages || [])];
          newFullBodyImages[index] = { ...newFullBodyImages[index], ...updates };
          return {
            ...c,
            fullBodyImages: newFullBodyImages,
          };
        }),
      }));
    },

    removeCharacter: (id) => {
      set((state) => ({
        characters: state.characters.filter((c) => c.id !== id),
        activeCharacterIds: state.activeCharacterIds.filter((cid) => cid !== id),
      }));

      // 同步删除后端资产行
      const projectId = get().currentProjectId;
      if (projectId && projectId !== 'default') {
        localApi.deleteProjectAsset(projectId, 'character', id, 0).catch((e) => {
          console.error(`[workflowStore] 删除角色资产失败: ${id}`, e);
        });
      }
    },

    updateScene: (id, updates) => {
      if (updates.model !== undefined) {
        const target = get().scenes.find((s) => s.id === id);
        console.log(`[ModelPersist] 场景模型变更: ${target?.name}(${id.slice(0, 8)}) -> ${updates.model}`);
      }
      set((state) => ({
        scenes: state.scenes.map((s) =>
          s.id === id ? { ...s, ...updates } : s
        ),
      }));
    },

    removeScene: (id) => {
      set((state) => ({
        scenes: state.scenes.filter((s) => s.id !== id),
        activeSceneIds: state.activeSceneIds.filter((sid) => sid !== id),
      }));

      // 同步删除后端资产行
      const projectId = get().currentProjectId;
      if (projectId && projectId !== 'default') {
        localApi.deleteProjectAsset(projectId, 'scene', id, 0).catch((e) => {
          console.error(`[workflowStore] 删除场景资产失败: ${id}`, e);
        });
      }
    },

    updateProp: (id, updates) => {
      if (updates.model !== undefined) {
        const target = (get().props || []).find((p) => p.id === id);
        console.log(`[ModelPersist] 道具模型变更: ${target?.name}(${id.slice(0, 8)}) -> ${updates.model}`);
      }
      set((state) => ({
        props: (state.props || []).map((p) =>
          p.id === id ? { ...p, ...updates } : p
        ),
      }));
    },

    removeProp: (id) => {
      set((state) => ({
        props: (state.props || []).filter((p) => p.id !== id),
        activePropIds: (state.activePropIds || []).filter((pid) => pid !== id),
      }));

      // 同步删除后端资产行
      const projectId = get().currentProjectId;
      if (projectId && projectId !== 'default') {
        localApi.deleteProjectAsset(projectId, 'prop', id, 0).catch((e) => {
          console.error(`[workflowStore] 删除道具资产失败: ${id}`, e);
        });
      }
    },

    updateEra: (updates) => {
      set((state) => ({
        era: state.era ? { ...state.era, ...updates } : null,
      }));
    },

    addAudioAsset: (asset) => {
      set((state) => ({
        audioAssets: [...state.audioAssets, asset],
      }));
      const { currentProjectId: pid, currentEpisodeNumber: epNum } = get();
      if (pid && pid !== 'default') {
        persistWorkflowState(pid, epNum ?? 1);
      }
    },

    removeAudioAsset: (id) => {
      set((state) => ({
        audioAssets: state.audioAssets.filter((a) => a.id !== id),
      }));
      const { currentProjectId: pid, currentEpisodeNumber: epNum } = get();
      if (pid && pid !== 'default') {
        persistWorkflowState(pid, epNum ?? 1);
      }
    },

    setAudioAssets: (assets) => set({ audioAssets: assets }),

    bumpImageComplianceVersion: () => set((s) => ({ imageComplianceVersion: s.imageComplianceVersion + 1 })),

    setCurrentStep: (step) => set((state) => ({ currentStep: Math.max(state.currentStep, step) })),

    // [Step5] 合并当前分集已生成的片段视频（FFmpeg 后端拼接）
    composeEpisodeVideos: async () => {
      const { episodes, currentProjectId, currentEpisodeNumber } = get();
      // 与 step4 一致：过滤软删除片段，视频 URL 回退历史记录
      const segments = (episodes || [])
        .filter((ep) => !ep.deleted)
        .map((ep) => getEpisodeVideoUrl(ep))
        .filter(Boolean);
      if (segments.length === 0) {
        message.warning('请先在第4步生成至少一个片段视频');
        return;
      }
      set({ isComposing: true });
      try {
        // 动态导入避免与 episodeApi 的循环依赖
        const { composeEpisodeVideosApi } = await import('../api/episodeApi');
        const res = await composeEpisodeVideosApi(
          segments.map((videoUrl) => ({ videoUrl })),
          currentProjectId || undefined,
        );
        if (res.success && res.data?.videoUrl) {
          set({ composedVideoUrl: res.data.videoUrl });
          message.success('片段视频合并完成！');
          // 触发本地持久化（后端保存随统一保存流程）
          if (currentProjectId && currentProjectId !== 'default') {
            persistWorkflowState(currentProjectId, currentEpisodeNumber ?? 1);
          }
        } else {
          message.error(res.message || '视频合并失败');
        }
      } catch (e) {
        message.error('视频合并失败：' + (e instanceof Error ? e.message : '未知错误'));
      } finally {
        set({ isComposing: false });
      }
    },

    // clearStore: 退出项目上下文时重置 store
    // 清除所有分集级数据、上下文标识和加载状态。
    // 注意：虽然 era/relationshipNetwork 属于项目级，但此函数在退出项目时调用，
    // 下次进入新项目时会从后端重新加载，因此一并清空是安全的。
    // 模型列表（textModels/imageModels/videoModels）和 preview 开关不清除（全局配置性质）。
    clearStore: () => {
      saveGuard.clearSnapshot();
      set({
        currentProjectId: '',
        currentEpisodeNumber: 1,
        currentStep: 0,
        topic: '',
        script: '',
        summary: '',
        previousEpisodeScript: '',
        previousEpisodeSummary: '',
        previousEpisodeFragments: [],
        episodes: [],
        episodeMaxDuration: 15,
        isEnding: false,
        isSimplifiedMode: false,
        creationMode: 'drama',
        activeCharacterIds: [],
        activeSceneIds: [],
        activePropIds: [],
        composedVideoUrl: '',
        isComposing: false,
        characters: [],
        scenes: [],
        props: [],
        isGeneratingScript: false,
        isParsingScript: false,
        isReviewingScript: false,
        isReviewingAssets: false,
        isReviewingEpisodes: false,
        isGeneratingEpisodes: false,
      });
    },

    resetLoadingStates: () =>
      set({
        isGeneratingScript: false,
        isParsingScript: false,
        isReviewingScript: false,
        isReviewingAssets: false,
        isReviewingEpisodes: false,
        isGeneratingEpisodes: false,
        characters: (get().characters ?? []).map(c => ({
          ...c,
          isGeneratingAvatar: false,
          isGeneratingViews: false,
        })),
        scenes: (get().scenes ?? []).map(s => ({
          ...s,
          isGenerating: false,
        })),
        props: (get().props ?? []).map(p => ({
          ...p,
          isGenerating: false,
        })),
        episodes: (get().episodes ?? []).map(e => ({
          ...e,
          isGenerating: false,
        })),
        isSimplifiedMode: get().isSimplifiedMode,
      }),

    // 步骤1重新生成后，清空步骤2、3、4的数据
    // 注意：era/relationshipNetwork 是项目级字段，不应被步骤重置清除
    resetAfterStep1: () => {
      saveGuard.markReset();
      saveGuard.clearSnapshot();
      set({
        characters: [],
        scenes: [],
        props: [],
        episodes: [],
        activeCharacterIds: [],
        activeSceneIds: [],
        activePropIds: [],
        composedVideoUrl: '',
      });
    },

    // 步骤2重新解析后，清空步骤3、4的数据
    resetAfterStep2: () =>
      set({
        episodes: [],
        composedVideoUrl: '',
      }),

    // 步骤3重新生成片段后，清空步骤4的数据
    resetAfterStep3: () =>
      set({
        episodes: [],
        composedVideoUrl: '',
      }),

    ...createScriptSlice(set, get),
    ...createCharacterSlice(set, get),
    ...createSceneSlice(set, get),
    ...createPropSlice(set, get),
    ...createEpisodeSlice(set, get),
    ...createFrameSlice(set, get),
    ...createBatchSlice(set, get),
    ...createModelSlice(set, get),
  };
});

// ========== 重新导出，保持向后兼容 ==========
// 同步函数
export {
  persistWorkflowState,
  saveToServer,
  saveProjectData,
  saveCharacterSceneAssets,
  saveEpisodeData as saveEpisodeDataToServer,
  saveDramaEpisodeToServer,
  ensureDramaEpisode,
  loadDramaEpisodeFromServer,
  loadAllEpisodesFromServer,
  cancelDebouncedSave,
  getUnsavedChanges,
  setSaveConflictCallback,
  flush as flushSave,
} from './workflowStore.sync';

// 加载函数
export {
  loadWorkflowFromServer,
  type WorkflowLoadResult,
} from './workflowStore.sync.load';

// 存储函数
export {
  saveProjectAssetsToStorage,
  loadProjectAssetsFromStorage,
  saveScriptToStorage,
  loadScriptFromStorage,
  saveEpisodeDataToStorage,
  loadEpisodeDataFromStorage,
  loadWorkflowFromCache,
  extractProjectData,
  extractEpisodeData,
  stripBase64Fields,
  PROJECT_DATA_FIELDS,
  EPISODE_DATA_FIELDS,
  SCRIPT_ASSET_FIELDS,
} from './workflowStore.storage';

// 类型
export type { BatchSliceActions } from './workflowStore.batch';
export type { ModelSliceActions } from './workflowStore.model';

/**
 * 获取当前项目ID（唯一状态源：store）
 */
export function getCurrentProjectId(state?: WorkflowState): string | undefined {
  return (state || useWorkflowStore.getState()).currentProjectId;
}

/**
 * 获取当前分集序号（唯一状态源：store）
 */
export function getCurrentEpisodeNumber(state?: WorkflowState): number {
  return (state || useWorkflowStore.getState()).currentEpisodeNumber ?? 1;
}
