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
 * WorkflowSaveGuardFactory — 工作流保存风险守卫工厂
 *
 * 职责：
 * 1. 在每次保存前检测数据是否存在"被清空/异常丢失"风险
 * 2. 维护上次成功保存的数据快照（DataFingerprint）
 * 3. 检测 reset() 后未重新生成数据就保存的危险操作
 * 4. 提供可配置的风险阈值，允许业务层自定义校验规则
 *
 * 使用方式：
 *   const guard = WorkflowSaveGuardFactory.getInstance();
 *   const report = guard.validateSave(currentState);
 *   if (report.level === SaveRiskLevel.BLOCKED) { // 阻止保存
 *     return false;
 *   }
 */

import type { WorkflowState } from '../stores/workflowStore';

/** 保存风险级别（const + type 替代 enum，兼容 erasableSyntaxOnly） */
export const SaveRiskLevel = {
  SAFE: 'safe',
  WARNING: 'warning',
  DANGER: 'danger',
  BLOCKED: 'blocked',
} as const;

export type SaveRiskLevel = (typeof SaveRiskLevel)[keyof typeof SaveRiskLevel];

/** 数据指纹 — 轻量级快照，用于快速对比 */
export interface DataFingerprint {
  characterCount: number;
  sceneCount: number;
  episodeCount: number;
  scriptLength: number;
  topicLength: number;
  hasEra: boolean;
  timestamp: number;
}

/** 保存风险报告 */
export interface SaveRiskReport {
  level: SaveRiskLevel;
  message: string;
  fingerprint: DataFingerprint;
  lastSnapshot: DataFingerprint | null;
  recommendation: string;
}

/** 保存守卫配置 */
export interface SaveGuardConfig {
  /** 是否允许空保存（默认 false） */
  allowEmptySave?: boolean;
  /** 角色数下降超过此比例触发 DANGER（0~1，默认 0.8） */
  maxCharacterDropRatio?: number;
  /** 场景数下降超过此比例触发 DANGER（0~1，默认 0.8） */
  maxSceneDropRatio?: number;
  /** 片段数下降超过此比例触发 DANGER（0~1，默认 0.8） */
  maxEpisodeDropRatio?: number;
  /** 剧本长度下降超过此比例触发 WARNING（0~1，默认 0.9） */
  maxScriptDropRatio?: number;
  /** 检测到重置后，最少需要多少 ms 的"冷静期"才允许保存（默认 5000ms） */
  resetCooldownMs?: number;
  /** 风险检测回调 */
  onRiskDetected?: (report: SaveRiskReport) => void;
}

const DEFAULT_CONFIG: Required<Omit<SaveGuardConfig, 'onRiskDetected'>> = {
  allowEmptySave: false,
  maxCharacterDropRatio: 0.8,
  maxSceneDropRatio: 0.8,
  maxEpisodeDropRatio: 0.8,
  maxScriptDropRatio: 0.9,
  resetCooldownMs: 5000,
};

/** 从 WorkflowState 生成数据指纹 */
function generateFingerprint(state: WorkflowState): DataFingerprint {
  return {
    characterCount: state.characters?.length ?? 0,
    sceneCount: state.scenes?.length ?? 0,
    episodeCount: state.episodes?.length ?? 0,
    scriptLength: state.script?.length ?? 0,
    topicLength: state.topic?.length ?? 0,
    hasEra: !!state.era,
    timestamp: Date.now(),
  };
}

/** 计算下降比例 */
function dropRatio(previous: number, current: number): number {
  if (previous <= 0) return current <= 0 ? 0 : -1; // -1 表示从无到有（新增）
  return (previous - current) / previous;
}

/** 判断指纹是否为空 */
function isEmptyFingerprint(fp: DataFingerprint): boolean {
  return (
    fp.characterCount === 0 &&
    fp.sceneCount === 0 &&
    fp.episodeCount === 0 &&
    fp.scriptLength === 0 &&
    fp.topicLength === 0 &&
    !fp.hasEra
  );
}

// ==================== 工厂类 ====================

export class WorkflowSaveGuardFactory {
  private static instance: WorkflowSaveGuardFactory | null = null;

  private lastSnapshot: DataFingerprint | null = null;
  private resetDetectedAt: number | null = null;
  private config: Required<Omit<SaveGuardConfig, 'onRiskDetected'>> = { ...DEFAULT_CONFIG };
  private onRiskDetected?: (report: SaveRiskReport) => void;

  private constructor() {}

  /** 获取单例 */
  static getInstance(): WorkflowSaveGuardFactory {
    if (!WorkflowSaveGuardFactory.instance) {
      WorkflowSaveGuardFactory.instance = new WorkflowSaveGuardFactory();
    }
    return WorkflowSaveGuardFactory.instance;
  }

  /** 配置守卫参数（可选，未配置的项使用默认值） */
  configure(cfg: SaveGuardConfig): void {
    this.config = { ...this.config, ...cfg };
    if (cfg.onRiskDetected) {
      this.onRiskDetected = cfg.onRiskDetected;
    }
  }

  /** 重置为默认配置 */
  resetConfig(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.onRiskDetected = undefined;
  }

  /** 记录当前数据快照（应在每次成功保存后调用） */
  recordSnapshot(state: WorkflowState): void {
    this.lastSnapshot = generateFingerprint(state);
    console.log('[SaveGuard] 快照已记录:', {
      chars: this.lastSnapshot.characterCount,
      scenes: this.lastSnapshot.sceneCount,
      episodes: this.lastSnapshot.episodeCount,
      scriptLen: this.lastSnapshot.scriptLength,
    });
  }

  /** 标记数据已被 reset() 重置 */
  markReset(): void {
    this.resetDetectedAt = Date.now();
    console.warn('[SaveGuard] ⚠️ 检测到 reset()，已标记重置时间戳');
  }

  /** 清除重置标记（应在重新生成/解析剧本成功后调用） */
  clearResetMark(): void {
    if (this.resetDetectedAt) {
      console.log('[SaveGuard] 重置标记已清除，数据已重新生成');
    }
    this.resetDetectedAt = null;
  }

  /** 检测当前状态是否处于"重置后未恢复" */
  isPostReset(): boolean {
    return this.resetDetectedAt !== null;
  }

  /** 获取上次快照 */
  getLastSnapshot(): DataFingerprint | null {
    return this.lastSnapshot;
  }

  /** 清除上次快照（切换分集/新建分集时调用，避免跨分集数据对比导致误拦截） */
  clearSnapshot(): void {
    this.lastSnapshot = null;
    console.log('[SaveGuard] 快照已清除，下次保存将视为首次保存');
  }

  // ---------- 核心校验逻辑 ----------

  /**
   * 校验保存风险
   * @returns SaveRiskReport 风险报告
   */
  validateSave(state: WorkflowState): SaveRiskReport {
    const fp = generateFingerprint(state);
    const snap = this.lastSnapshot;

    // 1. 空状态检测
    if (isEmptyFingerprint(fp)) {
      const report: SaveRiskReport = {
        level: SaveRiskLevel.BLOCKED,
        message: '阻止保存：当前数据为空（无角色、场景、剧本、片段），保存将覆盖已有数据',
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '请先生成或解析剧本，确保数据非空后再保存',
      };
      this._emit(report);
      return report;
    }

    // 2. 重置后检测（冷静期）
    if (this.resetDetectedAt) {
      const elapsed = Date.now() - this.resetDetectedAt;
      if (elapsed < this.config.resetCooldownMs) {
        const report: SaveRiskReport = {
          level: SaveRiskLevel.BLOCKED,
          message: `阻止保存：reset() 后 ${Math.ceil((this.config.resetCooldownMs - elapsed) / 1000)} 秒内不允许保存，防止清空数据覆盖服务器`,
          fingerprint: fp,
          lastSnapshot: snap,
          recommendation: '请等待冷静期结束，或重新生成数据后重试',
        };
        this._emit(report);
        return report;
      }
      // 冷静期已过，但数据仍很少 —— 警告但不阻止
      if (snap && isEmptyFingerprint(fp)) {
        const report: SaveRiskReport = {
          level: SaveRiskLevel.DANGER,
          message: '危险：reset() 冷静期已过，但当前数据仍为空，可能已丢失历史数据',
          fingerprint: fp,
          lastSnapshot: snap,
          recommendation: '请检查数据是否已重新生成，或从后端重新加载',
        };
        this._emit(report);
        return report;
      }
    }

    // 3. 无快照时 —— 视为首次保存，安全
    if (!snap) {
      return {
        level: SaveRiskLevel.SAFE,
        message: '首次保存，数据正常',
        fingerprint: fp,
        lastSnapshot: null,
        recommendation: '保存成功后将记录快照',
      };
    }

    // 4. 数据量下降检测
    const charDrop = dropRatio(snap.characterCount, fp.characterCount);
    const sceneDrop = dropRatio(snap.sceneCount, fp.sceneCount);
    const episodeDrop = dropRatio(snap.episodeCount, fp.episodeCount);
    const scriptDrop = dropRatio(snap.scriptLength, fp.scriptLength);

    // 4a. 严重下降 → BLOCKED
    if (charDrop >= this.config.maxCharacterDropRatio && snap.characterCount > 0) {
      const report: SaveRiskReport = {
        level: SaveRiskLevel.BLOCKED,
        message: `阻止保存：角色数从 ${snap.characterCount} 下降到 ${fp.characterCount}（下降 ${(charDrop * 100).toFixed(0)}%），疑似数据被清空`,
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '如确认删除角色请分批操作，避免一次性清空',
      };
      this._emit(report);
      return report;
    }

    if (sceneDrop >= this.config.maxSceneDropRatio && snap.sceneCount > 0) {
      const report: SaveRiskReport = {
        level: SaveRiskLevel.BLOCKED,
        message: `阻止保存：场景数从 ${snap.sceneCount} 下降到 ${fp.sceneCount}（下降 ${(sceneDrop * 100).toFixed(0)}%），疑似数据被清空`,
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '如确认删除场景请分批操作，避免一次性清空',
      };
      this._emit(report);
      return report;
    }

    if (episodeDrop >= this.config.maxEpisodeDropRatio && snap.episodeCount > 0) {
      const report: SaveRiskReport = {
        level: SaveRiskLevel.BLOCKED,
        message: `阻止保存：片段数从 ${snap.episodeCount} 下降到 ${fp.episodeCount}（下降 ${(episodeDrop * 100).toFixed(0)}%），疑似数据被清空`,
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '如确认删除片段请分批操作，避免一次性清空',
      };
      this._emit(report);
      return report;
    }

    // 4b. 中度下降 → DANGER（剧本长度大幅下降）
    if (scriptDrop >= this.config.maxScriptDropRatio && snap.scriptLength > 100) {
      const report: SaveRiskReport = {
        level: SaveRiskLevel.DANGER,
        message: `危险：剧本长度从 ${snap.scriptLength} 下降到 ${fp.scriptLength}（下降 ${(scriptDrop * 100).toFixed(0)}%）`,
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '如确认重写剧本请先在本地备份',
      };
      this._emit(report);
      return report;
    }

    // 4c. 轻微下降 → WARNING
    if (charDrop > 0 || sceneDrop > 0 || episodeDrop > 0 || scriptDrop > 0) {
      const parts: string[] = [];
      if (charDrop > 0) parts.push(`角色-${(charDrop * 100).toFixed(0)}%`);
      if (sceneDrop > 0) parts.push(`场景-${(sceneDrop * 100).toFixed(0)}%`);
      if (episodeDrop > 0) parts.push(`片段-${(episodeDrop * 100).toFixed(0)}%`);
      if (scriptDrop > 0) parts.push(`剧本-${(scriptDrop * 100).toFixed(0)}%`);
      return {
        level: SaveRiskLevel.WARNING,
        message: `警告：数据量有下降（${parts.join('、')}），请确认是正常操作`,
        fingerprint: fp,
        lastSnapshot: snap,
        recommendation: '如确认无误可继续保存',
      };
    }

    // 5. 正常或增长 → SAFE
    return {
      level: SaveRiskLevel.SAFE,
      message: '数据正常，保存安全',
      fingerprint: fp,
      lastSnapshot: snap,
      recommendation: '继续保存',
    };
  }

  /** 快捷方法：直接判断是否可以保存 */
  canSave(state: WorkflowState): boolean {
    const report = this.validateSave(state);
    return report.level !== SaveRiskLevel.BLOCKED;
  }

  // ---------- 内部方法 ----------

  private _emit(report: SaveRiskReport): void {
    const prefix = report.level === SaveRiskLevel.BLOCKED ? '❌' : report.level === SaveRiskLevel.DANGER ? '⚠️' : '🔶';
    console.warn(`[SaveGuard] ${prefix} ${report.message}`);
    if (this.onRiskDetected) {
      try {
        this.onRiskDetected(report);
      } catch (e) {
        console.error('[SaveGuard] 风险回调执行失败:', e);
      }
    }
  }
}

/** 便捷导出：获取默认单例 */
export const saveGuard = WorkflowSaveGuardFactory.getInstance();
