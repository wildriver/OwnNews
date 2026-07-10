-- 管理ダッシュボード: バブル可視化用の追加RPC
-- Supabase Dashboard > SQL Editor で実行してください。
-- 前提: migrate_admin.sql 実行済み（admin_users / is_admin() が存在）。
--
-- ユーザー×ジャンルの閲覧行列を返す。ヒートマップ・レーダー・
-- 多様性散布図はすべてこの行列からクライアント側で計算する。

CREATE OR REPLACE FUNCTION admin_user_category_matrix()
RETURNS TABLE(user_id text, category text, views bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT i.user_id,
           split_part(i.category, ',', 1) AS category,
           count(*) AS views
    FROM user_interactions i
    WHERE i.interaction_type IN ('view','deep_dive')
      AND coalesce(i.category, '') <> ''
    GROUP BY 1, 2;
END; $$;
GRANT EXECUTE ON FUNCTION admin_user_category_matrix() TO authenticated;
