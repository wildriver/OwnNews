-- 操作履歴に「読んだ記事の栄養素スコア」を保存する。
-- これまでは栄養素スコアを端末(IndexedDB)にしか持たず、サーバへは送っていなかった。
-- そのため pull（サーバ→端末の復元）で同期済み行がスコアの無い版に上書きされ、
-- ダッシュボードの「栄養バランス」レーダーが空になっていた（2026-07-13の不具合）。
-- 記事の原本とは別に、本人がいつ何を読んだかの栄養素を残すのは研究用途にも有用。

ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS fact_score        int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS context_score     int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS perspective_score int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS emotion_score     int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS immediacy_score   int;
