-- ソーシャルシグナル（記事ごとの閲覧数・リアクション集計）
-- 用途:
--   1. article_social_counts: Worker が記事パック生成時に呼び、各記事に
--      views / reactions を焼き込む → クライアントの「バブルの外」推薦が
--      「自分以外の人がよく読み・反応している記事」を優先できる（世間の窓）。
--      service_role 専用（Workerのみ。ユーザーには記事単位の生集計を開かない）。
--   2. global_reaction_counts: ダッシュボードの「みんなの感情」用の全体集計。
--      ログインユーザーが読める匿名集計。

CREATE OR REPLACE FUNCTION article_social_counts()
RETURNS TABLE(article_id text, views bigint, reactions jsonb)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT
        COALESCE(v.article_id, r.article_id) AS article_id,
        COALESCE(v.c, 0)                     AS views,
        COALESCE(r.j, '{}'::jsonb)           AS reactions
    FROM (
        SELECT i.article_id, count(*) AS c
        FROM user_interactions i
        WHERE i.interaction_type IN ('view', 'deep_dive')
        GROUP BY i.article_id
    ) v
    FULL OUTER JOIN (
        SELECT t.article_id, jsonb_object_agg(t.reaction, t.c) AS j
        FROM (
            SELECT ar.article_id, ar.reaction, count(*) AS c
            FROM article_reactions ar
            GROUP BY ar.article_id, ar.reaction
        ) t
        GROUP BY t.article_id
    ) r ON v.article_id = r.article_id;
$$;
REVOKE EXECUTE ON FUNCTION article_social_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION article_social_counts() TO service_role;

CREATE OR REPLACE FUNCTION global_reaction_counts(days int DEFAULT 30)
RETURNS TABLE(reaction text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT ar.reaction, count(*) AS cnt
    FROM article_reactions ar
    WHERE ar.created_at > now() - make_interval(days => days)
    GROUP BY ar.reaction;
$$;
GRANT EXECUTE ON FUNCTION global_reaction_counts(int) TO authenticated;
