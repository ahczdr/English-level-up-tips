import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// T16：构建 SHA（CI/发布脚本经 BUILD_SHA 注入；缺省 unversioned，页面明示而非伪造）
const buildSha = process.env.BUILD_SHA ?? 'unversioned'

declare const __APP_VERSION__: string
declare const __BUILD_SHA__: string

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  plugins: [
    vue(),
    // T12（D09）：injectManifest 自定义 SW；仅 precache shell，课程内容走 IndexedDB
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      injectRegister: null,
      registerType: 'prompt',
      manifest: {
        name: '高考英语练习',
        short_name: '高考英语',
        description: '本地优先的高考英语练习应用',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f5f7fb',
        theme_color: '#1f4e8c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.spec.ts'],
  },
})
