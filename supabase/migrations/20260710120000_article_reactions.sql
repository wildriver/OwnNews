-- 記事へのリアクション（賛成/反対/驚き/学び/疑問/視点が広がった）
-- コメント機能の代わりに、1タップで主観を表明できるボタン。
--   - 本人の行はRLSで本人のみ読み書き（意見データなので特に厳格に）
--   - 他人には集計（件数）だけをRPCで公開。誰が押したかは見えない
--   - 推薦には使わない（反対した記事を減らすと意見バブルを助長するため、可視化に徹する）

CREATE TABLE IF NOT EXISTS article_reactions (
    user_id    text NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    article_id text NOT NULL,
    reaction   text NOT NULL CHECK (reaction IN ('agree','disagree','surprise','insight','doubt','perspective')),
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, article_id, reaction)
);

CREATE INDEX IF NOT EXISTS article_reactions_article_idx ON article_reactions (article_id);

ALTER TABLE article_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS article_reactions_own ON article_reactions;
CREATE POLICY article_reactions_own ON article_reactions FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);

-- 記事ごとの匿名集計（ログインユーザー全員が読める）
CREATE OR REPLACE FUNCTION article_reaction_counts(p_article_id text)
RETURNS TABLE(reaction text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.reaction, count(*) AS cnt
    FROM article_reactions r
    WHERE r.article_id = p_article_id
    GROUP BY r.reaction;
$$;
GRANT EXECUTE ON FUNCTION article_reaction_counts(text) TO authenticated;
