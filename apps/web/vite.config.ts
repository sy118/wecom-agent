import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const configDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(configDir, '../..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '')
  const webPort = Number(env.WEB_PORT ?? 5173)
  const webHost = env.WEB_HOST || env.HOST || '127.0.0.1'
  const apiTarget = env.API_BASE_URL || `http://${env.API_HOST || '127.0.0.1'}:${Number(env.API_PORT ?? 3000)}`

  return {
    plugins: [react()],
    server: {
      host: webHost,
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: webHost,
      port: webPort,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
    },
  }
})
