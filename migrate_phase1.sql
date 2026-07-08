-- Phase 1: 運営Supabaseにユーザー単位で推薦データを保存（Googleログインで識別）
-- Supabase Dashboard > SQL Editor で実行してください。
--
-- 方針:
--   - user_id は Google のメールアドレス（JWTの email クレーム）
--   - 各ユーザーは自分の行のみ読み書き（RLS）。運営は service_role で全体を観測可能
--   - 保存するのは「推薦に使う情報」= 関心ベクトル / フィルタ強度 / カテゴリON-OFF / 操作履歴
--   - 推薦の計算自体は各ユーザーの端末で実行（サーバーは保存と配信のみ）

-- 前提: schema.sql / migrate_m3.sql は実行済み（user_profile, user_vectors, user_interactions が存在）

-- ============================================================
-- 1. カラム追加（設定と履歴スナップショット）
-- ============================================================
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS filter_strength float DEFAULT 0.5;
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS excluded_categories text[] DEFAULT '{}';
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 記事がpruneされても履歴表示できるよう、操作時のメタをスナップショット保存
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS category text DEFAULT '';
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS category_medium text DEFAULT '';
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS title text DEFAULT '';
ALTER TABLE user_interactions ADD COLUMN IF NOT EXISTS link text DEFAULT '';

-- ============================================================
-- 2. RLSを「本人限定」に修正
--    旧ポリシー using(true) は誰でも読めた（匿名キーは公開されるため脆弱）。
--    JWTのemailクレームと user_id が一致する行だけに制限する。
-- ============================================================
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_profile_all" ON user_profile;
DROP POLICY IF EXISTS "user_profile_own" ON user_profile;
CREATE POLICY "user_profile_own" ON user_profile FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);

ALTER TABLE user_vectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_vectors_all" ON user_vectors;
DROP POLICY IF EXISTS "user_vectors_own" ON user_vectors;
CREATE POLICY "user_vectors_own" ON user_vectors FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);

ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_interactions_all" ON user_interactions;
DROP POLICY IF EXISTS "user_interactions_own" ON user_interactions;
CREATE POLICY "user_interactions_own" ON user_interactions FOR ALL
    USING ((auth.jwt() ->> 'email') = user_id)
    WITH CHECK ((auth.jwt() ->> 'email') = user_id);

-- ============================================================
-- 3. インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS user_interactions_user_created_idx
    ON user_interactions (user_id, created_at DESC);

-- ============================================================
-- 4. 運営向け観測ビュー（service_role / SQL Editorから）
--    ユーザーごとのフィルタ強度・操作数・カテゴリ偏りの俯瞰。
--    RLS対象外の集計なので、Dashboard(service_role)からのみ見える。
-- ============================================================
CREATE OR REPLACE VIEW admin_user_overview AS
SELECT
    p.user_id,
    p.filter_strength,
    p.excluded_categories,
    p.updated_at AS profile_updated_at,
    (SELECT count(*) FROM user_interactions i
       WHERE i.user_id = p.user_id AND i.interaction_type IN ('view','deep_dive')) AS views,
    (SELECT count(*) FROM user_interactions i
       WHERE i.user_id = p.user_id AND i.interaction_type = 'not_interested') AS dismissed
FROM user_profile p;
