-- 管理者ダッシュボード（運営向け観測）
-- Supabase Dashboard > SQL Editor で実行してください。
--
-- 方針:
--   - service_role キーをエッジ（Cloudflare Pages）に置かない。
--     認証済みの匿名キー＋ユーザーJWTのまま、集計を「運営だけ」に開く。
--   - 集計は全て SECURITY DEFINER 関数（RLSを跨いで全ユーザーを集計できる）。
--     ただし各関数の冒頭で is_admin() を検査し、管理者以外は例外で弾く。
--     → 匿名キーが公開されても、admin_users に登録された運営以外は何も読めない。
--   - 個々のユーザーの「推薦の中身（ベクトル本体）」は覗かない。あくまで
--     利用者数・閲覧状況・フィルタ強度の分布・バブル集中度といった集計のみ。
--
-- 前提: migrate_phase1.sql / migrate_push.sql / migrate_dwell.sql は実行済み。

-- ============================================================
-- 1. 管理者テーブルと判定関数
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    email      text PRIMARY KEY,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
-- 自分が管理者かどうかの確認のためだけに、自分の行だけ読める
DROP POLICY IF EXISTS admin_users_self ON admin_users;
CREATE POLICY admin_users_self ON admin_users FOR SELECT
    USING ((auth.jwt() ->> 'email') = email);

-- ▼▼▼ ここに運営のログイン用メール（Googleログインで使うアドレス）を登録 ▼▼▼
-- INSERT INTO admin_users(email) VALUES ('you@example.com') ON CONFLICT DO NOTHING;
-- ▲▲▲ 複数人を運営にする場合は行を増やす ▲▲▲

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS(
        SELECT 1 FROM admin_users WHERE email = (auth.jwt() ->> 'email')
    );
$$;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- ============================================================
-- 2. 全体サマリ
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
        'avg_dwell_sec',    (SELECT round(avg(dwell_seconds)::numeric, 1) FROM user_interactions WHERE dwell_seconds > 0)
    ) INTO result;
    RETURN result;
END; $$;
GRANT EXECUTE ON FUNCTION admin_summary() TO authenticated;

-- ============================================================
-- 3. 日次アクティビティ推移（欠測日は0埋め）
-- ============================================================
CREATE OR REPLACE FUNCTION admin_daily_activity(days int DEFAULT 30)
RETURNS TABLE(day date, views bigint, active_users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT d::date AS day,
           count(i.*) FILTER (WHERE i.interaction_type IN ('view','deep_dive')) AS views,
           count(DISTINCT i.user_id)                                            AS active_users
    FROM generate_series(current_date - (days - 1), current_date, interval '1 day') d
    LEFT JOIN user_interactions i
      ON i.created_at >= d AND i.created_at < d + interval '1 day'
    GROUP BY d
    ORDER BY d;
END; $$;
GRANT EXECUTE ON FUNCTION admin_daily_activity(int) TO authenticated;

-- ============================================================
-- 4. 全体のジャンル分布（全ユーザーの閲覧を合算）
--    category は "大,中" のカンマ連結なので先頭（大分類）で集計。
-- ============================================================
CREATE OR REPLACE FUNCTION admin_category_distribution()
RETURNS TABLE(category text, views bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT split_part(i.category, ',', 1) AS category, count(*) AS views
    FROM user_interactions i
    WHERE i.interaction_type IN ('view','deep_dive')
      AND coalesce(i.category, '') <> ''
    GROUP BY 1
    ORDER BY 2 DESC;
END; $$;
GRANT EXECUTE ON FUNCTION admin_category_distribution() TO authenticated;

-- ============================================================
-- 5. フィルタ強度のヒストグラム（フィルタバブルの違いの核心指標）
--    0=じぶんのバブル寄り / 1=視野を広げる。ユーザーごとの設定の散らばりを見る。
-- ============================================================
CREATE OR REPLACE FUNCTION admin_filter_histogram()
RETURNS TABLE(bucket text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT b.label AS bucket, count(p.user_id) AS cnt
    FROM (VALUES
        ('0.0–0.2', 0.0::float, 0.2::float),
        ('0.2–0.4', 0.2,        0.4),
        ('0.4–0.6', 0.4,        0.6),
        ('0.6–0.8', 0.6,        0.8),
        ('0.8–1.0', 0.8,        1.0001)
    ) AS b(label, lo, hi)
    LEFT JOIN user_profile p
      ON p.filter_strength >= b.lo AND p.filter_strength < b.hi
    GROUP BY b.label, b.lo
    ORDER BY b.lo;
END; $$;
GRANT EXECUTE ON FUNCTION admin_filter_histogram() TO authenticated;

-- ============================================================
-- 6. ユーザー別の観測テーブル
--    views/deep_dives/dismissed/最終アクティブ/フィルタ強度に加え、
--    top_category（最も読むジャンル）と top_ratio（それが閲覧全体に占める割合）
--    = 「バブル集中度」。高いほど単一ジャンルに偏っている＝バブルが強い。
-- ============================================================
CREATE OR REPLACE FUNCTION admin_user_detail()
RETURNS TABLE(
    user_id        text,
    filter_strength float,
    views          bigint,
    deep_dives     bigint,
    dismissed      bigint,
    last_active    timestamptz,
    top_category   text,
    top_ratio      numeric
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
               max(b.created_at)                                                   AS last_active
        FROM base b
        GROUP BY b.user_id
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
           tc.top_ratio
    FROM user_profile p
    LEFT JOIN agg a     ON a.user_id = p.user_id
    LEFT JOIN topcat tc ON tc.user_id = p.user_id
    ORDER BY a.last_active DESC NULLS LAST;
END; $$;
GRANT EXECUTE ON FUNCTION admin_user_detail() TO authenticated;
