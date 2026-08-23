-- 観察研究のための計測基盤。
-- 目的: 「利用者は状況に応じて情報摂取の強度を変えたか」「バブルの外を実際に読んだか」を
--       同一ユーザの時系列として復元できるようにする。
-- いずれも本人のみアクセス可（RLS）。運営は既存の匿名集計RPC経由でのみ観測する。

-- 1) UXイベント（スライダー操作・面のインプレッション・ダッシュボード閲覧）
--    filter_history は作成済みだが書き込み経路が無く、強度は現在値のみが上書き保存
--    されていた（＝変動が消えていた）。汎用イベント表に統合する。
CREATE TABLE IF NOT EXISTS public.ux_events (
    id            bigserial PRIMARY KEY,
    user_id       text NOT NULL,
    event_type    text NOT NULL,      -- filter_change | impression | open
    surface       text,               -- slider | dashboard | missed_news | in_bubble | outside_bubble | topic | search
    value_from    double precision,   -- filter_change: 変更前の強度
    value_to      double precision,   -- filter_change: 変更後の強度
    meta          jsonb,
    client_at     timestamptz NOT NULL,   -- 端末時刻（端末の時計は管理外）
    server_at     timestamptz NOT NULL DEFAULT now()  -- 受信時刻。ズレ検出用
);

CREATE INDEX IF NOT EXISTS ux_events_user_time ON public.ux_events (user_id, client_at);
CREATE INDEX IF NOT EXISTS ux_events_type ON public.ux_events (event_type, surface);

ALTER TABLE public.ux_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ux_events_own" ON public.ux_events;
CREATE POLICY "ux_events_own" ON public.ux_events
    FOR ALL USING (user_id = auth.jwt() ->> 'email')
    WITH CHECK (user_id = auth.jwt() ->> 'email');

-- 2) クリックの出自。どの面から開いた記事かが無いと
--    「バブルの外を読んだ」と一言も言えない。
ALTER TABLE public.user_interactions
    ADD COLUMN IF NOT EXISTS source_surface text;

-- 3) コホート基準日。縦断分析の横軸は暦日ではなく「利用開始からのN日目」。
--    最古のinteraction行から逆算する方式は、アーカイブ欠損で整列が壊れる。
ALTER TABLE public.user_profile
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz DEFAULT now();
