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

/// <reference types="vite/client" />

declare module "*.json" {
  const value: any;
  export default value;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** 调试日志开关：'true' 显示 console.log/info/debug，否则静默（保留 warn/error） */
  readonly VITE_DEBUG_LOG?: string
  // 其他环境变量...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}