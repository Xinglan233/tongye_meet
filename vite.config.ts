import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {ocrOfflineManifest} from './scripts/ocr-offline-build'

function helpRoutes() {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path && /^\/help(?:\/[a-z_-]+)?\/?$/.test(path)) {
      const target = `${path.replace(/\/$/, '')}/index.html`
      if (existsSync(resolve('public', target.slice(1)))) req.url = target
    }
    next()
  }
  return { name: 'help-directory-routes', configureServer(server: { middlewares: { use: (handler: typeof rewrite) => void } }) { server.middlewares.use(rewrite) }, configurePreviewServer(server: { middlewares: { use: (handler: typeof rewrite) => void } }) { server.middlewares.use(rewrite) } }
}

export default defineConfig({
  build: {rollupOptions: {output: {onlyExplicitManualChunks:true,manualChunks(id) {if(id.includes('/node_modules/tesseract.js/'))return 'ocr-engine';if(id.endsWith('/src/lib/ocr.ts'))return 'ocr-recognition'}}}},
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  plugins: [
    helpRoutes(),
    react(),
    ocrOfflineManifest(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '同野·游',
        short_name: '同野·游',
        description: '一起找到能碰面的空档',
        lang: 'zh-CN',
        theme_color: '#0c8578',
        background_color: '#f5f6f8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/help(?:\/|$)/],
        globPatterns: ['**/*.{js,css,html,svg,png}', 'ocr-offline-manifest.json'],
        globIgnores: ['tesseract/**', 'assets/ocr-*.js'],
        runtimeCaching: [{
          urlPattern: /\/(?:tesseract\/[^/]+|assets\/ocr-[^/]+\.js)$/,
          handler: async ({request}) => {
            // Explicit preparation reads current network bytes, never an older
            // ready cache. Query-versioned requests also bypass older workers.
            if(request.cache==='no-store')return fetch(request)
            const state=await caches.open('tongye-ocr-state-v1'),recordResponse=await state.match(new URL('tesseract/offline-ready', (self as unknown as {registration:{scope:string}}).registration.scope).href)
            if(recordResponse){try{const record=await recordResponse.json(),resource=record.manifest?.resources?.find((item:{path:string})=>new URL(item.path,(self as unknown as {registration:{scope:string}}).registration.scope).href===request.url);if(resource&&/^tongye-ocr-resources-[a-f0-9]{64}-[a-zA-Z0-9-]+$/.test(record.cacheName)){const cache=await caches.open(record.cacheName),response=await cache.match(request.url,{ignoreVary:true});if(response?.ok){const bytes=await response.clone().arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.byteLength===resource.sizeBytes&&digest===resource.sha256)return response}}}catch{/* Damaged OCR cache is never served as verified bytes. */}}
            return fetch(request)
          }
        }],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ]
})
