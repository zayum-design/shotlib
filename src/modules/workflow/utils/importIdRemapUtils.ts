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
 * 导入数据时的 ID 重映射工具
 *
 * 解决跨账号导入项目数据时的 ID 冲突问题：
 * 为 characters、scenes、shots 生成新 UUID，替换所有 prompt 中的标签引用，
 * 清空 episodeIdMap（后端 episode 需重新创建）。
 */

function generateId(): string {
  return crypto.randomUUID();
}

/** 替换 prompt 字符串中的 character-id / scene-id 属性值 */
function remapPromptIds(prompt: string, charIdMap: Map<string, string>, sceneIdMap: Map<string, string>): string {
  if (!prompt) return prompt;

  let result = prompt;

  // 替换 @<role character-id="old"> 为 @<role character-id="new">
  result = result.replace(/@<role\s+character-id="([^"]+)">/g, (_match, oldId) => {
    const newId = charIdMap.get(oldId);
    return newId ? `@<role character-id="${newId}">` : _match;
  });

  // 替换 #<scene scene-id="old"> 和 @<scene scene-id="old">
  result = result.replace(/([#@])<scene\s+scene-id="([^"]+)">/g, (_match, prefix, oldId) => {
    const newId = sceneIdMap.get(oldId);
    return newId ? `${prefix}<scene scene-id="${newId}">` : _match;
  });

  return result;
}

/** 重映射 relationshipNetwork 中的节点和边引用 */
function remapRelationshipNetwork(network: any, charIdMap: Map<string, string>): any {
  if (!network || typeof network !== 'object') return network;

  const result: any = { ...network };

  // 处理 nodes 数组（如果存在）
  if (Array.isArray(result.nodes)) {
    result.nodes = result.nodes.map((node: any) => {
      if (!node || typeof node !== 'object') return node;
      const newNode = { ...node };
      if (newNode.id && charIdMap.has(newNode.id)) {
        newNode.id = charIdMap.get(newNode.id)!;
      }
      return newNode;
    });
  }

  // 处理 edges 数组（如果存在）
  if (Array.isArray(result.edges)) {
    result.edges = result.edges.map((edge: any) => {
      if (!edge || typeof edge !== 'object') return edge;
      const newEdge = { ...edge };
      if (newEdge.source && charIdMap.has(newEdge.source)) {
        newEdge.source = charIdMap.get(newEdge.source)!;
      }
      if (newEdge.target && charIdMap.has(newEdge.target)) {
        newEdge.target = charIdMap.get(newEdge.target)!;
      }
      return newEdge;
    });
  }

  // 处理 relationships 数组（实际导出的数据结构）
  if (Array.isArray(result.relationships)) {
    result.relationships = result.relationships.map((rel: any) => {
      if (!rel || typeof rel !== 'object') return rel;
      const newRel = { ...rel };
      if (newRel.fromCharacterId && charIdMap.has(newRel.fromCharacterId)) {
        newRel.fromCharacterId = charIdMap.get(newRel.fromCharacterId)!;
      }
      if (newRel.toCharacterId && charIdMap.has(newRel.toCharacterId)) {
        newRel.toCharacterId = charIdMap.get(newRel.toCharacterId)!;
      }
      return newRel;
    });
  }

  return result;
}

/** 重映射单集 episode 内部的所有 ID */
export function remapEpisodeIds(episodeData: any, charIdMap: Map<string, string>, sceneIdMap: Map<string, string>): any {
  if (!episodeData || typeof episodeData !== 'object') return episodeData;

  const result = JSON.parse(JSON.stringify(episodeData));

  // 重映射 episodes 数组中每个 episode 的 shots
  if (Array.isArray(result.episodes)) {
    result.episodes = result.episodes.map((episode: any) => {
      if (!episode || typeof episode !== 'object') return episode;
      const newEpisode = { ...episode };

      // 为 episode 本身生成新 id
      if (newEpisode.id) {
        newEpisode.id = generateId();
      }

      // 重映射 shots
      if (Array.isArray(newEpisode.shots)) {
        newEpisode.shots = newEpisode.shots.map((shot: any) => {
          if (!shot || typeof shot !== 'object') return shot;
          const newShot = { ...shot };
          if (newShot.id) {
            newShot.id = generateId();
          }
          // 替换 shot prompt 中的标签引用
          newShot.prompt = remapPromptIds(newShot.prompt, charIdMap, sceneIdMap);
          newShot.rawPrompt = remapPromptIds(newShot.rawPrompt, charIdMap, sceneIdMap);
          newShot.referencePrompt = remapPromptIds(newShot.referencePrompt, charIdMap, sceneIdMap);
          newShot.rawReferencePrompt = remapPromptIds(newShot.rawReferencePrompt, charIdMap, sceneIdMap);
          return newShot;
        });
      }

      // 替换 episode 级别的 prompt
      newEpisode.prompt = remapPromptIds(newEpisode.prompt, charIdMap, sceneIdMap);
      newEpisode.rawPrompt = remapPromptIds(newEpisode.rawPrompt, charIdMap, sceneIdMap);

      return newEpisode;
    });
  }

  // 重映射 activeCharacterIds / activeSceneIds
  if (Array.isArray(result.activeCharacterIds)) {
    result.activeCharacterIds = result.activeCharacterIds
      .map((id: string) => charIdMap.get(id) || id)
      .filter(Boolean);
  }
  if (Array.isArray(result.activeSceneIds)) {
    result.activeSceneIds = result.activeSceneIds
      .map((id: string) => sceneIdMap.get(id) || id)
      .filter(Boolean);
  }

  // 关键修复：重映射分集内 characters 数组本身的 id
  // projectAssets.characters 已在 remapImportedIds 中重映射并建立 charIdMap，
  // 但每集 characters 副本若不重映射，会导致 characters[].id（旧 UUID）与
  // activeCharacterIds（新 UUID）不匹配，UI 按 active 过滤时显示为 0
  if (Array.isArray(result.characters)) {
    result.characters = result.characters.map((char: any) => {
      if (!char || typeof char !== 'object') return char;
      const newChar = { ...char };
      if (newChar.id && charIdMap.has(newChar.id)) {
        newChar.id = charIdMap.get(newChar.id)!;
      }
      return newChar;
    });
  }

  // 关键修复：重映射分集内 scenes 数组本身的 id（同上原因）
  if (Array.isArray(result.scenes)) {
    result.scenes = result.scenes.map((scene: any) => {
      if (!scene || typeof scene !== 'object') return scene;
      const newScene = { ...scene };
      if (newScene.id && sceneIdMap.has(newScene.id)) {
        newScene.id = sceneIdMap.get(newScene.id)!;
      }
      return newScene;
    });
  }

  // 重映射 era 和 relationshipNetwork（这些字段也可能存在于分集数据中）
  if (result.relationshipNetwork) {
    result.relationshipNetwork = remapRelationshipNetwork(result.relationshipNetwork, charIdMap);
  }

  return result;
}

export interface RemappedImportData {
  assets: any;
  episodesData: Record<number, any>;
  episodeIdMap: Record<number, string>;
  currentEpisodeData: any;
  charIdMap: Map<string, string>;
  sceneIdMap: Map<string, string>;
}

/**
 * 对导入的项目数据进行 ID 重映射
 *
 * @param assets projectAssets 对象
 * @param episodesData 分集数据映射
 * @param existingEpisodeIdMap 当前项目已有的 episodeIdMap（可选，保留当前用户已有分集）
 * @param currentEpisodeData 当前分集数据（可选，与 episodesData 一同重映射，确保回退路径 ID 一致）
 * @returns 处理后的数据
 */
export function remapImportedIds(
  assets: any,
  episodesData: Record<number, any>,
  existingEpisodeIdMap?: Record<number, string>,
  currentEpisodeData?: any,
): RemappedImportData {
  const charIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();

  // 1. 为 characters 生成新 ID
  const newAssets = JSON.parse(JSON.stringify(assets || {}));
  if (Array.isArray(newAssets.characters)) {
    newAssets.characters = newAssets.characters.map((char: any) => {
      if (!char || typeof char !== 'object') return char;
      const newChar = { ...char };
      const oldId = newChar.id;
      if (oldId) {
        const newId = generateId();
        charIdMap.set(oldId, newId);
        newChar.id = newId;
      }
      return newChar;
    });
  }

  // 2. 为 scenes 生成新 ID
  if (Array.isArray(newAssets.scenes)) {
    newAssets.scenes = newAssets.scenes.map((scene: any) => {
      if (!scene || typeof scene !== 'object') return scene;
      const newScene = { ...scene };
      const oldId = newScene.id;
      if (oldId) {
        const newId = generateId();
        sceneIdMap.set(oldId, newId);
        newScene.id = newId;
      }
      return newScene;
    });
  }

  // 2.5 为 props 生成新 ID（道具在 prompt 中按名称标记【道具:名】，无 id 引用，仅需重映射自身 id）
  if (Array.isArray(newAssets.props)) {
    newAssets.props = newAssets.props.map((prop: any) => {
      if (!prop || typeof prop !== 'object') return prop;
      const newProp = { ...prop };
      if (newProp.id) {
        newProp.id = generateId();
      }
      return newProp;
    });
  }

  // 3. 重映射 relationshipNetwork
  if (newAssets.relationshipNetwork) {
    newAssets.relationshipNetwork = remapRelationshipNetwork(newAssets.relationshipNetwork, charIdMap);
  }

  // 4. 重映射所有分集数据中的 shots 和 prompt
  const newEpisodesData: Record<number, any> = {};
  for (const [epNum, epData] of Object.entries(episodesData || {})) {
    newEpisodesData[Number(epNum)] = remapEpisodeIds(epData, charIdMap, sceneIdMap);
  }

  // 4.1 重映射 currentEpisodeData（与 episodesData 使用同一套 charIdMap/sceneIdMap，确保回退路径 ID 一致）
  const newCurrentEpisodeData = currentEpisodeData
    ? remapEpisodeIds(currentEpisodeData, charIdMap, sceneIdMap)
    : {};

  // 5. 清空 episodeIdMap（后端 episode 需重新创建），但保留当前用户已有的映射
  const newEpisodeIdMap: Record<number, string> = existingEpisodeIdMap ? { ...existingEpisodeIdMap } : {};

  return {
    assets: newAssets,
    episodesData: newEpisodesData,
    episodeIdMap: newEpisodeIdMap,
    currentEpisodeData: newCurrentEpisodeData,
    charIdMap,
    sceneIdMap,
  };
}
