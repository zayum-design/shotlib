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
 * Moonshot 错误解析器:OpenAI 兼容格式 + moonshot/kimi 模型名隐藏
 */
import { OpenAICompatibleErrorParser } from '../../core/openai-error-parser';

export class MoonshotErrorParser extends OpenAICompatibleErrorParser {
  constructor() {
    super('Moonshot', /\bmoonshot-[\w.-]+|\bkimi-[\w.-]+\b/gi);
  }
}
