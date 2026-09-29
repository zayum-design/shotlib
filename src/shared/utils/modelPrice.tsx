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
 * 模型积分价格显示工具
 */
import React from 'react';
import { Coins } from 'lucide-react';

const PRICE_TYPE_LABEL: Record<string, string> = {
  per_1k_tokens: '/百万tokens',
  per_image: '/张',
  per_second: '/秒',
  per_track: '/首',
};

interface ModelPriceTagProps {
  model?: Record<string, any> | null;
  duration?: number;
  className?: string;
  resolution?: '720p' | '1080p';
}

/**
 * 模型积分价格标签组件
 * 显示在 Select 后面：积分图标 + 数量 + 单位
 * 视频模型如 duration > 0 则额外显示 = 总积分
 */
export const ModelPriceTag: React.FC<ModelPriceTagProps> = ({
  model,
  duration,
  className = '',
  resolution,
}) => {
  if (!model || model.creditPrice == null || model.priceType == null) {
    return null;
  }

  const unit = PRICE_TYPE_LABEL[model.priceType] || '';
  const is1080p = resolution === '1080p';
  const effectivePrice = is1080p && model.creditPrice1080p != null
    ? model.creditPrice1080p
    : model.creditPrice;

  if (model.priceType === 'per_second' && duration != null && duration > 0) {
    const total = effectivePrice * duration;
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-text-muted ${className}`}>
        <Coins size={12} />
        {total}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-text-muted ${className}`}>
      <Coins size={12} />
      {effectivePrice}{unit}
    </span>
  );
};
