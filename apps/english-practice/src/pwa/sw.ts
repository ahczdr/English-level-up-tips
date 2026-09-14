// T12 自定义 Service Worker（D09）：仅 precache 应用 shell；
// 课程 JSON 与音频由 IndexedDB 承载（T02/T08），不进 SW 缓存。
// catalog.json 网络优先 + 4s 超时回退缓存；SW 更新采用 prompt 策略，
// 不自动 skipWaiting，由用户在提示后手动激活。
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// T16/B1：prompt 更新链路——registerSW(true) 发 SKIP_WAITING 消息，新 SW 立即接管。
// 缺此监听时新 SW 永远 waiting，「确认更新」按钮与回滚后确认语义失效。
self.addEventListener('message', (event) => {
  if ((event as unknown as MessageEvent<{ type?: string }>).data?.type === 'SKIP_WAITING') self.skipWaiting()
})

const CATALOG_CACHE = 'gaokao-catalog-v1'
const CATALOG_TIMEOUT_MS = 4000

const isCatalogRequest = (url: URL): boolean => url.pathname.endsWith('/content-catalog.json')

const catalogNetworkFirst = async (request: Request): Promise<Response> => {
  const cache = await caches.open(CATALOG_CACHE)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS)
  try {
    const response = await fetch(new Request(request, { signal: controller.signal }))
    if (response.ok) {
      // R4：缓存写入失败不吞掉成功响应（quota 等场景仍返回新 catalog）
      try {
        await cache.put(request, response.clone())
      } catch {
        // 忽略写缓存失败
      }
      return response
    }
    // R4：HTTP 错误状态优先回退缓存，无缓存时原样透传
    const cachedOnError = await cache.match(request)
    return cachedOnError ?? response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ packs: [] }), { status: 504, headers: { 'content-type': 'application/json' } })
  } finally {
    clearTimeout(timer)
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isCatalogRequest(url)) {
    event.respondWith(catalogNetworkFirst(request))
    return
  }
  if (request.mode === 'navigate') {
    // 离线时导航回退到 precache 的 index.html（hash 路由统一入口）
    event.respondWith(
      caches.match(request).then((cached) => cached ?? createHandlerBoundToURL('index.html')({ event, request, url })),
    )
  }
})