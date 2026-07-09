-- 閲覧時間(dwell)の保存カラムを user_interactions に追加
-- Supabase Dashboard > SQL Editor で実行してください。
-- dwell_seconds: 記事詳細を実際に見ていた秒数（アクティブ時間）
-- scroll_depth : 最大スクロール到達度（0-1）
-- 興味の強さ推定（すぐ閉じた記事は反映しない／じっくり読んだ記事に重み）に使う。

ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS dwell_seconds int DEFAULT 0;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS scroll_depth float DEFAULT 0;
