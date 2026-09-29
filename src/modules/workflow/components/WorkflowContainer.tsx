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

import { motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { WorkflowStepStatus } from '@/shared/types/index';

interface WorkflowStepProps {
  stepNumber: number;
  title: string;
  description: string;
  status: WorkflowStepStatus;
  isActive: boolean;
  children: React.ReactNode;
  onStepClick?: () => void;
  extra?: React.ReactNode;
  customIcon?: React.ReactNode;
  stepIcon?: React.ReactNode;
}

const statusConfig = {
  pending: {
    icon: Circle,
    className: 'text-text-muted',
  },
  active: {
    icon: Loader2,
    className: 'text-accent-primary animate-spin',
  },
  completed: {
    icon: CheckCircle2,
    className: 'text-accent-success',
  },
  error: {
    icon: Circle,
    className: 'text-accent-error',
  },
};

export const WorkflowStep: React.FC<WorkflowStepProps> = ({
  stepNumber,
  title,
  description,
  status,
  isActive,
  children,
  onStepClick,
  extra,
  customIcon,
  stepIcon,
}) => {
  const config = statusConfig[status];

  const handleCardClick = (e: React.MouseEvent) => {
    // 只有点击卡片本身（非子元素）且未激活的步骤才能点击
    if (!isActive && e.target === e.currentTarget && onStepClick) {
      onStepClick();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`
        relative rounded-xl border transition-all duration-300
        ${isActive ? 'border-border-active bg-bg-secondary' : 'border-border bg-bg-secondary/50'}
        ${!isActive && onStepClick ? 'cursor-pointer hover:border-border-active/50' : ''}
      `}
      onClick={handleCardClick}
    >
      {/* 渐变边框效果 */}
      {isActive && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 pointer-events-none" />
      )}

      <div className="relative p-6 max-md:p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 max-md:flex-col max-md:items-start max-md:gap-3">
          <div className="flex items-center gap-4 max-md:gap-2">
            <div
              className={`
                w-10 h-10 rounded-full flex items-center justify-center max-md:w-8 max-md:h-8
                ${isActive ? 'bg-accent-primary/20' : 'bg-bg-tertiary'}
              `}
            >
              {customIcon ? (
                <span className={config.className}>{customIcon}</span>
              ) : stepIcon ? (
                <span className={config.className.replace('animate-spin', '').trim()}>{stepIcon}</span>
              ) : (
                <config.icon size={20} className={config.className} />
              )}
            </div>
            <div>
              <h3 className="text-lg font-medium text-text-primary max-md:text-base">
                Step {stepNumber}: {title}
              </h3>
              <p className="text-sm text-text-secondary">{description}</p>
            </div>
          </div>
          {extra && <div className="flex-shrink-0">{extra}</div>}
        </div>

        {/* Content */}
        <div className="mt-4">
          {children}
        </div>
      </div>
    </motion.div>
  );
};

interface StepConnectorProps {
  isCompleted?: boolean;
}

export const StepConnector: React.FC<StepConnectorProps> = ({ isCompleted }) => {
  return (
    <div className="flex justify-center py-4">
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.5 }}
        className="w-0.5 h-8 relative"
      >
        {isCompleted ? (
          <div className="absolute inset-0 bg-gradient-to-b from-accent-success to-accent-success/50 rounded-full" />
        ) : (
          <div className="absolute inset-0 bg-border" />
        )}

        {/* 箭头指示 */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className={isCompleted ? 'text-accent-success' : 'text-border'}>
            <path d="M6 8L0 2L2 0L6 4L10 0L12 2L6 8Z" fill="currentColor" />
          </svg>
        </div>
      </motion.div>
    </div>
  );
};
