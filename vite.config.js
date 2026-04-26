import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// 빌드 시 public/version.json 자동 생성 플러그인
function versionJsonPlugin() {
  return {
    name: 'version-json',
    buildStart() {
      writeFileSync(
        resolve('./public/version.json'),
        JSON.stringify({ version }, null, 2)
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), versionJsonPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase-vendor'
          }
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/react/')
          ) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
