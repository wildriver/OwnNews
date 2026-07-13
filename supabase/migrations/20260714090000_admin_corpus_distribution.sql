-- 運営ダッシュボード用: 記事母集団の「真の」ジャンル分布（articlesテーブルの実データ）。
-- ユーザー画面の「いま配信中の記事の母集団」は端末キャッシュ（最大1500件）を見ており、
-- 収集の実態＝サーバの記事テーブルとはズレる。運営には retention 期間内（直近30日）の
-- 実際の記事分布を返す。is_admin() ガード + SECURITY DEFINER（migrate_admin.sql踏襲）。

CREATE OR REPLACE FUNCTION admin_corpus_distribution()
RETURNS TABLE(category text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
    RETURN QUERY
    SELECT split_part(a.category, ',', 1) AS category, count(*) AS cnt
    FROM articles a
    WHERE a.collected_at > now() - interval '30 days'
      AND coalesce(a.category, '') <> ''
    GROUP BY 1
    ORDER BY 2 DESC;
END; $$;
GRANT EXECUTE ON FUNCTION admin_corpus_distribution() TO authenticated;
