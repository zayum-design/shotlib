import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

/**
 * 开发模式下的部署级配置中间件:
 * 把 /app-config.json 动态映射到 runtime/app-config.json(npm run cli 写入),
 * 与生产部署(scripts/serve.mjs)行为一致 —— CLI 修改配置后刷新页面即生效。
 * 另提供 POST /logs 前端日志落盘(写入 logs/web/日期/小时.log,与 serve.mjs 一致)。
 */
function runtimeConfigPlugin(): Plugin {
  return {
    name: 'shotlib-runtime-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0]

        // 前端日志落盘
        if (req.method === 'POST' && pathname === '/logs') {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => chunks.push(c))
          req.on('end', () => {
            try {
              const entry = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              const now = new Date()
              const pad = (n: number) => String(n).padStart(2, '0')
              const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
              const hour = pad(now.getHours())
              const time = `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
              const dir = path.resolve(__dirname, 'logs/web', date)
              fs.mkdirSync(dir, { recursive: true })
              fs.appendFileSync(
                path.join(dir, `${hour}.log`),
                JSON.stringify({ ...entry, _logTime: time }, null, 2) + '\n---\n',
                'utf-8',
              )
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ success: true }))
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'invalid log' }))
            }
          })
          return
        }

        if (req.method !== 'GET' || pathname !== '/app-config.json') {
          next()
          return
        }
        const file = path.resolve(__dirname, 'runtime/app-config.json')
        if (!fs.existsSync(file)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'not configured, run `npm run cli` first' }))
          return
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), runtimeConfigPlugin()],
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
