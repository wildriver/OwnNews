import { ArticleDetail } from '@/components/article-detail'

export const runtime = 'edge'

// 記事詳細はクライアント側で端末内の記事パックから即表示する（サーバー往復なし）。
// サーバーはidを渡すだけ。関連記事も端末内の埋め込みで計算する。
export default async function ArticlePage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    return <ArticleDetail id={id} />
}
