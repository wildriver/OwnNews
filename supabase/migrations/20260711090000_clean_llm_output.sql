-- LLM解析出力の汚染データをクリーニング
-- 小型モデル(8B)が生成した中国語混じりの中分類（本杰・岛室・パコタート等）や
-- 幻覚キーワードが articles に混入したため、
--   1) 許可リスト外の中分類 → 「その他」に矯正し、fact_score を NULL に戻して
--      再解析対象にする（バックフィルが70B+検証フィルタで解析し直す）
--   2) 簡体字を含むキーワード配列も同様に再解析対象へ
-- Workerの再解析は1サイクル32件×1日5回。数日かけて自然に置き換わる。

-- 1) 中分類が許可リスト外の行
UPDATE articles
SET category_medium = 'その他',
    category_minor  = NULL,
    fact_score      = NULL
WHERE category_medium IS NOT NULL
  AND category_medium <> ''
  AND category_medium NOT IN
    ('政治','経済','国際','IT・テクノロジー','スポーツ','エンタメ','科学','社会','地方','ビジネス','生活','環境','文化','その他');

-- 2) キーワードに簡体字などの疑わしい文字を含む行（代表的な簡体字・不使用漢字）
UPDATE articles
SET category_minor = NULL,
    fact_score     = NULL
WHERE category_minor IS NOT NULL
  AND array_to_string(category_minor, ',') ~ '[岛杰囍відп们这във]';
