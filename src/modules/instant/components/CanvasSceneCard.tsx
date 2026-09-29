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

import React, { useMemo, useState } from 'react';
import { Card, Button, Tooltip, Select, Tabs, Dropdown, Modal, Radio } from 'antd';
import type { MenuProps } from 'antd';
import {
  Image as ImageIcon,
  Edit3,
  Trash2,
  Film,
  Plus,
  User,
  Sparkles,
  MoreVertical,
  X,
  Copy,
} from 'lucide-react';
import VisualPromptEditor from '@/shared/components/ui/VisualPromptEditor';
import { AvatarUploadDialog } from '@/shared/components/ui/AvatarUploadDialog';
import { ImagePreview } from '@/shared/components/ui/ImagePreview';
import type { CanvasItem, InstantCharacter, InstantScene } from '@/shared/types/project';
import type { Shot } from '@/shared/types/index';
import { renderPromptHtml, generateVisualShotPrompt, wrapPromptWithTags } from '../utils/instantPromptUtils';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { PromptHtmlDisplay } from './PromptHtmlDisplay';
import { CanvasScenePresetModal } from './CanvasScenePresetModal';
import { CanvasSceneCreativeModal } from './CanvasSceneCreativeModal';
import { generateSegmentPromptApi } from '@/modules/workflow/api/sceneApi';
import { CanvasSceneVideoPanel } from './CanvasSceneVideoPanel';
import { InstantSceneReviewButton } from './InstantSceneReviewButton';
import { message } from '@/shared/utils/message';
import { ReferenceThumbnails } from '@/modules/generate/components/ReferenceThumbnails';
import { removeRefTagByUrl } from '@/modules/generate/refTagUtils';
import { uploadFile } from '@/shared/utils/upload';
import type { ShotReferenceAsset } from '@/shared/types/index';
import type { UserMaterialItem } from '@/shared/api/userMaterialApi';

interface CanvasSceneCardProps {
  item: CanvasItem;
  scene: InstantScene;
  sceneChars: InstantCharacter[];
  characters: InstantCharacter[];
  scenes: InstantScene[];
  currentProjectAspectRatio?: string;
  canvasAspectClass: string;
  defaultVideoModel: string;
  videoModels: { id: string; name: string; disabled?: boolean; duration?: { min: number; max: number; default: number; allowAuto: boolean }; supports?: { reference_image?: boolean; first_frame?: boolean; last_frame?: boolean } }[];
  textModels: { id: string; name: string; description?: string; disabled?: boolean }[];
  defaultTextModel: string;
  onDeleteCanvasItem: (itemId: string) => void;
  onEditScene: (scene: InstantScene) => void;
  onRemoveCharacterFromScene: (sceneItemId: string, charRefId: string) => void;
  onEditScenePrompt: (itemId: string) => void;
  onScenePromptChange: (itemId: string, value: string) => void;
  onSceneReferenceAssetsChange: (itemId: string, assets: ShotReferenceAsset[]) => void;
  onGenerateShots: (itemId: string) => void;
  onOpenShotModal: (itemId: string, shot?: Shot) => void;
  onDeleteShot: (itemId: string, shotId: string) => void;
  onShotTextModelChange: (itemId: string, model: string) => void;
  onShotMaxDurationChange: (itemId: string, seconds: number) => void;
  onSceneVideoModelChange: (itemId: string, model: string) => void;
  onVideoDurationChange: (itemId: string, duration: number) => void;
  onVideoResolutionChange: (itemId: string, resolution: '720p' | '1080p') => void;
  onGenerateSceneVideo: (itemId: string) => void;
  onRetrySceneVideo: (itemId: string) => void;
  onVideoGenerationModeChange: (itemId: string, mode: 'first_last_frame' | 'reference_image') => void;
  onFirstFramePromptChange: (itemId: string, value: string) => void;
  onLastFramePromptChange: (itemId: string, value: string) => void;
  onFirstLastFrameVideoPromptChange: (itemId: string, value: string) => void;
  onGenerateFirstFrame: (itemId: string) => void;
  onGenerateLastFrame: (itemId: string) => void;
  onOpenImagePreview: (imageUrl: string, title: string) => void;
  onVideoIndexChange: (itemId: string, index: number) => void;
  onGenerateShotReferenceImage: (itemId: string, shotIndex: number) => void;
  imageModels: { id: string; name: string; disabled?: boolean; description?: string }[];
  onShotImageModelChange: (itemId: string, model: string) => void;
  onBatchGenerateShotReferenceImages?: (itemId: string) => void;
  onBatchGenerateFirstLastFrames?: (itemId: string) => void;
  onOpenItemRename?: (itemId: string) => void;
  onDismissVideoError?: (itemId: string) => void;
  onApplyReviewChanges?: (itemId: string, items: import('@/modules/workflow/api/scriptApi').EpisodePromptChangeItem[]) => void;
}

// 预制故事场景模板
const PRESET_SCENES = [
  { id: '1', name: '初次见面', template: '在{scene}，{characters}初次相遇，眼神交汇，空气中弥漫着微妙的紧张感。' },
  { id: '2', name: '深情对视', template: '在{scene}，{characters}深情对视，时间仿佛静止，周围的一切都变得模糊。' },
  { id: '3', name: '争吵对峙', template: '在{scene}，{characters}激烈争吵，情绪激动，互不相让，气氛剑拔弩张。' },
  { id: '4', name: '误会解开', template: '在{scene}，{characters}终于解开误会，真相大白，两人释然相拥。' },
  { id: '5', name: '意外相遇', template: '在{scene}，{characters}意外重逢，惊喜交加，命运的安排让他们再次相遇。' },
  { id: '6', name: '英雄救美', template: '在{scene}，{characters}遭遇危险，千钧一发之际被英勇救下，感激与心动交织。' },
  { id: '7', name: '深情告白', template: '在{scene}，{characters}鼓起勇气深情告白，真挚的情感在空气中流淌。' },
  { id: '8', name: '浪漫约会', template: '在{scene}，{characters}享受浪漫的约会时光，欢声笑语，甜蜜温馨。' },
  { id: '9', name: '阴谋揭露', template: '在{scene}，隐藏的阴谋被{characters}揭露，真相 shocking，局势急转直下。' },
  { id: '10', name: '真相大白', template: '在{scene}，{characters}终于得知全部真相，恍然大悟，一切谜团迎刃而解。' },
  { id: '11', name: '求婚场景', template: '在{scene}，{characters}单膝跪地浪漫求婚，真挚的承诺让人动容。' },
  { id: '12', name: '分别离别', template: '在{scene}，{characters}依依不舍地分别，眼中含泪，约定未来再见。' },
  { id: '13', name: '雨中漫步', template: '在{scene}的雨中，{characters}共撑一把伞，雨水打在地面，气氛浪漫而忧伤。' },
  { id: '14', name: '烛光晚餐', template: '在{scene}，{characters}享受烛光晚餐，柔和的灯光映照着彼此的脸庞。' },
  { id: '15', name: '办公室冲突', template: '在{scene}，{characters}因工作产生激烈冲突，针锋相对，火花四溅。' },
  { id: '16', name: '医院病房', template: '在{scene}的病房中，{characters}守在病床前，担忧与关怀溢于言表。' },
  { id: '17', name: '街头追逐', template: '在{scene}的街头，{characters}展开紧张刺激的追逐，险象环生。' },
  { id: '18', name: '法庭对峙', template: '在{scene}的法庭上，{characters}展开激烈的对峙，正义与邪恶的较量。' },
  { id: '19', name: '生日惊喜', template: '在{scene}，{characters}精心策划生日惊喜，温馨感动的瞬间让人泪目。' },
  { id: '20', name: '日出日落', template: '在{scene}，{characters}并肩欣赏壮丽的日出/日落，许下美好心愿。' },
];

const AvatarButton: React.FC<{ char: InstantCharacter }> = ({ char }) => {
  const isMale = char.gender === '男性';
  const isFemale = char.gender === '女性';
  return char.avatar ? (
    <img
      src={char.avatar}
      alt={char.name}
      className="w-8 h-8 rounded-full bg-bg-tertiary object-cover border border-border hover:border-accent-error"
    />
  ) : (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center border hover:border-accent-error ${
        isMale
          ? 'bg-blue-500/20 border-blue-400/30'
          : isFemale
            ? 'bg-pink-500/20 border-pink-400/30'
            : 'bg-bg-tertiary border-border'
      }`}
    >
      <User size={14} className={`${isMale ? 'text-blue-400' : isFemale ? 'text-pink-400' : 'text-text-muted'}`} />
    </div>
  );
};

export const CanvasSceneCard: React.FC<CanvasSceneCardProps> = ({
  item,
  scene,
  sceneChars,
  characters,
  scenes,
  currentProjectAspectRatio,
  canvasAspectClass,
  defaultVideoModel,
  videoModels,
  textModels,
  defaultTextModel,
  onDeleteCanvasItem,
  onEditScene,
  onRemoveCharacterFromScene,
  onEditScenePrompt,
  onScenePromptChange,
  onSceneReferenceAssetsChange,
  onGenerateShots,
  onOpenShotModal,
  onDeleteShot,
  onShotTextModelChange,
  onShotMaxDurationChange,
  onSceneVideoModelChange,
  onVideoDurationChange,
  onVideoResolutionChange,
  onGenerateSceneVideo,
  onRetrySceneVideo,
  onVideoGenerationModeChange,
  onFirstFramePromptChange,
  onLastFramePromptChange,
  onFirstLastFrameVideoPromptChange,
  onGenerateFirstFrame,
  onGenerateLastFrame,
  onOpenImagePreview,
  onVideoIndexChange,
  onGenerateShotReferenceImage,
  imageModels,
  onShotImageModelChange,
  onBatchGenerateShotReferenceImages,
  onBatchGenerateFirstLastFrames,
  onOpenItemRename,
  onDismissVideoError,
  onApplyReviewChanges,
}) => {
  const is9x16 = currentProjectAspectRatio === '9:16';

  // 场景选择弹窗状态
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState('');
  // AI 创意弹窗状态
  const [creativeModalOpen, setCreativeModalOpen] = useState(false);
  const [creativeIdea, setCreativeIdea] = useState('');
  const [creativeModel, setCreativeModel] = useState('');
  const [creativePrompt, setCreativePrompt] = useState('');
  const [creativeGenerating, setCreativeGenerating] = useState(false);
  // 全能参考内层 Tabs 状态
  const [activeShotTab, setActiveShotTab] = useState('shot');
  // 参考附件上传状态（复刻 generate 页面输入框左侧的上传功能）
  const [uploading, setUploading] = useState(false);
  const [uploadingType, setUploadingType] = useState<ShotReferenceAsset['type'] | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [imgPreviewOpen, setImgPreviewOpen] = useState(false);
  const [imgPreviewIndex, setImgPreviewIndex] = useState(0);

  // 打开场景选择弹窗
  const handleOpenPresetModal = () => {
    setSelectedPresetId(null);
    setPreviewPrompt(item.customPrompt ?? item.generatedPrompt ?? '');
    setPresetModalOpen(true);
  };

  // 选择预制场景，生成预览提示词
  const handleSelectPreset = (presetId: string) => {
    const preset = PRESET_SCENES.find((s) => s.id === presetId);
    if (!preset) return;
    const charNames = sceneChars.map((c) => c.name).join('、');
    const rawPrompt = preset.template
      .replace(/{scene}/g, scene.name)
      .replace(/{characters}/g, charNames);
    const taggedPrompt = wrapPromptWithTags(rawPrompt, sceneChars, [scene]);
    setSelectedPresetId(presetId);
    setPreviewPrompt(taggedPrompt);
  };

  // 应用生成的提示词
  const handleApplyPreset = () => {
    if (previewPrompt.trim()) {
      onScenePromptChange(item.id, previewPrompt);
    }
    setPresetModalOpen(false);
    setSelectedPresetId(null);
  };

  // 打开 AI 创意弹窗（默认沿用当前场次的分镜文本模型）
  const handleOpenCreativeModal = () => {
    setCreativeIdea('');
    setCreativePrompt('');
    setCreativeModel(item.shotTextModel || defaultTextModel);
    setCreativeModalOpen(true);
  };

  // 调用文本模型，根据角色 + 场景 + 创意描述生成片段提示词
  const handleGenerateCreativePrompt = async () => {
    if (!creativeIdea.trim() || creativeGenerating) return;
    setCreativeGenerating(true);
    try {
      const res = await generateSegmentPromptApi(
        creativeModel || defaultTextModel,
        creativeIdea.trim(),
        scene.name,
        sceneChars.map((c) => c.name),
      );
      if (res.success && res.data?.prompt) {
        // 立即把角色名/场景名替换为 @<role>/#<scene> 标签，编辑区可直接预览角色和场景
        setCreativePrompt(wrapPromptWithTags(res.data.prompt, sceneChars, [scene]));
      } else {
        message.error(res.message || '生成片段提示词失败');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成片段提示词失败');
    } finally {
      setCreativeGenerating(false);
    }
  };

  // 应用 AI 创意生成的片段提示词（已是 @<role>/#<scene> 标签格式，直接写入父页面输入框）
  const handleApplyCreative = () => {
    if (creativePrompt.trim()) {
      onScenePromptChange(item.id, creativePrompt);
    }
    setCreativeModalOpen(false);
  };

  // ===== 参考附件上传（复刻 generate 页面输入框左侧的上传功能） =====
  const REF_MAX_COUNT = 9;
  const sceneReferenceAssets = item.referenceAssets || [];
  const imageAssetUrls = sceneReferenceAssets.filter((r) => r.type === 'image').map((r) =>r.assetId);

  const addAsset = (asset: ShotReferenceAsset) => {
    if (sceneReferenceAssets.length >= REF_MAX_COUNT) {
      message.warning(`最多添加 ${REF_MAX_COUNT} 条参考`);
      return;
    }
    onSceneReferenceAssetsChange(item.id, [...sceneReferenceAssets, asset]);
  };

  /** 本地上传参考附件（图片/视频/音频） */
  const handleUploadAsset = async (file: File) => {
    const type: ShotReferenceAsset['type'] = file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'image';
    setUploading(true);
    setUploadingType(type);
    try {
      const { url: assetId } = await uploadFile(file, 'drama', 'shot_reference');
      addAsset({ type, assetId, name: file.name });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
      setUploadingType(null);
    }
  };

  /** 点击附件缩略图：仅图片打开预览 */
  const handlePreviewAsset = (index: number) => {
    const asset = sceneReferenceAssets[index];
    if (!asset || asset.type !== 'image') return;
    const idx = imageAssetUrls.indexOf(asset.assetId);
    setImgPreviewIndex(idx >= 0 ? idx : 0);
    setImgPreviewOpen(true);
  };

  /** 删除附件：同步删除提示词中引用该附件的 !<ref> 标签 */
  const handleRemoveAsset = (index: number) => {
    const asset = sceneReferenceAssets[index];
    onSceneReferenceAssetsChange(item.id, sceneReferenceAssets.filter((_, idx) => idx !== index));
    if (!asset) return;
    const currentPrompt = item.customPrompt ?? '';
    if (currentPrompt.includes(asset.assetId)) {
      onScenePromptChange(item.id, removeRefTagByUrl(currentPrompt, asset.assetId));
    }
  };

  // 当前生成模式（优先使用已保存的模式，未保存时按模型 supports 推断）
  const inferredMode = (modelId: string) => {
    const cfg = videoModels.find((m) => m.id === modelId);
    return cfg?.supports?.reference_image === false ? 'first_last_frame' : 'reference_image';
  };
  const currentMode = item.videoGenerationMode || inferredMode(item.videoModel || defaultVideoModel);

  // 按当前生成模式过滤模型列表（依据模型配置 json 的 supports 字段判断，禁止硬编码）；
  // 分镜总时长选 30s 时，仅保留 model.json 中 duration.max >= 30 的长片段模型
  const maxShotDuration = item.shotMaxDuration === 30 ? 30 : 15;
  const filteredVideoModels = useMemo(() => {
    return videoModels.filter((m) => {
      if (m.disabled) return false;
      if (maxShotDuration > 15 && (m.duration?.max ?? 15) < maxShotDuration) return false;
      if (currentMode === 'reference_image') {
        return m.supports?.reference_image === true;
      }
      return m.supports?.first_frame === true && m.supports?.last_frame === true;
    });
  }, [videoModels, currentMode, maxShotDuration]);

  // 若当前模型不在过滤后的列表中，自动回退到第一个可用模型；否则保持之前选过的
  const effectiveModelId = filteredVideoModels.some((m) => m.id === item.videoModel)
    ? item.videoModel!
    : (filteredVideoModels.find((m) => !m.disabled)?.id || defaultVideoModel);

  // 基于实际生效的模型计算时长配置
  const currentModel = videoModels.find((m) => m.id === effectiveModelId);
  const durationConfig = currentModel?.duration;

  // 调试：监听 videoUrl 变化
  const prevVideoUrlRef = React.useRef(item.videoUrl);
  React.useEffect(() => {
    console.log('[CanvasSceneCard] render effect:', { itemId: item.id, videoUrl: item.videoUrl, videoUrls: item.videoUrls });
    if (prevVideoUrlRef.current !== item.videoUrl) {
      console.log('[CanvasSceneCard] videoUrl changed:', { itemId: item.id, from: prevVideoUrlRef.current, to: item.videoUrl });
      prevVideoUrlRef.current = item.videoUrl;
    }
  }, [item.videoUrl, item.videoUrls, item.id]);

  // 生成时长选项
  const durationOptions = useMemo(() => {
    if (!durationConfig) return [];
    const options: { value: number; label: string }[] = [];
    for (let i = durationConfig.min; i <= durationConfig.max; i++) {
      options.push({ value: i, label: `${i}秒` });
    }
    return options;
  }, [durationConfig]);

  // 全能参考模式下使用分镜总时长计算价格，首尾帧模式下使用 videoDuration
  const totalShotDuration = item.shots?.reduce((sum, s) => sum + s.duration, 0) ?? 0;
  const effectiveDuration = currentMode === 'reference_image'
    ? totalShotDuration
    : (item.videoDuration ?? durationConfig?.default ?? 5);

  const videoControl = (
    <div className="mt-2 flex flex-col gap-1.5 flex-shrink-0">
      {/* 分辨率选择 */}
      <div className="flex items-center justify-between">
        <Radio.Group
          value={item.videoResolution || '720p'}
          onChange={(e) => onVideoResolutionChange(item.id, e.target.value)}
          size="small"
          disabled={item.isGeneratingVideo}
        >
          <Radio.Button value="720p">720p</Radio.Button>
          <Radio.Button value="1080p">1080p</Radio.Button>
        </Radio.Group>
      </div>
      {/* 视频模型 + 时长 + 积分 */}
      <div className="flex items-center gap-1.5">
        <Select
          value={effectiveModelId}
          onChange={(model) => {
            const selectedModel = filteredVideoModels.find((m) => m.id === model);
            if (currentMode === 'reference_image' && selectedModel?.supports?.reference_image === false) {
              Modal.confirm({
                title: '提示',
                content: '当前视频模型不支持全能参考，将自动切换到首尾帧生成模式',
                okText: '确定',
                cancelText: '取消',
                onOk: () => {
                  onSceneVideoModelChange(item.id, model);
                  onVideoGenerationModeChange(item.id, 'first_last_frame');
                },
              });
            } else {
              onSceneVideoModelChange(item.id, model);
            }
          }}
          options={filteredVideoModels.map((m) => ({
            value: m.id,
            label: m.name,
            disabled: m.disabled,
          }))}
          size="small"
          className="flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()} popupMatchSelectWidth={false} />
        {currentMode !== 'reference_image' && durationOptions.length > 0 && (
          <Select
            value={item.videoDuration ?? durationConfig?.default ?? 5}
            onChange={(duration) => onVideoDurationChange(item.id, duration)}
            options={durationOptions}
            size="small"
            className="w-16 pointer-events-auto flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <ModelPriceTag model={videoModels.find(m => m.id === effectiveModelId)} duration={effectiveDuration} resolution={item.videoResolution || '720p'} />
      </div>
      {/* 生成视频按钮 */}
      <div className="flex items-center">
        <Button
          size="large"
          type="primary"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (item.videoGenerationFailed) {
              onRetrySceneVideo(item.id);
            } else {
              onGenerateSceneVideo(item.id);
            }
          }}
          loading={item.isGeneratingVideo}
          disabled={item.isGeneratingVideo}
          className="w-full flex-shrink-0 whitespace-nowrap bg-accent-primary border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {item.isGeneratingVideo
            ? '生成视频中...'
            : item.videoGenerationFailed
              ? '重试'
              : item.videoUrl
                ? '重新生成视频'
                : '生成视频'}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Card
        data-item-id={item.id}
        className={`pointer-events-auto select-none w-full scene-canvas-item`}
        styles={{ body: { padding: 12 } }}
        title={
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium break-words max-w-[300px]">
              {sceneChars.length > 0 ? `${item.name || scene.name}（角色：${sceneChars.map((c) => c.name).join('，')}）` : item.name || scene.name}
            </span>
            <div className="flex items-center gap-1 pointer-events-auto flex-shrink-0">
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'rename',
                      label: '重命名',
                      onClick: () => onOpenItemRename?.(item.id),
                    },
                    {
                      key: 'edit',
                      label: '编辑场景',
                      onClick: () => onEditScene(scene),
                    },
                    {
                      key: 'delete',
                      label: '删除',
                      danger: true,
                      onClick: () => onDeleteCanvasItem(item.id),
                    },
                  ] as MenuProps['items'],
                }}
                placement="bottomRight"
                trigger={['click']}
              >
                <Button
                  size="small"
                  type="text"
                  onMouseDown={(e) => e.stopPropagation()}
                  icon={<MoreVertical size={12} />}
                  className="text-text-secondary hover:text-text-primary"
                />
              </Dropdown>
            </div>
          </div>
        }
      >
        <div className="flex flex-row gap-3">
            {/* 内容区域 - 左侧 */}
            <div className="flex flex-col min-w-0 flex-1">
              {/* 拖入的角色头像 */}
              <div className="mb-2">
                <div className="text-xs text-text-muted mb-1">角色</div>
                {sceneChars.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sceneChars.map((char) => (
                      <div key={char.id} className="relative group pointer-events-auto">
                        <Tooltip title={char.name}>
                          <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => char.avatar && onOpenImagePreview(char.avatar, char.name)}
                            className="block"
                          >
                            <AvatarButton char={char} />
                          </button>
                        </Tooltip>
                        {/* 删除角标 */}
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => onRemoveCharacterFromScene(item.id, char.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 bg-accent-error rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                          title="移除角色"
                        >
                          <X size={10} className="text-white" strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted py-2 text-center border border-dashed border-border rounded bg-bg-tertiary/40">
                    还没有角色，请从角色库拖入角色开始创作
                  </div>
                )}
              </div>

              {/* 视频生成提示词 - 直接编辑 */}
              <div className="mb-2 pointer-events-auto">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-text-muted">分镜生成提示词</div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="small"
                      type="primary"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleOpenPresetModal}
                      className="bg-accent-primary border-0 text-xs"
                    >
                      场景模版
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={handleOpenCreativeModal}
                      className="bg-accent-primary border-0 text-xs"
                      icon={<Sparkles size={12} />}
                    >
                      AI创意
                    </Button>
                  </div>
                </div>
                {/* 参考附件上传 + 提示词输入框（同一行，复刻 generate 即梦风格：输入框左侧参考图） */}
                <div className="flex items-start gap-3">
                  <ReferenceThumbnails
                    references={sceneReferenceAssets}
                    maxCount={REF_MAX_COUNT}
                    uploading={uploading}
                    uploadingType={uploadingType}
                    mode="image"
                    onRemove={handleRemoveAsset}
                    onPreview={handlePreviewAsset}
                    onOpenAvatarUpload={() => setUploadDialogOpen(true)}
                  />
                  <VisualPromptEditor
                    value={item.customPrompt ?? item.generatedPrompt ?? ''}
                    onChange={(val) => onScenePromptChange(item.id, val)}
                    characters={sceneChars}
                    scenes={scenes}
                    referenceAssets={sceneReferenceAssets}
                    assetTriggerKey="@"
                    placeholder="描述视频内容，输入 @ 插入角色或参考，输入 # 插入场景..."
                    minRows={3}
                    maxRows={6}
                    hintText="输入 @ 插入角色或参考附件，输入 # 插入场景"
                    className="flex-1 min-w-0"
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-2 pointer-events-auto">
                  <Select
                    value={item.shotTextModel || defaultTextModel}
                    onChange={(model) => onShotTextModelChange(item.id, model)}
                    options={textModels.map((m) => ({
                      value: m.id,
                      label: (
                        <Tooltip title={m.description}>
                          <span className="text-xs">{m.name}</span>
                        </Tooltip>
                      ),
                      disabled: m.disabled,
                    }))}
                    size="small"

                    onClick={(e) => e.stopPropagation()} popupMatchSelectWidth={false} />
                  <ModelPriceTag model={textModels.find(m => m.id === (item.shotTextModel || defaultTextModel))} />
                  {/* 分镜总时长选择：15s/30s（30s 仅长片段模型如 seedance2.5 支持，与剧本生成短剧一致） */}
                  <span onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="30s 仅支持 seedance2.5 模型" placement="top">
                    <Radio.Group
                      optionType="button"
                      buttonStyle="solid"
                      size="small"
                      value={item.shotMaxDuration === 30 ? 30 : 15}
                      onChange={(e) => {
                        const seconds = e.target.value as number;
                        onShotMaxDurationChange(item.id, seconds);
                        if (seconds > 15) {
                          const vid = videoModels.find((m) => m.id === (item.videoModel || defaultVideoModel));
                          if (vid && (vid.duration?.max ?? 15) < seconds) {
                            message.warning('30s 片段仅支持 seedance2.5 模型，请在下方视频生成区切换模型');
                          }
                        }
                      }}
                      options={[
                        { value: 15, label: '15秒' },
                        { value: 30, label: '30秒' },
                      ]}
                    />
                  </Tooltip>
                  </span>
                  <Button
                    size="small"
                    type="primary"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      if (sceneChars.length === 0) {
                        message.warning('请先拖入角色再试');
                        return;
                      }
                      onGenerateShots(item.id);
                    }}
                    loading={item.isGeneratingShots}
                    disabled={item.isGeneratingShots}
                    className="bg-accent-primary border-0 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1">
                      <Sparkles size={12} />
                      <span>
                        {item.shots && item.shots.length > 0 ? '重新生成' : '生成分镜'}
                      </span>
                    </span>
                  </Button>
                  {/* 校验修改（与剧本生成短剧 Step4 分镜生成的校验修改一致） */}
                  {onApplyReviewChanges && (
                    <InstantSceneReviewButton
                      item={item}
                      scene={scene}
                      characters={characters}
                      textModel={item.shotTextModel || defaultTextModel}
                      disabled={item.isGeneratingShots || (!(item.customPrompt ?? item.generatedPrompt) && !(item.shots || []).length)}
                      onApplyChanges={onApplyReviewChanges}
                    />
                  )}
                </div>
              </div>

              {/* 视频生成方式 tabs */}
              <div className="pointer-events-auto flex-1 min-h-0 flex flex-col">
                <Tabs
                  className="scene-video-tabs episode-generation-tabs"
                  activeKey={currentMode}
                  onChange={(key) => onVideoGenerationModeChange(item.id, key as 'first_last_frame' | 'reference_image')}
                  type="card"
                  size="small"
                  tabBarExtraContent={
                    currentMode === 'reference_image' ? (
                      <Button
                        size="small"
                        type="text"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => onOpenShotModal(item.id)}
                        icon={<Plus size={12} />}
                        disabled={(item.shots?.reduce((sum, s) => sum + s.duration, 0) ?? 0) >= 15}
                        className="border-0 text-xs px-1 h-6 mt-2"
                      >
                        增加分镜
                      </Button>
                    ) : null
                  }
                  items={[
                    {
                      key: 'reference_image',
                      label: '全能参考生成',
                      children: (
                        <div className="space-y-4 h-full">
                          {/* 分镜设定头部 */}
                          <div className="flex items-center gap-2 mb-2">
                            <Film size={14} className="text-text-muted" />
                            <span className="text-xs text-text-muted">分镜设定</span>
                            {item.shots && item.shots.length > 0 && (
                              <span className="text-xs text-accent-primary">
                                ({item.shots.length}个镜头 · {item.shots.reduce((sum, s) => sum + s.duration, 0)}s / 15s)
                              </span>
                            )}
                          </div>
                          {/* 分镜 / 参考图 内层 Tabs */}
                          <Tabs
                            size="small"
                            type="card"
                            activeKey={activeShotTab}
                            onChange={setActiveShotTab}
                            className="episode-shot-tabs"
                            tabBarExtraContent={
                              activeShotTab === 'reference' ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-text-muted whitespace-nowrap">图片模型</span>
                                  <Select
                                    value={item.shotImageModel || imageModels[0]?.id}
                                    onChange={(val) => onShotImageModelChange(item.id, val)}
                                    options={imageModels.map((m) => ({
                                      value: m.id,
                                      label: (
                                        <Tooltip title={m.description}>
                                          <span className="text-xs">{m.name}</span>
                                        </Tooltip>
                                      ),
                                      disabled: m.disabled,
                                    }))}
                                    size="small"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    dropdownRender={(menu) => (
                                      <div onMouseDown={(e) => e.stopPropagation()}>{menu}</div>
                                    )} popupMatchSelectWidth={false} />
                                  <ModelPriceTag model={imageModels.find(m => m.id === (item.shotImageModel || imageModels[0]?.id))} />
                                  <Button
                                    size="small"
                                    type="primary"
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={() => onBatchGenerateShotReferenceImages?.(item.id)}
                                    loading={item.shots?.some((s) => s.isGeneratingReferenceImage) ?? false}
                                    disabled={item.shots?.some((s) => s.isGeneratingReferenceImage) ?? false}
                                    className="text-xs ml-1"
                                  >
                                    批量生成分镜图片
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="small"
                                  icon={<Copy size={12} />}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={async () => {
                                    if (!item.shots || item.shots.length === 0) {
                                      message.warning('暂无分镜可复制');
                                      return;
                                    }
                                    // 复制每个分镜的提示词（用 renderPromptHtml 渲染后取纯文本，含角色名/场景名而非 id 标记）
                                    const text = item.shots
                                      .map((s, i) => {
                                        const html = renderPromptHtml(generateVisualShotPrompt(s), characters, scenes);
                                        const div = document.createElement('div');
                                        div.innerHTML = html;
                                        return `分镜${i + 1}：\n${(div.textContent || '').trim()}`;
                                      })
                                      .join('\n\n');
                                    try {
                                      await navigator.clipboard.writeText(text);
                                      message.success('已复制全部分镜提示词');
                                    } catch {
                                      message.error('复制失败，请重试');
                                    }
                                  }}
                                  className="text-xs"
                                >
                                  复制提示词
                                </Button>
                              )
                            }
                            items={[
                              {
                                key: 'shot',
                                label: '分镜',
                                children: item.shots && item.shots.length > 0 ? (
                                  <div className="space-y-2">
                                    {item.shots.map((shot, index) => {
                                      const startTime = item.shots!.slice(0, index).reduce((sum, s) => sum + s.duration, 0);
                                      return (
                                        <div
                                          key={shot.id}
                                          className="bg-bg-tertiary rounded-lg p-3 flex items-start justify-between group"
                                        >
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 mb-1">
                                              <span className="text-sm font-medium text-accent-primary">分镜{index + 1}</span>
                                              <span className="text-[10px] text-text-muted">
                                                {startTime}s-{startTime + shot.duration}s
                                              </span>
                                            </div>
                                            <PromptHtmlDisplay
                                              className="text-sm text-text-secondary whitespace-pre-wrap break-words border border-dashed border-border rounded px-2 py-1 h-full overflow-auto"
                                              html={renderPromptHtml(generateVisualShotPrompt(shot), characters, scenes)}
                                            />
                                          </div>
                                          <div className="flex flex-col items-center gap-0.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <Button
                                              size="small"
                                              type="text"
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onClick={() => onOpenShotModal(item.id, shot)}
                                              icon={<Edit3 size={10} />}
                                              className="text-text-muted hover:text-accent-primary h-5 w-5 p-0"
                                            />
                                            <Button
                                              size="small"
                                              type="text"
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onClick={() => onDeleteShot(item.id, shot.id)}
                                              icon={<Trash2 size={10} />}
                                              className="text-text-muted hover:text-accent-error h-5 w-5 p-0"
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="bg-bg-tertiary rounded-lg p-4 text-center cursor-pointer hover:bg-bg-tertiary/80 transition-colors" onClick={() => onOpenShotModal(item.id)}>
                                    <p className="text-sm text-text-muted">{`点击添加分镜（总时长${item.shotMaxDuration === 30 ? 30 : 15}秒）`}</p>
                                  </div>
                                ),
                              },
                              {
                                key: 'reference',
                                label: '参考图',
                                disabled: true,
                                children: item.shots && item.shots.length > 0 ? (
                                  <div className="space-y-2 max-h-[400px] overflow-y-auto fixed-scrollbar">
                                    {item.shots.map((shot, index) => {
                                      const startTime = item.shots!.slice(0, index).reduce((sum, s) => sum + s.duration, 0);
                                      return (
                                        <div
                                          key={shot.id}
                                          className="bg-bg-tertiary rounded-lg p-3 flex items-start justify-between group"
                                        >
                                          <div className="flex items-start gap-2 flex-1 min-w-0 w-full">
                                            <div className="w-24 flex-shrink-0 flex flex-col gap-1.5">
                                              <div
                                                className={`relative w-full flex-shrink-0 rounded-lg overflow-hidden bg-bg-secondary self-start ${is9x16 ? 'aspect-[9/16]' : canvasAspectClass}`}
                                                onClick={() => shot.referenceImageUrl && onOpenImagePreview(shot.referenceImageUrl, `分镜 ${index + 1} 参考图`)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                              >
                                                {shot.isGeneratingReferenceImage ? (
                                                  <div className="w-full h-full flex items-center justify-center">
                                                    <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                                                  </div>
                                                ) : shot.referenceImageUrl ? (
                                                  <>
                                                    <img
                                                      src={shot.referenceImageUrl}
                                                      alt={`分镜 ${index + 1} 参考图`}
                                                      className="w-full h-full object-cover cursor-pointer"
                                                      onMouseDown={(e) => e.stopPropagation()}
                                                    />
                                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                                      <ImageIcon size={16} className="text-white" />
                                                    </div>
                                                  </>
                                                ) : (
                                                  <div className="w-full h-full flex items-center justify-center">
                                                    <ImageIcon size={16} className="text-text-muted" />
                                                  </div>
                                                )}
                                                <div className="absolute bottom-0 left-0 right-0 text-[10px] text-text-muted text-center bg-bg-secondary/80 py-0.5">参考图</div>
                                              </div>
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col">
                                              <div className="flex items-center gap-1.5 mb-1">
                                                <span className="text-sm font-medium text-accent-primary">分镜{index + 1}</span>
                                                <span className="text-[10px] text-text-muted">
                                                  {startTime}s-{startTime + shot.duration}s
                                                </span>
                                              </div>
                                              <PromptHtmlDisplay
                                                className="text-sm text-text-secondary whitespace-pre-wrap break-words border border-dashed border-border rounded px-2 py-1 h-full overflow-auto mb-2"
                                                html={renderPromptHtml(shot.prompt || '', characters, scenes)}
                                              />
                                              <Button
                                                size="small"
                                                type="primary"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onClick={() => onGenerateShotReferenceImage(item.id, index)}
                                                loading={shot.isGeneratingReferenceImage}
                                                icon={<ImageIcon size={10} />}
                                                disabled={!shot.prompt?.trim()}
                                                className="bg-accent-primary border-0 text-xs pointer-events-auto w-full disabled:opacity-50 disabled:cursor-not-allowed"
                                              >
                                                {shot.referenceImageUrl ? '重新生成' : '生成参考图'}
                                              </Button>
                                            </div>
                                          </div>
                                          <div className="flex flex-col items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <Button
                                              size="small"
                                              type="text"
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onClick={() => onOpenShotModal(item.id, shot)}
                                              icon={<Edit3 size={10} />}
                                              className="text-text-muted hover:text-accent-primary h-5 w-5 p-0"
                                            />
                                            <Button
                                              size="small"
                                              type="text"
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onClick={() => onDeleteShot(item.id, shot.id)}
                                              icon={<Trash2 size={10} />}
                                              className="text-text-muted hover:text-accent-error h-5 w-5 p-0"
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="bg-bg-tertiary rounded-lg p-4 text-center cursor-pointer hover:bg-bg-tertiary/80 transition-colors" onClick={() => onOpenShotModal(item.id)}>
                                    <p className="text-sm text-text-muted">{`点击添加分镜（总时长${item.shotMaxDuration === 30 ? 30 : 15}秒）`}</p>
                                  </div>
                                ),
                              },
                            ]}
                          />
                        </div>
                      ),
                    },
                    {
                      key: 'first_last_frame',
                      label: '首尾帧生成',
                      children: (
                        <div className="space-y-4 h-full">
                          {/* 首尾帧设定头部 */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Film size={14} className="text-text-muted" />
                              <span className="text-xs text-text-muted">首尾帧设定</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-text-muted whitespace-nowrap">图片模型</span>
                              <Select
                                value={item.shotImageModel || imageModels[0]?.id}
                                onChange={(val) => onShotImageModelChange(item.id, val)}
                                options={imageModels.map((m) => ({
                                  value: m.id,
                                  label: (
                                    <Tooltip title={m.description}>
                                      <span className="text-xs">{m.name}</span>
                                    </Tooltip>
                                  ),
                                  disabled: m.disabled,
                                }))}
                                size="small"
                                onMouseDown={(e) => e.stopPropagation()}
                                dropdownRender={(menu) => (
                                  <div onMouseDown={(e) => e.stopPropagation()}>{menu}</div>
                                )} popupMatchSelectWidth={false} />
                              <ModelPriceTag model={imageModels.find(m => m.id === (item.shotImageModel || imageModels[0]?.id))} />
                              <Button
                                size="small"
                                type="primary"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => onBatchGenerateFirstLastFrames?.(item.id)}
                                loading={item.isGeneratingFirstFrame || item.isGeneratingLastFrame}
                                disabled={item.isGeneratingFirstFrame || item.isGeneratingLastFrame}
                                className="text-xs ml-1"
                              >
                                批量生成首尾帧图片
                              </Button>
                            </div>
                          </div>
                          {/* 首帧区域 */}
                          <div className="bg-bg-tertiary rounded-lg p-3 border border-border/50">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-accent-primary">首帧</span>
                                <span className="text-xs text-text-muted">视频开始画面</span>
                              </div>
                            </div>
                            <div className="flex gap-3">
                              <div className={`relative w-24 flex-shrink-0 rounded-lg overflow-hidden bg-bg-secondary self-start ${is9x16 ? 'aspect-[9/16]' : canvasAspectClass}`}>
                              {item.firstFrameImageUrl ? (
                                <img
                                  src={item.firstFrameImageUrl}
                                  alt="首帧"
                                  className="w-full h-full object-cover cursor-pointer"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => onOpenImagePreview(item.firstFrameImageUrl!, '首帧预览')}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon size={16} className="text-text-muted" />
                                </div>
                              )}
                              {item.isGeneratingFirstFrame && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                                  <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                                  <span className="text-[10px] text-white">生成中...</span>
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 text-[10px] text-text-muted text-center bg-bg-secondary/80 py-0.5">首帧</div>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-2">
                              <VisualPromptEditor
                                value={item.firstFramePrompt || ''}
                                onChange={(val) => onFirstFramePromptChange(item.id, val)}
                                characters={characters}
                                scenes={scenes}
                                placeholder="描述首帧画面内容...@选择角色 #选择场景"
                                className="flex-1 text-sm"
                                editorClassName="bg-bg-secondary p-2"
                                style={{ minHeight: 0 }}
                                minRows={3}
                                maxRows={5}
                                sceneImageWidth={30}
                              />
                              <Button
                                size="small"
                                type="primary"
                                loading={item.isGeneratingFirstFrame}
                                disabled={item.isGeneratingFirstFrame || !item.firstFramePrompt}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => onGenerateFirstFrame(item.id)}
                                className="pointer-events-auto text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {item.firstFrameImageUrl ? '重新生成首帧' : '生成首帧'}
                              </Button>
                            </div>
                          </div>
                        </div>

                          {/* 尾帧区域 */}
                          <div className="bg-bg-tertiary rounded-lg p-3 border border-border/50">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-accent-secondary">尾帧</span>
                                <span className="text-xs text-text-muted">视频结束画面</span>
                              </div>
                            </div>
                            <div className="flex gap-3">
                              <div className={`relative w-24 flex-shrink-0 rounded-lg overflow-hidden bg-bg-secondary self-start ${is9x16 ? 'aspect-[9/16]' : canvasAspectClass}`}>
                              {item.lastFrameImageUrl ? (
                                <img
                                  src={item.lastFrameImageUrl}
                                  alt="尾帧"
                                  className="w-full h-full object-cover cursor-pointer"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => onOpenImagePreview(item.lastFrameImageUrl!, '尾帧预览')}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon size={16} className="text-text-muted" />
                                </div>
                              )}
                              {item.isGeneratingLastFrame && (
                                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                                  <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                                  <span className="text-[10px] text-white">生成中...</span>
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 text-[10px] text-text-muted text-center bg-bg-secondary/80 py-0.5">尾帧</div>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col gap-2">
                              <VisualPromptEditor
                                value={item.lastFramePrompt || ''}
                                onChange={(val) => onLastFramePromptChange(item.id, val)}
                                characters={characters}
                                scenes={scenes}
                                placeholder="描述尾帧画面内容...@选择角色 #选择场景"
                                className="flex-1 text-sm"
                                editorClassName="bg-bg-secondary p-2"
                                style={{ minHeight: 0 }}
                                minRows={3}
                                maxRows={5}
                                sceneImageWidth={30}
                              />
                              <Button
                                size="small"
                                type="primary"
                                loading={item.isGeneratingLastFrame}
                                disabled={item.isGeneratingLastFrame || !item.lastFramePrompt}
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={() => onGenerateLastFrame(item.id)}
                                className="pointer-events-auto text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {item.lastFrameImageUrl ? '重新生成尾帧' : '生成尾帧'}
                              </Button>
                            </div>
                          </div>
                        </div>

                          {/* 首尾帧视频提示词区域 */}
                          <div className="bg-bg-tertiary rounded-lg p-3 border border-border/50">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-accent-primary">首尾帧视频提示词</span>
                                <span className="text-xs text-text-muted">用于首尾帧视频生成</span>
                              </div>
                            </div>
                            <VisualPromptEditor
                              value={item.firstLastFrameVideoPrompt || ''}
                              onChange={(val) => onFirstLastFrameVideoPromptChange(item.id, val)}
                              characters={characters}
                              scenes={scenes}
                              placeholder="描述首尾帧视频的运动、转场等内容..."
                              className="text-sm"
                              editorClassName="bg-bg-secondary p-2"
                              minRows={3}
                              maxRows={6}
                              sceneImageWidth={30}
                            />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </div>

            {/* 右侧：场景图 + 视频控制 */}
            <CanvasSceneVideoPanel
              item={item}
              scene={scene}
              canvasAspectClass={canvasAspectClass}
              videoControl={videoControl}
              onVideoIndexChange={onVideoIndexChange}
              onDismissVideoError={onDismissVideoError}
            />
          </div>
      </Card>

      {/* 预制场景选择弹窗 */}
      <CanvasScenePresetModal
        open={presetModalOpen}
        onCancel={() => {
          setPresetModalOpen(false);
          setSelectedPresetId(null);
        }}
        onOk={handleApplyPreset}
        presetScenes={PRESET_SCENES}
        selectedPresetId={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        previewPrompt={previewPrompt}
        characters={characters}
        scenes={scenes}
        sceneChars={sceneChars}
        scene={scene}
      />
      {/* AI 创意弹窗：角色 + 场景 + 创意描述生成片段提示词 */}
      <CanvasSceneCreativeModal
        open={creativeModalOpen}
        onCancel={() => setCreativeModalOpen(false)}
        onOk={handleApplyCreative}
        characters={characters}
        scenes={scenes}
        sceneChars={sceneChars}
        scene={scene}
        ideaPrompt={creativeIdea}
        onIdeaPromptChange={setCreativeIdea}
        textModels={textModels}
        textModel={creativeModel || defaultTextModel}
        onTextModelChange={setCreativeModel}
        onGenerate={handleGenerateCreativePrompt}
        generating={creativeGenerating}
        generatedPrompt={creativePrompt}
        onGeneratedPromptChange={setCreativePrompt}
      />
      {/* 参考附件上传弹窗：与 generate 页面输入框左侧的上传弹窗保持一致 */}
      <AvatarUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onConfirm={async (file) => {
          await handleUploadAsset(file);
          setUploadDialogOpen(false);
        }}
        showAssetTab
        onSelectAsset={async (asset: UserMaterialItem) => {
          addAsset({ type: 'image', assetId: asset.sourceUrl, name: asset.name || '真人资产' });
          setUploadDialogOpen(false);
        }}
        showCharacterLibraryTab
        onSelectCharacterAsset={async (asset: UserMaterialItem) => {
          addAsset({ type: 'image', assetId: asset.sourceUrl, name: asset.name || '角色素材' });
          setUploadDialogOpen(false);
        }}
        showSceneLibraryTab
        onSelectSceneAsset={async (asset: UserMaterialItem) => {
          addAsset({ type: 'image', assetId: asset.sourceUrl, name: asset.name || '场景素材' });
          setUploadDialogOpen(false);
        }}
        title="上传"
        uploadLabel="参考"
        okText="确认添加"
        allowMedia
      />
      {/* 参考附件图片预览（点击图片附件缩略图放大） */}
      <ImagePreview
        images={imageAssetUrls}
        visible={imgPreviewOpen}
        currentIndex={imgPreviewIndex}
        onClose={() => setImgPreviewOpen(false)}
        title="参考附件"
      />
    </>
  );
};
