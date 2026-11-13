import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@main': resolve(__dirname, 'src/main'),
  '@ui': resolve(__dirname, 'src/renderer/src/ui'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  main: { resolve: { alias } },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          output: resolve(__dirname, 'src/renderer/output.html'),
          remote: resolve(__dirname, 'src/renderer/remote.html')
        }
      }
    }
  }
})
