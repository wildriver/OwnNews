-- 運営ダッシュボード拡張: エンゲージメント観測（もっと知る／検索利用／関心タグ）
-- 設計思想: 嗜好そのものはサーバに置かない。運営は匿名集計のみ観測する。
--   - 利用イベント（検索回数など）は「回数」だけ。検索語は絶対に保存しない。
--   - 集計RPCは全て SECURITY DEFINER + is_admin() ガード（migrate_admin.sql の踏襲）。
--     ユーザーIDを返さない集計（admin_watched_tags）は匿名性を保つ。
-- 前提: migrate_admin.sql（admin_users / is_admin() / admin_summary / admin_user_detail）,
--       migrate_phase1.sql（user_profile / user_interactions）, watched_tags 実行済み。

-- ============================================================
-- 1. 匿名利用イベント（検索回数など。検索語は保存しない）
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_events (
    user_id text NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    event   text NOT NULL,           -- 'search' など。検索語そのものは絶対に入れない
    day     date NOT NULL,
    count   int  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, event, day)
);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_events_own ON usage_events;
CREATE POLICY usage_events_own ON usage_events FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);

-- クライアントから1文でインクリメント。呼び出し者自身の行のみ（RLSのWITH CHECKで担保）。
-- SECURITY DEFINER不要（自分の行だけをRLS下で書く）。未ログインは何もしない。
CREATE OR REPLACE FUNCTION bump_usage_event(p_event text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE uid text := (auth.jwt() ->> 'email');
BEGIN
    IF uid IS NULL THEN RETURN; END IF;
    INSERT INTO usage_events (user_id, event, day, count)
    VALUES (uid, p_event, current_date, 1)
    ON CONFLICT (user_id, event, day)
    DO UPDATE SET count = usage_events.count + 1;
END; $$;
GRANT EXECUTE ON FUNCTION bump_usage_event(text) TO authenticated;

-- ============================================================
-- 2. 全体サマリ（既存キーは全て維持しつつ、もっと知る／検索を追加）
-- ============================================================
CREATE OR REPLACE FUNCTION admin_summary()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result json;
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    SELECT json_build_object(
        'total_users',      (SELECT count(*) FROM user_profile),
        'active_7d',        (SELECT count(DISTINCT user_id) FROM user_interactions WHERE created_at > now() - interval '7 days'),
        'active_30d',       (SELECT count(DISTINCT user_id) FROM user_interactions WHERE created_at > now() - interval '30 days'),
        'total_views',      (SELECT count(*) FROM user_interactions WHERE interaction_type IN ('view','deep_dive')),
        'total_deep_dives', (SELECT count(*) FROM user_interactions WHERE interaction_type = 'deep_dive'),
        'total_dismissed',  (SELECT count(*) FROM user_interactions WHERE interaction_type = 'not_interested'),
        'push_subscribers', (SELECT count(DISTINCT user_id) FROM push_subscriptions),
        'avg_filter_strength', (SELECT round(avg(filter_strength)::numeric, 3) FROM user_profile),
        'avg_dwell_sec',    (SELECT round(avg(dwell_seconds)::numeric, 1) FROM user_interactions WHERE dwell_seconds > 0),
        -- もっと知る（AI深掘り／X／はてブ）
        'know_ai',          (SELECT count(*) FROM user_interactions WHERE interaction_type = 'deep_dive'),
        'know_x',           (SELECT count(*) FROM user_interactions WHERE interaction_type = 'know_x'),
        'know_hatena',      (SELECT count(*) FROM user_interactions WHERE interaction_type = 'know_hatena'),
        -- 検索利用（回数のみ。検索語は収集しない）
        'search_7d',        (SELECT coalesce(sum(count), 0) FROM usage_events WHERE event = 'search' AND day >= current_date - 6),
        'search_30d',       (SELECT coalesce(sum(count), 0) FROM usage_events WHERE event = 'search' AND day >= current_date - 29)
    ) INTO result;
    RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION admin_summary() TO authenticated;

-- ============================================================
-- 3. ユーザー別の観測（既存列を維持しつつ、もっと知る／検索／タグ数を追加）
--    RETURNS TABLE の型が変わるため一度DROPしてから再作成する。
-- ============================================================
DROP FUNCTION IF EXISTS admin_user_detail();
CREATE FUNCTION admin_user_detail()
RETURNS TABLE(
    user_id            text,
    filter_strength    float,
    views              bigint,
    deep_dives         bigint,
    dismissed          bigint,
    last_active        timestamptz,
    top_category       text,
    top_ratio          numeric,
    know_more          bigint,   -- deep_dive + know_x + know_hatena
    searches_30d       bigint,   -- usage_events の30日合計
    watched_tags_count int       -- watched_tags の配列長（NULLは0）
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    WITH base AS (
        SELECT i.user_id,
               split_part(i.category, ',', 1) AS cat,
               i.interaction_type,
               i.created_at
        FROM user_interactions i
    ),
    agg AS (
        SELECT b.user_id,
               count(*) FILTER (WHERE b.interaction_type IN ('view','deep_dive')) AS views,
               count(*) FILTER (WHERE b.interaction_type = 'deep_dive')            AS deep_dives,
               count(*) FILTER (WHERE b.interaction_type = 'not_interested')       AS dismissed,
               count(*) FILTER (WHERE b.interaction_type IN ('deep_dive','know_x','know_hatena')) AS know_more,
               max(b.created_at)                                                   AS last_active
        FROM base b
        GROUP BY b.user_id
    ),
    searches AS (
        SELECT u.user_id, coalesce(sum(u.count), 0) AS searches_30d
        FROM usage_events u
        WHERE u.event = 'search' AND u.day >= current_date - 29
        GROUP BY u.user_id
    ),
    cat_counts AS (
        SELECT b.user_id, b.cat, count(*) AS c
        FROM base b
        WHERE b.interaction_type IN ('view','deep_dive')
          AND coalesce(b.cat, '') <> ''
        GROUP BY b.user_id, b.cat
    ),
    cat_total AS (
        SELECT cc.user_id, sum(cc.c) AS tot FROM cat_counts cc GROUP BY cc.user_id
    ),
    topcat AS (
        SELECT DISTINCT ON (cc.user_id)
               cc.user_id,
               cc.cat AS top_category,
               round((cc.c::numeric / ct.tot), 3) AS top_ratio
        FROM cat_counts cc
        JOIN cat_total ct ON ct.user_id = cc.user_id
        ORDER BY cc.user_id, cc.c DESC
    )
    SELECT p.user_id,
           p.filter_strength,
           coalesce(a.views, 0),
           coalesce(a.deep_dives, 0),
           coalesce(a.dismissed, 0),
           a.last_active,
           tc.top_category,
           tc.top_ratio,
           coalesce(a.know_more, 0),
           coalesce(sr.searches_30d, 0),
           coalesce(array_length(p.watched_tags, 1), 0)
    FROM user_profile p
    LEFT JOIN agg a       ON a.user_id = p.user_id
    LEFT JOIN searches sr ON sr.user_id = p.user_id
    LEFT JOIN topcat tc   ON tc.user_id = p.user_id
    ORDER BY a.last_active DESC NULLS LAST;
END; $$;
GRANT EXECUTE ON FUNCTION admin_user_detail() TO authenticated;

-- ============================================================
-- 4. 関心キーワード（ウォッチタグ）→ 購読ユーザー数（匿名集計・上位20）
--    user_id は返さない。タグと購読者数のみ。
-- ============================================================
CREATE OR REPLACE FUNCTION admin_watched_tags()
RETURNS TABLE(tag text, subscribers bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT t.tag, count(DISTINCT p.user_id) AS subscribers
    FROM user_profile p
    CROSS JOIN LATERAL unnest(p.watched_tags) AS t(tag)
    WHERE coalesce(t.tag, '') <> ''
    GROUP BY t.tag
    -- OUTパラメータ名(subscribers)と列エイリアスの曖昧衝突を避けるため位置指定
    ORDER BY 2 DESC, 1
    LIMIT 20;
END; $$;
GRANT EXECUTE ON FUNCTION admin_watched_tags() TO authenticated;
