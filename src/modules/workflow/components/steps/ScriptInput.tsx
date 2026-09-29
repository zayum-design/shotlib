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

import { useState, useMemo, useEffect, useRef } from 'react';
import { Input, Button, Upload, Tag, Tooltip } from 'antd';
import { Upload as UploadIcon, Sparkles, ArrowRight, FileText, Brain, Wrench, Flame, ChevronDown, Palette, Shuffle, XCircle, Search, Compass, RotateCcw, Clapperboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAgentTypes, type SubStyleItem, type ArtStyleItem, type HotScriptItem } from '@/modules/workflow/hooks/useAgentTypes';
import { useGenres, type GenreItem } from '@/modules/workflow/hooks/useGenres';
import { useSkills } from '@/modules/workflow/hooks/useSkills';
import { useDevelopmentDirections, type DevelopmentCategory, type DevelopmentDirection } from '@/modules/workflow/hooks/useDevelopmentDirections';
import { DevelopmentDirectionModal } from '@/modules/workflow/components/DevelopmentDirectionModal';
import { message } from '@/shared/utils/message';

const { TextArea } = Input;

interface ScriptInputProps {
  onStepChange?: (step: number) => void;
}

export const ScriptInput: React.FC<ScriptInputProps> = ({ onStepChange }) => {
  const {
    topic,
    script,
    isGeneratingScript,
    agentType,
    artStyle: storeArtStyle,
    skills,
    genre,
    creationMode,
    previousEpisodeScript,
    previousEpisodeSummary,
    isEnding,
    currentStep,
    setTopic,
    generateScript,
    setScript,
    setCurrentStep,
    setAgentType,
    setArtStyle,
    setSkills,
    setGenre,
    setCreationMode,
    setIsEnding,

  } = useWorkflowStore();

  // 是否是从上一集延续的新分集（配置继承自上一集，不可修改）
  const isInherited = !!(previousEpisodeSummary || previousEpisodeScript);
  // 剧本生成完成后锁定输入（第1集剧本生成后不可修改配置）
  const isLocked = !!script;
  // 是否已经过了剧本分解步骤（currentStep >= 2 表示已解析/锁定）
  const isParsed = currentStep >= 2;

  const [subStyle, setSubStyle] = useState<string>(''); // 子风格选择
  const [randomSeed, setRandomSeed] = useState<number>(0); // 用于随机热门剧本
  const [searchKeyword, setSearchKeyword] = useState(''); // 搜索关键字
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false); // 搜索下拉开关
  const searchRef = useRef<HTMLDivElement>(null);
  const { agentTypes, loading: loadingAgentTypes } = useAgentTypes();
  const { genres, loading: loadingGenres } = useGenres();
  const { skills: skillOptions, loading: loadingSkills } = useSkills();
  const { categories: directionCategories, isLoading: loadingDirections } = useDevelopmentDirections();
  const [directionModalOpen, setDirectionModalOpen] = useState(false);

  // 获取当前选中的主风格
  const currentAgentType = useMemo(() => {
    return agentTypes.find((t) => t.id === agentType);
  }, [agentTypes, agentType]);

  // 获取当前主风格下的子风格列表
  const currentSubStyles = useMemo(() => {
    return currentAgentType?.subStyles || [];
  }, [currentAgentType]);

  // 获取当前主风格下的画风列表
  const currentArtStyles = useMemo(() => {
    return currentAgentType?.artStyles || [];
  }, [currentAgentType]);

  // 获取当前选中子风格的热门剧本（支持随机排序）
  const hotScripts = useMemo(() => {
    if (!subStyle || !currentAgentType?.subStyles) return [];
    const selectedSubStyle = currentAgentType.subStyles.find(s => s.id === subStyle);
    const scripts = selectedSubStyle?.hotScripts || [];
    if (scripts.length === 0) return [];
    // 随机打乱数组，每次 randomSeed 变化时重新计算
    const shuffled = [...scripts].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
  }, [subStyle, currentAgentType, randomSeed]);

  // 所有风格下的全部热门剧本（用于搜索）
  const allHotScripts = useMemo(() => {
    const all: HotScriptItem[] = [];
    agentTypes.forEach((at) => {
      at.subStyles?.forEach((ss) => {
        ss.hotScripts?.forEach((s) => all.push(s));
      });
    });
    // 去重（按 content）
    const seen = new Set<string>();
    return all.filter((s) => {
      if (seen.has(s.content)) return false;
      seen.add(s.content);
      return true;
    });
  }, [agentTypes]);

  // 搜索过滤后的剧本列表
  const searchedScripts = useMemo(() => {
    if (!searchKeyword.trim()) return [];
    const kw = searchKeyword.toLowerCase();
    return allHotScripts
      .filter((s) => s.title.toLowerCase().includes(kw) || s.content.toLowerCase().includes(kw))
      .slice(0, 10);
  }, [searchKeyword, allHotScripts]);

  // 点击搜索外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 随机刷新热门剧本
  const handleRandomHotScripts = () => {
    setRandomSeed(prev => prev + 1);
  };

  // 类型列表加载完成后，默认选中第一个剧本类型
  useEffect(() => {
    if (genres.length > 0 && !genre) {
      setGenre(genres[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genres, genre]);

  const handleGenreChange = (genreId: string) => {
    setGenre(genreId);
  };

  // 在组件加载和 agentTypes 加载完成后，设置默认子风格和画风
  useEffect(() => {
    if (agentTypes.length > 0) {
      const currentType = agentTypes.find((t) => t.id === agentType);
      
      // 设置默认子风格（第一个）
      if (currentType?.subStyles && currentType.subStyles.length > 0 && !subStyle) {
        setSubStyle(currentType.subStyles[0].id);
      }
      
      // 设置默认画风
      if (currentType?.artStyles && currentType.artStyles.length > 0 && !storeArtStyle) {
        const firstArtStyle = currentType.artStyles[0];
        setArtStyle(firstArtStyle.id, firstArtStyle.promptHint);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTypes, agentType, storeArtStyle]);

  const handleAgentTypeChange = (type: string) => {
    setAgentType(type);
    // 找到新选中风格
    const newAgentType = agentTypes.find((t) => t.id === type);
    
    // 设置默认子风格（第一个）
    if (newAgentType?.subStyles && newAgentType.subStyles.length > 0) {
      setSubStyle(newAgentType.subStyles[0].id);
    } else {
      setSubStyle('');
    }
    
    // 设置默认画风（第一个）
    const artStyles = newAgentType?.artStyles || [];
    if (artStyles.length > 0) {
      setArtStyle(artStyles[0].id, artStyles[0].promptHint);
    } else {
      setArtStyle('', '');
    }
  };

  const handleSubStyleChange = (subStyleId: string) => {
    setSubStyle(subStyleId);
  };

  const handleArtStyleChange = (artStyleId: string) => {
    // 找到选中的画风对象，获取其 promptHint
    const selectedArtStyle = currentArtStyles.find((art) => art.id === artStyleId);
    setArtStyle(artStyleId, selectedArtStyle?.promptHint); // 保存到store
  };

  const handleSkillToggle = (skill: string) => {
    const newSkills = skills.includes(skill)
      ? skills.filter(s => s !== skill)
      : [...skills, skill];
    setSkills(newSkills);
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setScript(content);
      message.success('剧本上传成功');
      // 上传成功后自动进入第2步（剧本编辑）
      setCurrentStep(1);
      onStepChange?.(1);
    };
    reader.readAsText(file);
    return false;
  };

  const handleHotScriptClick = (content: string) => {
    setTopic(content);
    message.info('热门剧本已填充到输入框');
  };

  const handleDirectionClick = (category: DevelopmentCategory, direction: DevelopmentDirection) => {
    setTopic(direction.name);
    setIsEnding(direction.isEnding);
    message.info(direction.isEnding ? '已选择大结局方向' : '已选择分集发展方向');
    setDirectionModalOpen(false);
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      message.warning('请输入话题或故事梗概');
      return;
    }
    // 剧本类型是必选的，默认已选择第一个，但如果没有选则报错
    if (!genre) {
      message.warning('请选择剧本类型');
      return;
    }
    // 画风是必选的，默认已选择第一个，但如果没有选则报错
    if (!storeArtStyle) {
      message.warning('请选择画风');
      return;
    }
    const success = await generateScript(subStyle || undefined, storeArtStyle);
    if (success) {
      setCurrentStep(1);
      onStepChange?.(1);
    }
  };

  const handleRegenerateStory = async () => {
    if (!topic.trim()) {
      message.warning('请输入话题或故事梗概');
      return;
    }
    if (!genre) {
      message.warning('请选择剧本类型');
      return;
    }
    if (!storeArtStyle) {
      message.warning('请选择画风');
      return;
    }
    const success = await generateScript(subStyle || undefined, storeArtStyle, true);
    if (success) {
      setCurrentStep(1);
      onStepChange?.(1);
    }
  };

  return (
    <div className="space-y-6 relative">
      {/* 输入区域 */}
      <div className="space-y-6">
        {/* 继承提示 */}
        {isInherited && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 text-sm">
            <FileText size={16} />
            <span>本集配置继承自上一集，不可修改。点击「生成剧本」即可基于上一集剧情创作下一集。</span>
          </div>
        )}

        {/* 剧本生成后锁定提示 */}
        {isLocked && !isInherited && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-sm">
            <FileText size={16} />
            <span>剧本已生成，步骤1配置已锁定。如需修改请重新生成剧本（将清空后续步骤数据）。</span>
          </div>
        )}

        {/* 风格配置：仅在第1集显示，第2集+隐藏（项目级资产） */}
        {!isInherited && (
          <>
            {/* 创作模式选择（项目级，决定剧本结构规则：钩子爽点 / 完整叙事 / 氛围情绪） */}
            <div>
              <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
                <Clapperboard size={16} className="mr-2 text-accent-primary" />
                选择创作模式
                <span className="ml-2 text-xs text-text-muted">决定剧本的结构规则（项目级，全部分集统一）</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { id: 'drama', name: '付费短剧', icon: '🎬', desc: '黄金三秒钩子、反转爽点、集末悬念留钩，驱动付费追更' },
                  { id: 'story', name: '故事短片', icon: '📖', desc: '开端-发展-高潮-结局完整叙事，结尾可收束留白，无钩子绑架' },
                  { id: 'mood', name: '氛围情绪短片', icon: '🌙', desc: '弱剧情重氛围，情绪曲线+视觉诗意，治愈/孤独/怀念等情绪表达' },
                ].map((mode) => {
                  const isSelected = (creationMode || 'drama') === mode.id;
                  return (
                    <Tooltip key={mode.id} title={mode.desc} placement="top">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => setCreationMode(mode.id)}
                        className={`
                          px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200 text-left
                          flex items-start gap-2
                          ${isSelected
                            ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                            : 'bg-bg-tertiary border-border text-text-muted hover:border-border-active'
                          }
                          ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <span>{mode.icon}</span>
                        <span>
                          <span className="block">{mode.name}</span>
                          <span className="block text-xs font-normal opacity-70 mt-0.5 line-clamp-2">{mode.desc}</span>
                        </span>
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
            </div>

            {/* 剧本类型选择 */}
            <div>
              <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
                <Clapperboard size={16} className="mr-2 text-accent-primary" />
                选择剧本类型
                {loadingGenres && <span className="ml-2 text-xs text-text-muted">加载中...</span>}
                <span className="ml-2 text-xs text-text-muted">不同类型使用不同的专属创作提示词</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {genres.map((g: GenreItem) => (
                  <Tooltip key={g.id} title={g.description} placement="top">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleGenreChange(g.id)}
                      className={`
                        px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200
                        flex items-center gap-2
                        ${genre === g.id
                          ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                          : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-active'
                        }
                        ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <span>{g.icon}</span>
                      <span>{g.name}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* 智能体类型选择 */}
            <div>
              <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
                <Brain size={16} className="mr-2 text-accent-primary" />
                选择电影风格
                {loadingAgentTypes && <span className="ml-2 text-xs text-text-muted">加载中...</span>}
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {agentTypes.map((type: { id: string; name: string; icon: string; description: string }) => (
                  <Tooltip key={type.id} title={type.description} placement="top">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleAgentTypeChange(type.id)}
                      className={`
                        px-3 py-2 rounded-lg border text-sm font-medium transition-all duration-200
                        flex items-center gap-2
                        ${agentType === type.id
                          ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                          : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-active'
                        }
                        ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <span>{type.icon}</span>
                      <span>{type.name}</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* 子风格选择 - 联动显示 */}
            <AnimatePresence>
              {currentSubStyles.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
                    <ChevronDown size={16} className="mr-2 text-accent-primary" />
                    选择子风格（可选）
                    <span className="ml-2 text-xs text-text-muted">更精细的风格定位</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {currentSubStyles.map((sub: SubStyleItem) => (
                      <Tooltip key={sub.id} title={sub.description} placement="top">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleSubStyleChange(sub.id)}
                          className={`
                            px-3 py-1.5 rounded-full border text-sm transition-all duration-200
                            ${subStyle === sub.id
                              ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                              : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-active'
                            }
                            ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          {sub.name}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 画风选择 - 联动显示 */}
            <AnimatePresence>
              {currentArtStyles.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
                    <Palette size={16} className="mr-2 text-accent-primary" />
                    选择画风
                    <span className="ml-2 text-xs text-text-muted">默认为第一个画风</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {currentArtStyles.map((art: ArtStyleItem) => (
                      <Tooltip key={art.id} title={art.promptHint} placement="top">
                        <button
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleArtStyleChange(art.id)}
                          className={`
                            px-3 py-1.5 rounded-full border text-sm transition-all duration-200
                            ${storeArtStyle === art.id
                              ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                              : 'bg-bg-tertiary border-border text-text-secondary hover:border-border-active'
                            }
                            ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          {art.name}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* 输入话题或故事梗概 */}
        <div>
          <div className="flex items-center justify-between mb-2 max-md:flex-wrap max-md:gap-2">
            <label className="block text-sm font-medium text-text-secondary">
              {isInherited ? '主题或故事方向（基于上一集剧情续写）' : '输入话题或故事梗概'}
            </label>
            <Button
              type="text"
              size="small"
              icon={<Compass size={14} />}
              loading={loadingDirections}
              onClick={() => {
                setDirectionModalOpen(true);
              }}
              disabled={isLocked}
              className="text-text-muted hover:text-accent-primary"
            >
              发展方向
            </Button>
          </div>
          <TextArea
            value={topic}
            onChange={(e) => !isLocked && setTopic(e.target.value)}
            placeholder={isInherited ? "例如：上一集结尾的悬念揭晓，主角面临新的挑战..." : "例如：一位年轻女记者与成功企业家之间的悬疑爱情故事..."}
            autoSize={{ minRows: 4, maxRows: 8 }}
            readOnly={isLocked}
            className={`bg-bg-tertiary border-border rounded-lg ${isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          {isEnding && (
            <div className="mt-2 text-xs text-amber-500 flex items-center gap-1">
              <Flame size={12} />
              <span>已标记为「大结局」，生成剧本时将作为最终集收尾</span>
            </div>
          )}
        </div>

        {/* 热门剧本推荐 */}
        {hotScripts.length > 0 && !isInherited && (
          <div>
            <div className="flex items-center justify-between mb-3 max-md:flex-col max-md:items-start max-md:gap-2">
              <label className="flex items-center text-sm font-medium text-text-secondary">
                <Flame size={16} className="mr-2 text-orange-500" />
                热门剧本推荐
                <span className="ml-2 text-xs text-text-muted">点击即可使用</span>
              </label>
              <div className="flex items-center gap-2">
                {/* 搜索框 */}
                <div ref={searchRef} className="relative">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-bg-tertiary border border-border hover:border-accent-primary/50 transition-colors">
                    <Search size={14} className="text-text-muted flex-shrink-0" />
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={(e) => {
                        setSearchKeyword(e.target.value);
                        setSearchDropdownOpen(true);
                      }}
                      onFocus={() => setSearchDropdownOpen(true)}
                      placeholder="搜索预制剧本..."
                      className="bg-transparent border-none outline-none text-xs text-text-primary placeholder:text-text-muted w-32"
                    />
                    {searchKeyword && (
                      <button
                        onClick={() => { setSearchKeyword(''); setSearchDropdownOpen(false); }}
                        className="flex-shrink-0"
                      >
                        <XCircle size={12} className="text-text-muted hover:text-text-primary" />
                      </button>
                    )}
                  </div>
                  {/* 搜索下拉结果 */}
                  {searchDropdownOpen && searchedScripts.length > 0 && (
                    <div className="absolute right-0 top-full mt-1 w-80 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
                      {searchedScripts.map((script, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            handleHotScriptClick(script.content);
                            setSearchKeyword('');
                            setSearchDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-bg-tertiary transition-colors border-b border-border/50 last:border-b-0"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-text-primary truncate">{script.title}</span>
                            <span className="text-xs text-text-muted flex-shrink-0 ml-2">{script.clicks} 次</span>
                          </div>
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{script.content}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 搜索无结果 */}
                  {searchDropdownOpen && searchKeyword.trim() && searchedScripts.length === 0 && (
                    <div className="absolute right-0 top-full mt-1 w-80 bg-bg-secondary border border-border rounded-lg shadow-xl z-50">
                      <div className="px-3 py-4 text-center text-sm text-text-muted">
                        未找到匹配的剧本
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  type="text"
                  size="small"
                  onClick={handleRandomHotScripts}
                  icon={<Shuffle size={14} />}
                  className="text-text-muted hover:text-accent-primary"
                >
                  随机
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {hotScripts.slice(0, 3).map((script: HotScriptItem, index: number) => (
                <motion.button
                  key={index}
                  type="button"
                  onClick={() => handleHotScriptClick(script.content)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  whileHover={{ scale: 1.02 }}
                  className="bg-bg-tertiary border border-border rounded-lg p-4 text-left hover:border-accent-primary/50 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {script.title}
                    </span>
                    <span className="text-xs text-text-muted">{script.clicks} 次使用</span>
                  </div>
                  <p className="text-sm text-text-secondary line-clamp-2">
                    {script.content}
                  </p>
                  <div className="mt-3 text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    点击填充 →
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )}

        {/* 技能选择：仅在第1集显示 */}
        {!isInherited && (
          <div>
            <label className="flex items-center text-sm font-medium text-text-secondary mb-3">
              <Wrench size={16} className="mr-2 text-accent-secondary" />
              选择 AI 技能（可多选）
              <Tag className="ml-2 text-xs" color="blue">{skills.length} 项已选</Tag>
              {loadingSkills && <span className="ml-2 text-xs text-text-muted">加载中...</span>}
            </label>
            <div className="flex flex-wrap gap-2">
              {skillOptions.map((skill: { id: string; name: string; icon: string; description: string }) => {
                const isSelected = skills.includes(skill.id);
                return (
                  <Tooltip key={skill.id} title={skill.description} placement="top">
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleSkillToggle(skill.id)}
                      className={`
                        px-3 py-1.5 rounded-full border text-sm transition-all duration-200
                        flex items-center gap-1.5
                        ${isSelected
                          ? 'bg-accent-secondary/20 border-accent-secondary text-accent-secondary'
                          : 'bg-bg-tertiary border-border text-text-muted hover:border-border-active'
                        }
                        ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <span>{skill.icon}</span>
                      <span>{skill.name}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮区域 */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        {/* 上传剧本按钮：仅在第1集显示 */}
        {!isInherited && (
          <Upload
            accept=".txt,.doc,.docx,.md"
            beforeUpload={isLocked ? () => false : handleFileUpload}
            showUploadList={false}
            disabled={isLocked}
          >
            <Button
              size="large"
              disabled={isLocked}
              icon={<UploadIcon size={18} />}
              className="bg-bg-tertiary border-border"
            >
              上传剧本
            </Button>
          </Upload>
        )}

        {/* 主操作按钮：生成剧本 / 下一步 */}
        {!isInherited && script && !isParsed && (
          <Button
            size="large"
            onClick={handleRegenerateStory}
            loading={isGeneratingScript}
            disabled={isGeneratingScript}
            icon={<RotateCcw size={18} />}
            className="border-border hover:border-accent-primary"
          >
            {isGeneratingScript ? '正在生成...' : '重新生成故事'}
          </Button>
        )}
        {!isInherited && (
          <Button
            type="primary"
            size="large"
            onClick={script ? () => { setCurrentStep(1); onStepChange?.(1); } : handleGenerate}
            loading={isGeneratingScript}
            disabled={isGeneratingScript}
            icon={script ? <ArrowRight size={18} /> : <Sparkles size={18} />}
            iconPlacement={script ? 'end' : 'start'}
            className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
          >
            {isGeneratingScript ? '正在生成剧本...' : script ? '下一步' : '生成剧本'}
          </Button>
        )}

        {/* 第2集+ 的生成剧本按钮（继承模式） */}
        {isInherited && !script && (
          <Button
            type="primary"
            size="large"
            onClick={handleGenerate}
            loading={isGeneratingScript}
            disabled={isGeneratingScript}
            icon={<Sparkles size={18} />}
            className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
          >
            {isGeneratingScript ? '正在生成剧本...' : '生成剧本'}
          </Button>
        )}
      </div>
      <DevelopmentDirectionModal
        open={directionModalOpen}
        onClose={() => setDirectionModalOpen(false)}
        categories={directionCategories}
        loading={loadingDirections}
        onSelect={handleDirectionClick}
      />
    </div>
  );
};