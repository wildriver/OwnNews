-- 新ニュースソース対応: articles.source カラム追加
-- Supabase Dashboard > SQL Editor で実行してください
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source text DEFAULT '';

-- 既存レコードはすべてCEEK.JP経由
UPDATE articles SET source = 'CEEK.JP' WHERE source = '' OR source IS NULL;

-- 記事パック配信用のインデックス（collected_at 降順で最新N件を取る）
CREATE INDEX IF NOT EXISTS articles_collected_at_idx
    ON articles (collected_at DESC);
