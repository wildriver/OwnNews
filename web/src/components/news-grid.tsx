import { ArticleCard } from "@/components/article-card"
import { GroupedArticle } from "@/lib/types"

interface NewsGridProps {
    articles: GroupedArticle[]
    outsideBubble?: boolean
    onCategoryClick?: (category: string) => void
    /** セクション先頭を大型カードにするか（既定: true） */
    withFeatured?: boolean
}

// 高密度レイアウト:
//  - モバイル: 白いパネル内のリスト行（ヘアライン区切り）。先頭のみ画像大カード
//  - デスクトップ: 2〜3カラムのタイトなカードグリッド
export function NewsGrid({ articles, outsideBubble, onCategoryClick, withFeatured = true }: NewsGridProps) {
    if (!articles.length) {
        return (
            <div className="text-center py-14 text-sm text-muted-foreground bg-card border border-border rounded-xl">
                記事が見つかりませんでした
            </div>
        )
    }

    // 先頭の「画像を持つ」記事をフィーチャード枠に（先頭3件から探す）
    let featuredIdx = -1
    if (withFeatured) {
        featuredIdx = articles.slice(0, 3).findIndex(a => a.image_url)
        if (featuredIdx === -1) featuredIdx = 0
    }
    const featured = featuredIdx >= 0 ? articles[featuredIdx] : null
    const rest = featuredIdx >= 0 ? articles.filter((_, i) => i !== featuredIdx) : articles

    return (
        <div className="md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-2 bg-card md:bg-transparent border border-border md:border-0 rounded-xl md:rounded-none overflow-hidden divide-y divide-border md:divide-y-0">
            {featured && (
                <div className="md:col-span-2 xl:col-span-1 xl:row-span-2 md:bg-card md:border md:border-border md:rounded-lg md:overflow-hidden">
                    <ArticleCard
                        article={featured}
                        variant="featured"
                        outsideBubble={outsideBubble || featured.inBubble === false}
                        onCategoryClick={onCategoryClick}
                    />
                </div>
            )}
            {rest.map((article) => (
                <div key={article.id} className="md:bg-card md:border md:border-border md:rounded-lg">
                    <ArticleCard
                        article={article}
                        outsideBubble={outsideBubble || article.inBubble === false}
                        onCategoryClick={onCategoryClick}
                    />
                </div>
            ))}
        </div>
    )
}
