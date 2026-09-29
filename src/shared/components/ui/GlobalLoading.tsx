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

import { useLoadingStore } from '@/shared/stores/useLoadingStore';

/**
 * 全局 Loading 覆盖层
 * 炫酷效果：多层旋转光环 + 中心脉冲发光球 + 渐变文字 + 可选进度条
 */
export const GlobalLoading: React.FC = () => {
  const { isOpen, title, description, progress, showProgress } = useLoadingStore();

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes gl-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes gl-spin-1 {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes gl-spin-2 {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes gl-spin-3 {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes gl-spin-4 {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes gl-pulse-core {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.8; }
        }
        @keyframes gl-pulse-glow {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
          50% { transform: translate(-50%, -50%) scale(1.5); opacity: 0.3; }
        }
        @keyframes gl-text-shimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes gl-fade-pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>

      {/* 背景遮罩层：跟随主题色，30% 透明度 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          backgroundColor: 'var(--bg-primary)',
          opacity: 0.3,
          animation: 'gl-fade-in 0.3s ease-out',
        }}
      />
      {/* 内容层：毛玻璃效果 + 居中内容 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          animation: 'gl-fade-in 0.3s ease-out',
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '32px',
            padding: '48px 64px',
          }}
        >
          {/* 多层旋转光环 */}
          <div style={{ position: 'relative', width: '160px', height: '160px' }}>
            {/* 外环1 - 顺时针 */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '2px solid transparent',
                borderTopColor: 'var(--accent-primary)',
                borderRightColor: 'rgba(59, 130, 246, 0.3)',
                animation: 'gl-spin-1 2s linear infinite',
              }}
            />
            {/* 外环2 - 逆时针 */}
            <div
              style={{
                position: 'absolute',
                inset: '12px',
                borderRadius: '50%',
                border: '2px solid transparent',
                borderBottomColor: 'var(--accent-secondary)',
                borderLeftColor: 'rgba(139, 92, 246, 0.3)',
                animation: 'gl-spin-2 2.5s linear infinite',
              }}
            />
            {/* 外环3 - 顺时针 */}
            <div
              style={{
                position: 'absolute',
                inset: '24px',
                borderRadius: '50%',
                border: '2px solid transparent',
                borderTopColor: 'rgba(59, 130, 246, 0.6)',
                borderBottomColor: 'rgba(139, 92, 246, 0.6)',
                animation: 'gl-spin-3 1.8s linear infinite',
              }}
            />
            {/* 外环4 - 逆时针 */}
            <div
              style={{
                position: 'absolute',
                inset: '36px',
                borderRadius: '50%',
                border: '2px solid transparent',
                borderLeftColor: 'var(--gradient-start)',
                borderRightColor: 'var(--gradient-end)',
                animation: 'gl-spin-4 3s linear infinite',
                opacity: 0.5,
              }}
            />

            {/* 中心脉冲发光球 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--gradient-start), var(--gradient-end))',
                animation: 'gl-pulse-core 1.5s ease-in-out infinite',
                boxShadow: `
                  0 0 20px rgba(59, 130, 246, 0.6),
                  0 0 40px rgba(139, 92, 246, 0.4),
                  0 0 60px rgba(59, 130, 246, 0.2)
                `,
              }}
            />
            {/* 外层光晕 */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.25) 0%, rgba(139, 92, 246, 0.15) 40%, transparent 70%)',
                animation: 'gl-pulse-glow 2s ease-in-out infinite',
              }}
            />
          </div>

          {/* 文字内容 */}
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 600,
                margin: 0,
                background: 'linear-gradient(135deg, var(--gradient-start), var(--gradient-end))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'gl-text-shimmer 3s ease-in-out infinite',
                backgroundSize: '200% 200%',
              }}
            >
              {title}
            </h3>
            {description && (
              <p
                style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  margin: 0,
                  animation: 'gl-fade-pulse 2s ease-in-out infinite',
                }}
              >
                {description}
              </p>
            )}
          </div>

          {/* 底部进度条 */}
          {showProgress && (
            <div
              style={{
                width: '240px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: '4px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, var(--gradient-start), var(--gradient-end))',
                    borderRadius: '2px',
                    transition: 'width 0.3s ease',
                    boxShadow: '0 0 8px rgba(59, 130, 246, 0.4)',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--accent-primary)',
                  minWidth: '36px',
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(progress)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
