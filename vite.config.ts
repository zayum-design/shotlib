import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5176,
  },
  // 构建产物体积告警上限调高:内置模型配置/prompt 模板/presets 使包体偏大
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
