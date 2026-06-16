import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, type ChildProcess } from 'child_process'

function auditServerPlugin(): Plugin {
  let serverProcess: ChildProcess | null = null

  // Kill the whole process tree. With shell:true on Windows, serverProcess is a
  // cmd.exe wrapper — a plain .kill() leaves the real `node` orphaned holding
  // port 3001, so the next `npm run dev` keeps serving stale code. taskkill /T
  // kills the children too; on POSIX a normal kill is enough.
  const killServer = () => {
    if (!serverProcess?.pid) return
    const pid = serverProcess.pid
    serverProcess = null
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
    } else {
      try { process.kill(pid) } catch { /* ignore */ }
    }
  }

  return {
    name: 'audit-server',
    configureServer(viteServer) {
      // Prevent multiple spawns if configureServer is called again
      if (serverProcess) return;

      serverProcess = spawn('npx', ['tsx', '--env-file-if-exists=.env', 'server/index.ts'], {
        stdio: 'inherit',
        shell: true,
      })

      serverProcess.on('error', (err) => {
        console.error('[audit-server] Failed to start:', err.message)
      })

      // Kill the backend when Vite shuts down, by any path.
      viteServer.httpServer?.on('close', killServer)
      process.once('exit', killServer)
      process.once('SIGINT', () => { killServer(); process.exit(0) })
      process.once('SIGTERM', () => { killServer(); process.exit(0) })
    },
  }
}

export default defineConfig({
  plugins: [react(), auditServerPlugin()],
  server: {
    // App runs on 7005. strictPort:false lets Vite cross-check and fall back to
    // the next free port (7006, 7007…) instead of failing if 7005 is taken.
    port: 7005,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
