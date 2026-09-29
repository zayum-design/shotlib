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

import { useState, useMemo, useEffect } from 'react';
import { Button, Spin, Empty, Tabs, Select, Modal, Checkbox, Radio, Tooltip, message } from 'antd';
import { Users, MapPin, Globe, ArrowRight, Layers, Network, User, Contact, Image, Eye, Package } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWorkflowStore } from '../../stores/workflowStore';
import { CharacterCard } from '@/shared/components/ui/CharacterCard';
import { CharacterAssetPreview } from '@/shared/components/ui/CharacterAssetPreview';
import { SceneCard } from '@/shared/components/ui/SceneCard';
import { PropCard } from '@/shared/components/ui/PropCard';
import { EraDisplay } from '@/shared/components/ui/EraDisplay';
import { RelationshipNetworkDisplay } from '@/shared/components/ui/RelationshipNetworkDisplay';
import { ImagePreview } from '@/shared/components/ui/ImagePreview';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import { useResolvedImageUrls } from '../../hooks/useWorkflowImageResolver';
import { filterEpisodeProps } from '../../utils/workflowUtils';

interface ScriptSplitProps {
  onStepChange?: (step: number) => void;
}

export const ScriptSplit: React.FC<ScriptSplitProps> = ({
  onStepChange,
}) => {
  const {
    script,
    characters,
    scenes,
    props,
    era,
    relationshipNetwork,
    episodes,
    isParsingScript,
    setCurrentStep,
    generateEpisodes,
    batchGenerateAvatars,
    batchGeneratePortraits,
    batchGenerateScenes,
    batchGenerateProps,
    activeCharacterIds,
    activeSceneIds,
    activePropIds,
    imageModels,
    imageModel,
    currentProjectId,
    videoModel,
    videoModels,
    episodeMaxDuration,
    setEpisodeMaxDuration,
  } = useWorkflowStore();

  const [activeTab, setActiveTab] = useState('characters');
  const [batchModel, setBatchModel] = useState(imageModel);

  // 模型列表异步加载完成后同步批量模型：
  // 优先级 之前选中的（batchModel 仍在列表中则保留）→ 推荐模型 → 当前 imageModel → 列表第一个
  useEffect(() => {
    if (!imageModels.length) return;
    if (imageModels.some((m) => m.id === batchModel && !m.disabled)) return;
    const recommended = imageModels.find((m) => m.recommended && !m.disabled);
    const fallback = imageModels.find((m) => m.id === imageModel && !m.disabled) || imageModels.find((m) => !m.disabled);
    setBatchModel(recommended?.id || fallback?.id || imageModel);
  }, [imageModels]); // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);

  // 图片预览状态
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');

  // 批量场景图视角选择
  const [sceneViewModalOpen, setSceneViewModalOpen] = useState(false);
  const [selectedSceneViews, setSelectedSceneViews] = useState<number[]>([0]);
  const [isBatchGeneratingScenes, setIsBatchGeneratingScenes] = useState(false);

  // 按当前分集活跃ID过滤（旧数据无活跃ID时回退按本集剧本名称匹配，≥2字，
  // 避免多集项目下其他分集新增的资产串进本分集列表）
  const matchNameInScript = (name?: string) => {
    const n = (name || '').trim();
    return n.length >= 2 && !!script?.includes(n);
  };
  const displayedCharacters = activeCharacterIds?.length
    ? characters.filter(c => activeCharacterIds.includes(c.id))
    : characters.filter(c => matchNameInScript(c.name));
  const displayedScenes = activeSceneIds?.length
    ? scenes.filter(s => activeSceneIds.includes(s.id))
    : scenes.filter(s => matchNameInScript(s.name));

  // 道具为项目级资产，按当前分集活跃ID过滤（与角色/场景同机制；旧数据回退按剧本匹配）
  const displayedProps = filterEpisodeProps(props, activePropIds, script);

  // 批量生成道具图确认弹窗（流程与场景批量生成对齐：弹窗确认 → store 批量任务）
  const [propConfirmModalOpen, setPropConfirmModalOpen] = useState(false);
  const [isBatchGeneratingProps, setIsBatchGeneratingProps] = useState(false);
  const pendingPropCount = displayedProps.filter((p) => !p.imageUrls?.length && !p.isGenerating).length;

  // 批量解析场景图片资产
  const sceneAssetIds = useMemo(
    () => displayedScenes.flatMap((s) => s.imageAssetIds || []).filter(Boolean) as string[],
    [displayedScenes],
  );
  const { getUrl } = useResolvedImageUrls(sceneAssetIds);
  const getSceneImageUrl = (scene: typeof displayedScenes[number], index: number) =>
    getUrl(scene.imageAssetIds?.[index]) || scene.imageUrls?.[index] || '';

  // 批量解析道具图片资产（与场景同一解析 hook，资产 ID 互不重叠）
  const propAssetIds = useMemo(
    () => displayedProps.flatMap((p) => p.imageAssetIds || []).filter(Boolean) as string[],
    [displayedProps],
  );
  const { getUrl: getPropUrl } = useResolvedImageUrls(propAssetIds);
  const getPropImageUrl = (prop: typeof displayedProps[number], index: number) =>
    getPropUrl(prop.imageAssetIds?.[index]) || prop.imageUrls?.[index] || '';

  const displayedRelationships = activeCharacterIds?.length && relationshipNetwork
    ? {
        ...relationshipNetwork,
        relationships: relationshipNetwork.relationships.filter(
          rel => activeCharacterIds.includes(rel.fromCharacterId) && activeCharacterIds.includes(rel.toCharacterId)
        ),
      }
    : relationshipNetwork;

  // 第4步完成后锁定（片段已生成，不可重新分解）
  const isLocked = episodes.length > 0;

  // 批量生成头像：全部已有头像时，弹出与单个「重新生成头像」一致的二次确认
  const handleBatchGenerateAvatars = () => {
    const allHaveAvatars = displayedCharacters.length > 0 && displayedCharacters.every(c => c.avatarImages?.length);
    if (!allHaveAvatars) {
      batchGenerateAvatars(batchModel);
      return;
    }
    (window as any).__avatarClearChecked = false;
    Modal.confirm({
      title: '更换头像',
      content: (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">头像生成后会导致多视图和形象照与新头像不匹配，请选择处理方式：</p>
          <Checkbox
            className="avatar-clear-checkbox"
            onChange={(e) => {
              (window as any).__avatarClearChecked = e.target.checked;
            }}
          >
            清空多视图和形象照
          </Checkbox>
        </div>
      ),
      okText: '确定',
      cancelText: '取消',
      onOk() {
        const shouldClear = !!(window as any).__avatarClearChecked;
        batchGenerateAvatars(batchModel, { force: true, clearDerived: shouldClear });
      },
    });
  };

  // 批量生成形象照：已有多视图/形象照时，二次确认后清空并重新生成
  const handleBatchGeneratePortraits = () => {
    const hasDerived = displayedCharacters.some(
      c => c.multiViewImages?.some(img => img.imageUrl) || c.fullBodyImages?.some(img => img.imageUrl),
    );
    if (!hasDerived) {
      batchGeneratePortraits(batchModel);
      return;
    }
    Modal.confirm({
      title: '重新生成形象照',
      content: '将清空现有的多视图和形象照，已生成的图片会被清除并重新生成，是否继续？',
      okText: '确定',
      cancelText: '取消',
      onOk() {
        batchGeneratePortraits(batchModel, true);
      },
    });
  };

  const handleNext = () => {
    if (displayedCharacters.length > 0 || displayedScenes.length > 0) {
      setConfirmOpen(true);
    }
  };

  // 片段时长切换:30s 仅长片段模型(如 seedance2.5)支持,按模型配置的 duration.max 判断
  const handleDurationChange = (seconds: number) => {
    setEpisodeMaxDuration(seconds);
    if (seconds > 15) {
      const current = videoModels.find((m) => m.id === videoModel);
      if (current && (current.duration?.max ?? 15) < seconds) {
        message.warning('当前视频模型不支持 30s 片段,请在片段生成步骤切换到 seedance2.5 模型');
      }
    }
  };

  const handleConfirm = async () => {
    setConfirmLoading(true);
    setConfirmOpen(false);
    setCurrentStep(3);
    onStepChange?.(3);
    if (episodes.length === 0) {
      await generateEpisodes();
    }
    setConfirmLoading(false);
  };

  const openPreview = (images: string[], index: number, title: string) => {
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewTitle(title);
    setPreviewOpen(true);
  };

  if (!script) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="请先在步骤1输入剧本"
        className="text-text-muted"
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* 加载状态 */}
      {isParsingScript && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Spin size="large" />
            <p className="mt-4 text-text-secondary">正在分析剧本内容...</p>
            <p className="text-xs text-text-muted mt-1">提取角色、场景和故事背景信息</p>
          </div>
        </div>
      )}

      {/* 剧本分解结果 */}
      {!isParsingScript && (displayedCharacters.length > 0 || displayedScenes.length > 0 || era) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          {/* 锁定提示 */}
          {isLocked && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm">
              <Layers size={16} />
              <span>片段已生成，当前步骤锁定不可重新分解。如需修改请返回前面步骤重新生成。</span>
            </div>
          )}
          {/* Tab 导航 */}
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            className="script-split-tabs"
            tabBarExtraContent={
              <div className="flex items-center gap-2">
                <Select
                  value={batchModel}
                  onChange={setBatchModel}
                  options={imageModels.map((m) => ({
                    value: m.id,
                    label: m.name,
                    disabled: m.disabled,
                  }))}
                  size="small"
                  placeholder="图片模型" popupMatchSelectWidth={false} />
                <ModelPriceTag model={imageModels.find(m => m.id === batchModel)} />
                {activeTab === 'characters' && (
                  <>
                    <Button
                      size="small"
                      disabled={isLocked || isParsingScript}
                      onClick={handleBatchGenerateAvatars}
                      icon={<User size={14} />}
                      className="border-border"
                    >
                      批量生成头像
                    </Button>
                    <Button
                      size="small"
                      disabled={isLocked || isParsingScript || !displayedCharacters.some(c => c.avatarImages?.length)}
                      onClick={handleBatchGeneratePortraits}
                      icon={<Contact size={14} />}
                      className="border-border"
                    >
                      批量生成形象照
                    </Button>
                  </>
                )}
                {activeTab === 'scenes' && (
                  <Button
                    size="small"
                    loading={isBatchGeneratingScenes}
                    disabled={isLocked || isParsingScript || displayedScenes.every(s => s.imageUrls?.length) || isBatchGeneratingScenes}
                    onClick={() => {
                      setSelectedSceneViews([0]);
                      setSceneViewModalOpen(true);
                    }}
                    icon={<Image size={14} />}
                    className="border-border"
                  >
                    批量生成场景图
                  </Button>
                )}
                {activeTab === 'props' && (
                  <Button
                    size="small"
                    loading={isBatchGeneratingProps}
                    disabled={isLocked || isParsingScript || displayedProps.every(p => p.imageUrls?.length) || isBatchGeneratingProps}
                    onClick={() => setPropConfirmModalOpen(true)}
                    icon={<Package size={14} />}
                    className="border-border"
                  >
                    批量生成道具图
                  </Button>
                )}
              </div>
            }
            items={[
              {
                key: 'characters',
                label: (
                  <div className="flex items-center gap-2">
                    <Users size={16} />
                    <span>角色 ({displayedCharacters.length})</span>
                  </div>
                ),
                children: (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    {displayedCharacters.length > 0 ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {displayedCharacters.map((character, index) => (
                          <motion.div
                            key={character.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            <CharacterCard character={character} />
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <Empty description="暂无角色数据" className="text-text-muted py-8" />
                    )}
                  </motion.div>
                ),
              },
              {
                key: 'scenes',
                label: (
                  <div className="flex items-center gap-2">
                    <MapPin size={16} />
                    <span>场景 ({displayedScenes.length})</span>
                  </div>
                ),
                children: (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    {displayedScenes.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {displayedScenes.map((scene, index) => (
                          <motion.div
                            key={scene.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            <SceneCard scene={scene} />
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <Empty description="暂无场景数据" className="text-text-muted py-8" />
                    )}
                  </motion.div>
                ),
              },
              {
                key: 'props',
                label: (
                  <div className="flex items-center gap-2">
                    <Package size={16} />
                    <span>道具 ({displayedProps.length})</span>
                  </div>
                ),
                children: (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    {displayedProps.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {displayedProps.map((prop, index) => (
                          <motion.div
                            key={prop.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05 }}
                          >
                            <PropCard prop={prop} />
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <Empty description="暂无道具数据" className="text-text-muted py-8" />
                    )}
                  </motion.div>
                ),
              },
              {
                key: 'relationships',
                label: (
                  <div className="flex items-center gap-2">
                    <Network size={16} />
                    <span>关系网</span>
                  </div>
                ),
                children: (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {displayedRelationships && displayedRelationships.relationships.length > 0 ? (
                      <RelationshipNetworkDisplay network={displayedRelationships} />
                    ) : (
                      <Empty description="暂无人际关系网数据" className="text-text-muted py-8" />
                    )}
                  </motion.div>
                ),
              },
              {
                key: 'era',
                label: (
                  <div className="flex items-center gap-2">
                    <Globe size={16} />
                    <span>故事背景</span>
                  </div>
                ),
                children: (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {era ? (
                      <EraDisplay era={era} />
                    ) : (
                      <Empty description="暂无故事背景数据" className="text-text-muted py-8" />
                    )}
                  </motion.div>
                ),
              },
            ]}
          />

          {/* 底部导航按钮 */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            {!isLocked && activeTab !== 'characters' && (
              <>
                {activeTab === 'scenes' ? (
                  <Button
                    size="large"
                    onClick={() => setActiveTab('characters')}
                    className="border-border"
                  >
                    上一步角色确认
                  </Button>
                ) : activeTab === 'props' ? (
                  <Button
                    size="large"
                    onClick={() => setActiveTab('scenes')}
                    className="border-border"
                  >
                    上一步场景确认
                  </Button>
                ) : activeTab === 'relationships' ? (
                  <Button
                    size="large"
                    onClick={() => setActiveTab('props')}
                    className="border-border"
                  >
                    上一步道具确认
                  </Button>
                ) : (
                  <Button
                    size="large"
                    onClick={() => setActiveTab('relationships')}
                    className="border-border"
                  >
                    上一步关系网确定
                  </Button>
                )}
              </>
            )}

            {isLocked ? (
              <Button
                type="primary"
                size="large"
                disabled
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                片段已生成
              </Button>
            ) : activeTab === 'characters' ? (
              <Button
                type="primary"
                size="large"
                onClick={() => setActiveTab('scenes')}
                icon={<ArrowRight size={18} />}
                iconPlacement="end"
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                下一步场景确认
              </Button>
            ) : activeTab === 'scenes' ? (
              <Button
                type="primary"
                size="large"
                onClick={() => setActiveTab('props')}
                icon={<ArrowRight size={18} />}
                iconPlacement="end"
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                下一步道具确认
              </Button>
            ) : activeTab === 'props' ? (
              <Button
                type="primary"
                size="large"
                onClick={() => setActiveTab('relationships')}
                icon={<ArrowRight size={18} />}
                iconPlacement="end"
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                下一步关系网确定
              </Button>
            ) : activeTab === 'relationships' ? (
              <Button
                type="primary"
                size="large"
                onClick={() => setActiveTab('era')}
                icon={<ArrowRight size={18} />}
                iconPlacement="end"
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                下一步故事背景确定
              </Button>
            ) : (
              <>
                <Tooltip title="30s 仅支持 seedance2.5 模型" placement="top">
                  <Radio.Group
                    optionType="button"
                    buttonStyle="solid"
                    size="large"
                    value={episodeMaxDuration}
                    onChange={(e) => handleDurationChange(e.target.value)}
                    options={[
                      { value: 15, label: '15秒' },
                      { value: 30, label: '30秒' },
                    ]}
                  />
                </Tooltip>
                <Button
                  type="primary"
                  size="large"
                  onClick={handleNext}
                  icon={<ArrowRight size={18} />}
                  iconPlacement="end"
                  className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
                >
                  生成片段
                </Button>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* 未解析状态 */}
      {!isParsingScript && displayedCharacters.length === 0 && displayedScenes.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <Layers size={48} className="mx-auto mb-4 opacity-50" />
          <p>剧本解析中，请稍候...</p>
        </div>
      )}

      {/* 资产确认弹窗 */}
      <Modal
        title="资产确认"
        open={confirmOpen}
        onOk={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
        okText="确认进入下一步"
        cancelText="取消"
        confirmLoading={confirmLoading}
        width={900}
        styles={{ body: { maxHeight: '65vh', overflow: 'auto' } }}
      >
        <div className="space-y-6">
          {/* 角色资产 */}
          {displayedCharacters.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Users size={16} />
                角色资产（{displayedCharacters.length}）
              </h3>
              <div className="flex flex-col gap-3">
                {displayedCharacters.map((char) => (
                  <CharacterAssetPreview
                    key={char.id}
                    character={char}
                    projectId={currentProjectId}
                    onPreview={openPreview}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 场景资产 */}
          {displayedScenes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <MapPin size={16} />
                场景资产（{displayedScenes.length}）
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {displayedScenes.map((scene) => (
                  <div key={scene.id} className="bg-bg-tertiary rounded-lg p-2 space-y-2">
                    <div className="text-xs font-medium text-text-primary truncate">{scene.name}</div>
                    {getSceneImageUrl(scene, 0) ? (
                      <img
                        src={getSceneImageUrl(scene, 0)}
                        alt={`${scene.name}场景图`}
                        className="w-full aspect-video object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => openPreview(
                          Array.from({ length: Math.max(scene.imageUrls?.length || 0, scene.imageAssetIds?.length || 0) })
                            .map((_, i) => getSceneImageUrl(scene, i))
                            .filter(Boolean),
                          0,
                          `${scene.name} - 场景图`
                        )}
                      />
                    ) : (
                      <div className="w-full aspect-video bg-bg-secondary rounded flex items-center justify-center text-[10px] text-text-muted">
                        待生成
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 道具资产 */}
          {displayedProps.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Package size={16} />
                道具资产（{displayedProps.length}）
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {displayedProps.map((prop) => (
                  <div key={prop.id} className="bg-bg-tertiary rounded-lg p-2 space-y-2">
                    <div className="text-xs font-medium text-text-primary truncate">{prop.name}</div>
                    {getPropImageUrl(prop, 0) ? (
                      <img
                        src={getPropImageUrl(prop, 0)}
                        alt={`${prop.name}道具图`}
                        className="w-full aspect-video object-cover rounded cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => openPreview(
                          Array.from({ length: Math.max(prop.imageUrls?.length || 0, prop.imageAssetIds?.length || 0) })
                            .map((_, i) => getPropImageUrl(prop, i))
                            .filter(Boolean),
                          0,
                          `${prop.name} - 道具图`
                        )}
                      />
                    ) : (
                      <div className="w-full aspect-video bg-bg-secondary rounded flex items-center justify-center text-[10px] text-text-muted">
                        待生成
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 图片预览 */}
      <ImagePreview
        images={previewImages}
        visible={previewOpen}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        title={previewTitle}
      />

      {/* 批量场景图视角选择弹窗 */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-accent-primary" />
            <span>批量生成场景图 - 选择视角</span>
          </div>
        }
        open={sceneViewModalOpen}
        onOk={async () => {
          setSceneViewModalOpen(false);
          setIsBatchGeneratingScenes(true);
          try {
            await batchGenerateScenes(batchModel, selectedSceneViews);
          } finally {
            setIsBatchGeneratingScenes(false);
          }
        }}
        onCancel={() => setSceneViewModalOpen(false)}
        okText="确认生成"
        cancelText="取消"
        okButtonProps={{ disabled: selectedSceneViews.length === 0 }}
      >
        <div className="py-4">
          <p className="text-sm text-text-secondary mb-4">
            请选择需要生成的场景视角，默认只生成正面视角。将为 {displayedScenes.filter(s => !s.imageUrls?.length).length} 个未生成场景各生成 {selectedSceneViews.length} 张图片。
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: '正面', angle: 'front', description: '正前方视角，展示场景的正面全貌' },
              { name: '左侧', angle: 'left', description: '正左方视角，从场景左侧90度角展示' },
              { name: '右侧', angle: 'right', description: '正右方视角，从场景右侧90度角展示' },
              { name: '背面', angle: 'back', description: '正后方视角，从场景背面180度展示' },
            ].map((view, index) => (
              <div
                key={view.angle}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedSceneViews.includes(index)
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-border hover:border-accent-primary/50'
                }`}
                onClick={() => {
                  setSelectedSceneViews((prev) =>
                    prev.includes(index)
                      ? prev.filter((v) => v !== index)
                      : [...prev, index]
                  );
                }}
              >
                <div className="flex items-center gap-2">
                  <Checkbox checked={selectedSceneViews.includes(index)} />
                  <span className="font-medium text-sm">{view.name}</span>
                </div>
                <p className="text-xs text-text-muted mt-1 ml-6">{view.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-text-muted bg-bg-tertiary rounded p-2">
            已选择 {selectedSceneViews.length} 个视角，每个场景将生成 {selectedSceneViews.length} 张图片
          </div>
        </div>
      </Modal>

      {/* 批量生成道具图确认弹窗（与场景批量流程对齐） */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <Package size={18} className="text-accent-primary" />
            <span>批量生成道具图</span>
          </div>
        }
        open={propConfirmModalOpen}
        onOk={async () => {
          setPropConfirmModalOpen(false);
          setIsBatchGeneratingProps(true);
          try {
            await batchGenerateProps(batchModel);
          } finally {
            setIsBatchGeneratingProps(false);
          }
        }}
        onCancel={() => setPropConfirmModalOpen(false)}
        okText="确认生成"
        cancelText="取消"
      >
        <div className="py-4">
          <p className="text-sm text-text-secondary mb-4">
            将为 {pendingPropCount} 个未生成道具各生成 4 张候选图片。
          </p>
          <div className="text-xs text-text-muted bg-bg-tertiary rounded p-2">
            生成任务将加入任务队列并发执行，可在任务面板中查看进度
          </div>
        </div>
      </Modal>
    </div>
  );
};
