-- ウォッチタグの購読/解除イベントログ。
-- watched_tags（現在アクティブな配列）とは別に、「いつ何を気にし始め、
-- いつ手放したか」という関心の変遷の歴史を残す（本人のみRLS）。
-- 将来ダッシュボードの「関心タグの変遷」表示や研究分析に使う。
CREATE TABLE IF NOT EXISTS watched_tag_events (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    text NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    tag        text NOT NULL,
    action     text NOT NULL CHECK (action IN ('watch', 'unwatch')),
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watched_tag_events_user_idx ON watched_tag_events (user_id, created_at DESC);

ALTER TABLE watched_tag_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS watched_tag_events_own ON watched_tag_events;
CREATE POLICY watched_tag_events_own ON watched_tag_events FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);
