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

import React from 'react';
import { motion } from 'framer-motion';
import { Modal, Steps, Button, Input, Select } from 'antd';
import { X, Dices, Sparkles } from 'lucide-react';
import { ModelPriceTag } from '@/shared/utils/modelPrice';
import type { UseInstantCreatePageReturn } from '../../hooks/UseInstantCreatePageReturn';

interface Props {
  page: UseInstantCreatePageReturn;
}

export const AvatarStepsModal: React.FC<Props> = ({ page }) => {
  return (
    <>
    {/* MV-style 多步头像生成 Modal */}
    <Modal
      title="生成角色头像"
      open={page.avatarModalOpen}
      onCancel={page.resetAvatarModal}
      footer={null}
      width={720}
      centered
      destroyOnHidden
    >
      <div className="py-4">
        <Steps
          current={page.avatarCurrentStep}
          size="small"
          className="mb-6"
          onChange={(step) => page.setAvatarCurrentStep(step)}
          items={[...(page.avatarTotalSteps > 1 ? Array.from({ length: page.avatarTotalSteps - 1 }, (_, i) => {
            const step = (page as any).avatarPresetOptions?.steps?.[i];
            return { title: step?.title || `步骤${i + 1}` };
          }) : []), { title: '补充描述' }]}
        />

        {!page.isAvatarLastStep ? (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-text-primary">
              {(page as any).avatarPresetOptions?.steps?.[page.avatarCurrentStep]?.title || '选择'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {page.getAvatarStepOptions(page.avatarCurrentStep, page.avatarSelections).map((option: string) => {
                const isSelected = page.avatarSelections[page.avatarCurrentStep] === option;
                return (
                  <motion.button
                    key={option}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => page.handleAvatarSelect(option)}
                    className={`
                      p-4 rounded-xl border text-sm font-medium transition-all
                      ${isSelected
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border bg-bg-tertiary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary'
                      }
                    `}
                  >
                    {option}
                  </motion.button>
                );
              })}
            </div>
            {page.avatarSelections[page.avatarCurrentStep] && (
              <div className="flex justify-end pt-2">
                <Button type="primary" onClick={() => page.setAvatarCurrentStep(page.avatarCurrentStep + 1)}>
                  下一步
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* 已选配置摘要 */}
            <div className="rounded-xl bg-bg-tertiary p-4 space-y-2">
              <h4 className="text-sm font-medium text-text-primary">已选配置</h4>
              <div className="flex flex-wrap gap-2">
                {page.avatarSelections.map((value, index) =>
                  value ? (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-bg-secondary text-xs text-text-secondary border border-border"
                    >
                      {(page as any).avatarPresetOptions?.steps?.[index]?.title?.replace('选择', '') || ''}: {value}
                      <button
                        onClick={() => {
                          const newSelections = [...page.avatarSelections];
                          newSelections[index] = '';
                          page.setAvatarSelections(newSelections);
                        }}
                        className="ml-0.5 text-text-muted hover:text-red-500 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : null
                )}
              </div>
            </div>

            {/* 补充描述 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-text-secondary">
                  补充描述（可选）
                </label>
                <Button
                  type="text"
                  size="small"
                  icon={<Dices size={14} />}
                  onClick={page.handleRandomAvatarPrompt}
                  className="text-text-muted hover:!text-accent-primary"
                >
                  随机灵感
                </Button>
              </div>
              <Input.TextArea
                value={page.avatarPrompt}
                onChange={(e) => page.setAvatarPrompt(e.target.value)}
                placeholder="补充更多细节，例如：穿着黑色皮夹克，舞台灯光背景..."
                autoSize={{ minRows: 3, maxRows: 6 }}
                className="bg-bg-tertiary border-border rounded-lg"
              />
            </div>

            {/* 合并预览 */}
            <div className="rounded-xl bg-bg-tertiary p-4 space-y-2">
              <h4 className="text-sm font-medium text-text-primary">最终提示词预览</h4>
              <p className="text-sm text-text-secondary">
                {page.buildAvatarPrompt()}
              </p>
            </div>

            {/* 图像模型 */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                图像模型
              </label>
              <Select
                value={page.avatarModel}
                onChange={page.setAvatarModel}
                options={page.imageModels.map((m) => ({ label: m.name, value: m.id }))}
                className="w-full" popupMatchSelectWidth={false} />
              <ModelPriceTag model={page.imageModels.find(m => m.id === page.avatarModel)} />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button onClick={() => page.setAvatarCurrentStep(page.avatarCurrentStep - 1)}>
                上一步
              </Button>
              <Button
                type="primary"
                onClick={page.handleGenerateAvatarFromModal}
                loading={page.isGeneratingAvatar}
                icon={<Sparkles size={16} />}
                className="bg-gradient-to-r from-accent-primary to-accent-secondary border-0"
              >
                生成头像
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>


    </>
  );
};
