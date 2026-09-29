/** @type {import('tailwindcss').Config} */

/**
 * 使用 CSS 相对颜色语法包装变量颜色，让 Tailwind 的透明度修饰符（如 border-border/50）
 * 能正常生成。若直接写 'var(--border)'，带 /透明度的类会被 Tailwind 静默丢弃，
 * 边框回退到 preflight 默认色 #e5e7eb（暗黑模式下显示为白线）。
 * 无修饰符时生成 rgb(from var(--x) r g b / 1)，与原色完全一致。
 */
const themeColor = (varName) => `rgb(from var(${varName}) r g b / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // dark: 前缀跟随 themeStore 写入的 data-theme 属性（而非系统偏好），画布模块按主题切换样式
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 使用 CSS 变量定义颜色，支持主题切换
        'bg-primary': themeColor('--bg-primary'),
        'bg-secondary': themeColor('--bg-secondary'),
        'bg-tertiary': themeColor('--bg-tertiary'),
        'border': themeColor('--border'),
        'border-active': themeColor('--border-active'),
        'text-primary': themeColor('--text-primary'),
        'text-secondary': themeColor('--text-secondary'),
        'text-muted': themeColor('--text-muted'),
        'accent-primary': themeColor('--accent-primary'),
        'accent-secondary': themeColor('--accent-secondary'),
        'accent-success': themeColor('--accent-success'),
        'accent-warning': themeColor('--accent-warning'),
        'accent-error': themeColor('--accent-error'),
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'theme': '0 1px 3px var(--shadow-color)',
        'theme-lg': '0 4px 12px var(--shadow-color)',
      },
    },
  },
  plugins: [],
}
