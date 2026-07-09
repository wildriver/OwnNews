/* OwnNews Service Worker — Web Push 受信 */

// プッシュ受信: ペイロードなしで届くので、/api/latest から件数・見出しを取得して通知
self.addEventListener('push', (event) => {
    event.waitUntil(
        (async () => {
            let title = 'OwnNews'
            let body = '新しいニュースが届きました。タップして最新を読む'
            try {
                const res = await fetch('/api/latest', { cache: 'no-store' })
                if (res.ok) {
                    const d = await res.json()
                    if (d.latestTitle) {
                        body = `本日のニュース${d.count ? `（${d.count}件）` : ''}\n${d.latestTitle}`
                    }
                }
            } catch (e) {
                // ネットワーク失敗時は固定文言のまま
            }
            await self.registration.showNotification(title, {
                body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'ownnews-daily',
                renotify: true,
                data: { url: '/' },
            })
        })()
    )
})

// 通知タップ: アプリを開く（既存タブがあればフォーカス）
self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = (event.notification.data && event.notification.data.url) || '/'
    event.waitUntil(
        (async () => {
            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            for (const c of clients) {
                if ('focus' in c) { c.navigate(url); return c.focus() }
            }
            if (self.clients.openWindow) return self.clients.openWindow(url)
        })()
    )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
