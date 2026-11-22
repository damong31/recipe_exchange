import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const { PORT = 4100 } = loadEnv(mode, process.cwd(), '')
  return { server: { proxy: { '/api': 'http://127.0.0.1:' + PORT } } }
})
