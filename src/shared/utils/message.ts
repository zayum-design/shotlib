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

import type { MessageInstance } from 'antd/es/message/interface';
import { message as antdMessage } from 'antd';

let messageInstance: MessageInstance | null = null;

/**
 * 由 App 组件挂载时调用，注入 antd message 实例
 * 用于解决 antd message 静态函数无法消费动态主题的弃用警告
 */
export function bindMessage(instance: MessageInstance) {
  messageInstance = instance;
}

function getMessage(): MessageInstance {
  // 优先使用通过 App 组件注入的实例（支持动态主题，无警告）
  if (messageInstance) return messageInstance;
  // 兜底：未挂载时使用 antd 静态函数（功能正常，但会有警告）
  return antdMessage;
}

/**
 * 替代 antd message 静态函数调用的统一入口
 *
 * 旧用法：import { message } from 'antd'; message.success('xxx')
 * 新用法：import { message } from '@/shared/utils/message'; message.success('xxx')
 */
export const message = {
  success: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().success(content, duration, onClose),
  error: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().error(content, duration, onClose),
  info: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().info(content, duration, onClose),
  warning: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().warning(content, duration, onClose),
  warn: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().warning(content, duration, onClose),
  loading: (
    content: React.ReactNode | string,
    duration?: number,
    onClose?: () => void,
  ) => getMessage().loading(content, duration, onClose),
};
