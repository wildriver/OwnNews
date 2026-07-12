-- ウォッチタグ（タグ購読）: 「このタグを含む記事は確実に見たい」の表明。
-- 端末間同期のため user_profile に保存（本人のみRLS・推薦学習には使わない）。
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS watched_tags text[] DEFAULT '{}';
