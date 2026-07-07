import { Suspense } from 'react'
import { LocalFeed } from '@/components/local-feed'

export const runtime = 'edge'

// フィード生成はすべてクライアント側（LocalFeed）で行う。
// サーバはこのシェルと /api/pack（CDNキャッシュされる記事パック）を返すだけ。
export default function Home() {
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      <Suspense fallback={null}>
        <LocalFeed />
      </Suspense>
    </div>
  )
}
