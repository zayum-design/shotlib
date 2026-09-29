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


import { Network, Users } from 'lucide-react';
import type { RelationshipNetwork, CharacterRelationship } from '../../types';

interface RelationshipNetworkDisplayProps {
  network: RelationshipNetwork;
}

// 关系类型对应的颜色和图标
const relationshipConfig: Record<string, { color: string; bgColor: string; lineColor: string }> = {
  '恋人': { color: 'text-pink-500', bgColor: 'bg-pink-500/10', lineColor: 'border-pink-400' },
  '夫妻': { color: 'text-purple-500', bgColor: 'bg-purple-500/10', lineColor: 'border-purple-400' },
  '父母子女': { color: 'text-orange-500', bgColor: 'bg-orange-500/10', lineColor: 'border-orange-400' },
  '兄弟姐妹': { color: 'text-amber-500', bgColor: 'bg-amber-500/10', lineColor: 'border-amber-400' },
  '朋友': { color: 'text-green-500', bgColor: 'bg-green-500/10', lineColor: 'border-green-400' },
  '同事': { color: 'text-blue-500', bgColor: 'bg-blue-500/10', lineColor: 'border-blue-400' },
  '上下级': { color: 'text-indigo-500', bgColor: 'bg-indigo-500/10', lineColor: 'border-indigo-400' },
  '恋人未满': { color: 'text-rose-400', bgColor: 'bg-rose-400/10', lineColor: 'border-rose-400' },
  '对手': { color: 'text-red-500', bgColor: 'bg-red-500/10', lineColor: 'border-red-400' },
  '陌生人': { color: 'text-gray-400', bgColor: 'bg-gray-500/10', lineColor: 'border-gray-400' },
};

interface CharacterNodeProps {
  name: string;
  relationships: CharacterRelationship[];
  allCharacters?: string[];
}

const CharacterNode: React.FC<CharacterNodeProps> = ({ name, relationships, allCharacters: _allCharacters }) => {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      {/* 角色头部 */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-primary/30 to-accent-secondary/30 flex items-center justify-center">
          <Users size={18} className="text-accent-primary" />
        </div>
        <div>
          <h4 className="font-medium text-text-primary">{name}</h4>
          <span className="text-xs text-text-muted">{relationships.length} 条关系</span>
        </div>
      </div>

      {/* 关系列表 */}
      <div className="space-y-2">
        {relationships.map((rel) => {
          const otherName = rel.fromCharacterName === name ? rel.toCharacterName : rel.fromCharacterName;
          const config = relationshipConfig[rel.relationship] || relationshipConfig['陌生人'];
          const isOutgoing = rel.fromCharacterName === name;

          return (
            <div
              key={rel.id}
              className={`p-2 rounded-lg border ${config.bgColor} ${config.lineColor}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-medium ${config.color}`}>{rel.relationship}</span>
                {isOutgoing ? (
                  <>
                    <span className="text-text-muted">→</span>
                    <span className="text-text-secondary">{otherName}</span>
                  </>
                ) : (
                  <>
                    <span className="text-text-muted">←</span>
                    <span className="text-text-secondary">{otherName}</span>
                  </>
                )}
              </div>
              <p className="text-xs text-text-muted mt-1 line-clamp-2">{rel.description}</p>
              {/* 关系强度 */}
              <div className="flex items-center gap-1 mt-2">
                <span className="text-xs text-text-muted">强度</span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className={`w-3 h-1.5 rounded-full ${
                        i <= Math.ceil(rel.intensity / 2) ? config.color.replace('text-', 'bg-') : 'bg-gray-600'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const RelationshipNetworkDisplay: React.FC<RelationshipNetworkDisplayProps> = ({ network }) => {
  // 收集所有涉及的角色
  const allCharacters = Array.from(new Set([
    ...network.relationships.map((r) => r.fromCharacterName),
    ...network.relationships.map((r) => r.toCharacterName),
  ]));

  // 按角色分组关系
  const characterRelationships = allCharacters.map((name) => ({
    name,
    relationships: network.relationships.filter(
      (r) => r.fromCharacterName === name || r.toCharacterName === name
    ),
  }));

  // 统计关系类型
  const relationshipTypeCount = network.relationships.reduce((acc, rel) => {
    acc[rel.relationship] = (acc[rel.relationship] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <section>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network size={20} className="text-accent-primary" />
          <span className="text-text-primary font-medium text-lg">{network.name}</span>
          <span className="text-xs text-text-muted">({network.relationships.length} 条关系)</span>
        </div>
      </div>

      {/* 关系类型统计 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(relationshipTypeCount).map(([type, count]) => {
          const config = relationshipConfig[type] || relationshipConfig['陌生人'];
          return (
            <div
              key={type}
              className={`px-2 py-1 rounded-full text-xs ${config.bgColor} ${config.color} border ${config.lineColor}`}
            >
              {type} × {count}
            </div>
          );
        })}
      </div>

      {/* 描述 */}
      {network.description && (
        <p className="text-sm text-text-secondary mb-4">{network.description}</p>
      )}

      {/* 角色关系网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {characterRelationships.map((charData) => (
          <CharacterNode
            key={charData.name}
            name={charData.name}
            relationships={charData.relationships}
            allCharacters={allCharacters}
          />
        ))}
      </div>
    </section>
  );
};
