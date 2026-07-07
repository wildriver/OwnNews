-- 無料枠恒久運用のための保持ポリシー
-- Supabase Dashboard > SQL Editor で実行してください
--
-- 目的: DBサイズを定常状態（約100〜150MB）に保ち、500MB無料枠内で恒久運用する。
--   1. 旧768次元embedding系の削除（即座に容量を約半減）
--   2. 60日より古い記事の embedding_m3 をNULL化（パックは直近分しか配信しないため影響なし）
--   3. pg_cron による日次自動実行

-- ============================================================
-- 1. 旧768次元系の削除
-- ============================================================
DROP INDEX IF EXISTS articles_embedding_idx;
DROP FUNCTION IF EXISTS match_articles(vector, int);
DROP FUNCTION IF EXISTS random_articles(int);
ALTER TABLE articles DROP COLUMN IF EXISTS embedding;
ALTER TABLE user_vectors DROP COLUMN IF EXISTS vector;

-- ============================================================
-- 2. 保持ポリシー関数
--    embedding_m3（4KB/記事）だけを削り、記事メタデータ（約1KB/記事）は
--    アーカイブとして残す。全削除したい場合は下のDELETE行を有効化。
-- ============================================================
CREATE OR REPLACE FUNCTION apply_retention()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- 60日より古い記事の埋め込みを削除（容量の主成分）
    UPDATE articles
    SET embedding_m3 = NULL
    WHERE embedding_m3 IS NOT NULL
      AND collected_at < now() - interval '60 days';

    -- （任意）2年より古い記事行そのものを削除する場合は次の行を有効化
    -- DELETE FROM articles WHERE collected_at < now() - interval '2 years';
END;
$$;

-- 初回は手動で1回実行
SELECT apply_retention();

-- ============================================================
-- 3. pg_cron で毎日 JST 04:00 (UTC 19:00) に自動実行
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 既存の同名ジョブがあれば置き換え
DO $$
BEGIN
    PERFORM cron.unschedule('ownnews-retention');
EXCEPTION WHEN OTHERS THEN
    NULL;  -- ジョブ未登録なら何もしない
END;
$$;

SELECT cron.schedule('ownnews-retention', '0 19 * * *', 'SELECT apply_retention()');

-- ============================================================
-- 4.（任意・要判断）ローカルファースト化で不要になった
--    旧ユーザテーブルの削除。研究データとして残す場合は実行しないこと。
--    実行するとユーザの旧閲覧履歴・関心ベクトルは完全に失われます。
-- ============================================================
-- DROP TABLE IF EXISTS filter_history;
-- DROP TABLE IF EXISTS health_score_history;
-- DROP TABLE IF EXISTS user_interactions;
-- DROP TABLE IF EXISTS user_vectors;
-- DROP TABLE IF EXISTS user_profile CASCADE;
-- DROP TABLE IF EXISTS deep_dive_cache;
-- DROP FUNCTION IF EXISTS update_user_vector_m3(text);
