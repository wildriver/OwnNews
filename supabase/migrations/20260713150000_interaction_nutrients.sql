-- 操作履歴に「読んだ記事の栄養素スコア」と「キーワード」を保存する。
-- これまではこれらを端末(IndexedDB)にしか持たず、サーバへは送っていなかった。
-- そのため pull（サーバ→端末の復元）で同期済み行がスコア/キーワードの無い版に
-- 上書きされ、ダッシュボードの「栄養バランス」レーダーが空になり、
-- 「注目キーワード」もリセットされていた（2026-07-13の不具合）。
-- 記事の原本とは別に、本人がいつ何を読んだかの栄養素・キーワードを残すのは
-- 研究用途にも有用。

ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS fact_score        int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS context_score     int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS perspective_score int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS emotion_score     int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS immediacy_score   int;
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS category_minor    text[];
