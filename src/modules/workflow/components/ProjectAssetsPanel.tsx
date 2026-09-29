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
import { Button, Collapse } from 'antd';
import { Users, MapPin, Globe, Network, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkflowStore } from '../stores/workflowStore';
import { CharacterCard } from '@/shared/components/ui/CharacterCard';
import { SceneCard } from '@/shared/components/ui/SceneCard';
import { EraDisplay } from '@/shared/components/ui/EraDisplay';
import { RelationshipNetworkDisplay } from '@/shared/components/ui/RelationshipNetworkDisplay';

export const ProjectAssetsPanel: React.FC = () => {
  const {
    characters,
    scenes,
    era,
    relationshipNetwork,
    activeCharacterIds,
    activeSceneIds,
    currentStep,
    script,
  } = useWorkflowStore();

  const [isExpanded, setIsExpanded] = useState(false);

  // 按当前分集活跃ID过滤
  // 无活跃ID时：已到剧本分解步骤（currentStep >= 2）说明是旧分集数据（活跃ID缺失），
  // 回退按「名称出现在本集剧本中」匹配（≥2字），避免多集项目下其他分集新增的
  // 资产串进本分集列表；否则（新分集未生成剧本）不显示
  const hasScriptParseData = activeCharacterIds?.length > 0 || activeSceneIds?.length > 0
    || currentStep >= 2;
  const matchNameInScript = (name?: string) => {
    const n = (name || '').trim();
    return n.length >= 2 && !!script?.includes(n);
  };
  const displayedCharacters = activeCharacterIds?.length
    ? characters.filter(c => activeCharacterIds.includes(c.id))
    : (hasScriptParseData ? characters.filter(c => matchNameInScript(c.name)) : []);
  const displayedScenes = activeSceneIds?.length
    ? scenes.filter(s => activeSceneIds.includes(s.id))
    : (hasScriptParseData ? scenes.filter(s => matchNameInScript(s.name)) : []);
  // 关系网也只显示活跃角色之间的关系
  const displayedRelationships = activeCharacterIds?.length && relationshipNetwork
    ? {
        ...relationshipNetwork,
        relationships: relationshipNetwork.relationships.filter(
          rel => activeCharacterIds.includes(rel.fromCharacterId) && activeCharacterIds.includes(rel.toCharacterId)
        ),
      }
    : relationshipNetwork;

  const assetCounts = [
    { icon: Users, label: '角色', count: displayedCharacters.length, color: 'text-accent-primary' },
    { icon: MapPin, label: '场景', count: displayedScenes.length, color: 'text-accent-secondary' },
    { icon: Globe, label: '故事背景', count: era ? 1 : 0, color: 'text-blue-400' },
    { icon: Network, label: '关系网', count: displayedRelationships?.relationships?.length ?? 0, color: 'text-purple-400' },
  ];

  return (
    <div className="bg-bg-secondary rounded-xl border border-border">
      {/* 摘要栏 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-bg-tertiary/30 transition-colors"
      >
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium text-text-secondary">项目资产</span>
          <div className="flex items-center gap-4">
            {assetCounts.map((asset) => (
              <div key={asset.label} className="flex items-center gap-1.5">
                <asset.icon size={14} className={asset.color} />
                <span className="text-xs text-text-muted">
                  {asset.label} ({asset.count})
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* 展开详情 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-border pt-4 space-y-6">
              {/* 角色 */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                  <Users size={16} className="text-accent-primary" />
                  角色库 ({displayedCharacters.length})
                </h4>
                {displayedCharacters.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {displayedCharacters.map((character) => (
                      <CharacterCard key={character.id} character={character} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">暂无角色数据</p>
                )}
              </div>

              {/* 场景 */}
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                  <MapPin size={16} className="text-accent-secondary" />
                  场景库 ({displayedScenes.length})
                </h4>
                {displayedScenes.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {displayedScenes.map((scene) => (
                      <SceneCard key={scene.id} scene={scene} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">暂无场景数据</p>
                )}
              </div>

              {/* 故事背景 */}
              {era && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                    <Globe size={16} className="text-blue-400" />
                    故事背景
                  </h4>
                  <EraDisplay era={era} />
                </div>
              )}

              {/* 关系网 */}
              {displayedRelationships && displayedRelationships.relationships.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                    <Network size={16} className="text-purple-400" />
                    人物关系网
                  </h4>
                  <RelationshipNetworkDisplay network={displayedRelationships} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
