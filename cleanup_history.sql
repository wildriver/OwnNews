-- 履歴の「タイトル不明」行の整理
-- Supabase Dashboard > SQL Editor で実行してください。
-- Phase1以前に記録された、タイトル等のスナップショットが無い古い履歴を対象に、
--   1) 記事がまだ存在するものは articles テーブルからタイトル等を補完（履歴を残す）
--   2) 記事がもう存在せず補完できないものは削除
-- を行う。実行後、各端末は次回の同期でこの変更（補完・削除）を取り込む。

-- 1) 補完（記事が残っているもの）
UPDATE user_interactions ui
SET title    = a.title,
    link     = COALESCE(NULLIF(ui.link, ''), a.link),
    category = COALESCE(NULLIF(ui.category, ''), a.category)
FROM articles a
WHERE a.id = ui.article_id
  AND (ui.title IS NULL OR ui.title = '');

-- 2) 補完できなかった（記事が既に無い）タイトル不明の行を削除
DELETE FROM user_interactions
WHERE title IS NULL OR title = '';

-- 補完/削除の結果を確認したい場合:
-- SELECT count(*) FILTER (WHERE title IS NULL OR title = '') AS remaining_untitled,
--        count(*) AS total
-- FROM user_interactions;
