-- Web Push: 購読情報テーブル
-- Supabase Dashboard > SQL Editor で実行してください。
-- 各ユーザーの通知購読（endpoint + 鍵）を保存する。本人のみ読み書き（RLS）。
-- 送信はWorkerがservice_roleで全購読を読み出して行う。

CREATE TABLE IF NOT EXISTS push_subscriptions (
    user_id    text NOT NULL,           -- Google のメールアドレス
    endpoint   text NOT NULL,           -- プッシュサービスのエンドポイントURL
    p256dh     text NOT NULL,           -- 購読の公開鍵（将来ペイロード暗号化する場合に使用）
    auth       text NOT NULL,           -- 購読の認証シークレット
    user_agent text DEFAULT '',
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (endpoint)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_own" ON push_subscriptions;
CREATE POLICY "push_own" ON push_subscriptions FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);
