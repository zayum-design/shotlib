# 公共图片预览组件 (ImagePreview)

## 概述

Creator 项目中全局统一的图片放大预览方案，基于 **Ant Design `Image.PreviewGroup`** 实现。

与旧版自定义 `ImagePreviewModal`（framer-motion 全屏弹窗）相比，新方案：
- 与任务历史面板中的预览体验完全一致
- 支持鼠标滚轮缩放、拖拽平移
- 支持左右箭头切换、键盘导航（← → ESC）
- 底部缩略图导航栏
- 无需维护独立的状态和键盘事件监听

---

## 组件列表

| 组件 | 用途 | 适用场景 |
|------|------|---------|
| `ImagePreview` | 受控预览层，图片隐藏只提供放大能力 | 已有自定义缩略图布局，点击后弹出预览 |
| `InlineImagePreview` | 内联显示缩略图 + 点击放大 | 直接显示图片列表，如任务历史结果展示 |

---

## ImagePreview（受控预览层）

### Props

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `images` | `string[]` | 是 | 图片 URL 数组 |
| `visible` | `boolean` | 是 | 是否显示预览层 |
| `currentIndex` | `number` | 是 | 当前预览的图片索引 |
| `onClose` | `() => void` | 是 | 关闭预览回调 |
| `title` | `string` | 否 | 图片 alt 前缀 |

### 使用示例

```tsx
import { useState } from 'react';
import { ImagePreview } from '@/shared/components/ui/ImagePreview';

function MyComponent() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const imageUrls = ['https://xxx/1.png', 'https://xxx/2.png'];

  return (
    <div>
      {/* 自定义缩略图布局 */}
      {imageUrls.map((url, idx) => (
        <img
          key={idx}
          src={url}
          className="w-20 h-20 object-cover rounded cursor-pointer"
          onClick={() => {
            setPreviewIndex(idx);
            setPreviewOpen(true);
          }}
        />
      ))}

      {/* 预览层（图片隐藏，仅提供预览能力） */}
      <ImagePreview
        images={imageUrls}
        visible={previewOpen}
        currentIndex={previewIndex}
        onClose={() => setPreviewOpen(false)}
        title="场景图"
      />
    </div>
  );
}
```

---

## InlineImagePreview（内联缩略图 + 预览）

### Props

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `images` | `string[]` | 是 | - | 图片 URL 数组 |
| `imageClassName` | `string` | 否 | `h-[200px] w-auto object-contain rounded-lg border border-border` | 单张图片样式 |
| `containerClassName` | `string` | 否 | `flex gap-2 flex-wrap` | 容器样式 |
| `showMask` | `boolean` | 否 | `false` | 是否显示预览遮罩提示 |

### 使用示例

```tsx
import { InlineImagePreview } from '@/shared/components/ui/ImagePreview';

// 在任务结果卡片中直接显示可预览的图片组
<InlineImagePreview
  images={resultContent.urls}
  imageClassName="h-[200px] w-auto object-contain rounded-lg border border-border"
/>
```

---

## 与旧版 ImagePreviewModal 的区别

| 特性 | ImagePreviewModal（旧） | ImagePreview（新） |
|------|------------------------|-------------------|
| 实现方式 | 自定义 framer-motion 弹窗 | Ant Design Image.PreviewGroup |
| 缩放 | 不支持 | 支持滚轮缩放 |
| 拖拽 | 不支持 | 支持拖拽平移 |
| 缩略图导航 | 不支持 | 支持底部缩略图条 |
| 键盘事件 | 手动监听 | 内置支持 |
| 状态管理 | isOpen + currentIndex + onPrev/onNext/onClose | visible + currentIndex + onClose |

### 迁移示例

**旧代码：**
```tsx
import { ImagePreviewModal } from './ImagePreviewModal';

const [previewOpen, setPreviewOpen] = useState(false);
const [previewIndex, setPreviewIndex] = useState(0);

<img onClick={() => { setPreviewIndex(idx); setPreviewOpen(true); }} />

<ImagePreviewModal
  isOpen={previewOpen}
  images={imageUrls}
  currentIndex={previewIndex}
  onClose={() => setPreviewOpen(false)}
  onPrev={() => setPreviewIndex(p => p - 1)}
  onNext={() => setPreviewIndex(p => p + 1)}
  title="预览"
/>
```

**新代码：**
```tsx
import { ImagePreview } from './ImagePreview';

const [previewOpen, setPreviewOpen] = useState(false);
const [previewIndex, setPreviewIndex] = useState(0);

<img onClick={() => { setPreviewIndex(idx); setPreviewOpen(true); }} />

<ImagePreview
  images={imageUrls}
  visible={previewOpen}
  currentIndex={previewIndex}
  onClose={() => setPreviewOpen(false)}
  title="预览"
/>
```

主要变化：
1. 导入从 `ImagePreviewModal` 改为 `ImagePreview`
2. `isOpen` → `visible`
3. 移除 `onPrev` / `onNext`（由 PreviewGroup 内部处理）

---

## 文件位置

```
app/creator/src/shared/components/ui/
├── ImagePreview.tsx          # 组件源码
├── README_ImagePreview.md    # 本文档
└── ImagePreviewModal.tsx     # 旧版（待逐步替换后删除）
```

---

## 注意事项

1. `ImagePreview` 组件本身会在 DOM 中渲染隐藏的 `Image` 元素（用于 PreviewGroup 识别），请确保 `images` 数组稳定以避免不必要的重渲染。
2. `InlineImagePreview` 会直接在页面上渲染缩略图，适合任务结果展示等场景。
3. 对于已有复杂缩略图布局（如轮播、网格）的场景，建议使用 `ImagePreview` + 自定义缩略图，而非 `InlineImagePreview`。
