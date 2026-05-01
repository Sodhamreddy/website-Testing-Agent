import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'child_process'

function auditServerPlugin(): Plugin {
  let serverProcess: ChildProcess | null = null

  return {
    name: 'audit-server',
    configureServer(viteServer) {
      serverProcess = spawn('npx', ['tsx', 'server/index.ts'], {
        stdio: 'inherit',
        shell: true,
      })

      serverProcess.on('error', (err) => {
        console.error('[audit-server] Failed to start:', err.message)
      })

      viteServer.httpServer?.on('close', () => {
        serverProcess?.kill()
      })

      process.on('exit', () => serverProcess?.kill())
    },
  }
}

export default defineConfig({
  plugins: [react(), auditServerPlugin()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
