import { ArticleCard } from "@/components/article-card"
import { GroupedArticle } from "@/lib/types"

interface NewsGridProps {
    articles: GroupedArticle[]
    onCategoryClick?: (category: string) => void
}

export function NewsGrid({ articles, onCategoryClick }: NewsGridProps) {
    if (!articles.length) {
        return (
            <div className="text-center py-20 text-slate-500">
                記事が見つかりませんでした。
            </div>
        )
    }

    return (
        <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
            {articles.map((article) => (
                <div key={article.id} className="break-inside-avoid">
                    <ArticleCard article={article} onCategoryClick={onCategoryClick} />
                </div>
            ))}
        </div>
    )
}
