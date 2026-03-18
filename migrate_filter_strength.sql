-- filter_strength カラムを user_profile に追加
ALTER TABLE public.user_profile ADD COLUMN IF NOT EXISTS filter_strength float DEFAULT 0.5;

-- filter_history テーブルを作成
CREATE TABLE IF NOT EXISTS filter_history (
    user_id          text NOT NULL,
    filter_strength  float NOT NULL,
    created_at       timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE filter_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "filter_history_all" ON filter_history
    FOR ALL USING (true);
