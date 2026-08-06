-- 危険な CASCADE 制約の検出（2026-08-06の事故の再発防止）
--
-- 事故の根本原因は「schema.sql に記載の無い ON DELETE CASCADE が実DBに存在した」
-- ことだった。articles は retention で日常的に大量削除されるため、articles を
-- 参照する CASCADE 制約は、そのまま「記事を消すと関連データも道連れ」を意味する。
-- リポジトリのSQLを読むだけでは気づけないので、実DBに問い合わせて検出する。
--
-- 呼び出し元:
--   - Worker（service_role）: 毎実行でチェックし、見つかればエラーログを出す
--   - 管理画面（is_admin）: 見つかれば警告バナーを表示する
--
-- 返すのはスキーマのメタデータのみで、ユーザーデータは一切含まない。

CREATE OR REPLACE FUNCTION admin_cascade_guard()
RETURNS TABLE(child_table text, constraint_name text, definition text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
    -- Worker（service_role）と管理者のみ。一般ユーザーにはスキーマ情報も見せない
    IF coalesce(auth.role(), '') <> 'service_role' AND NOT is_admin() THEN
        RAISE EXCEPTION 'not authorized';
    END IF;

    RETURN QUERY
    SELECT c.conrelid::regclass::text,
           c.conname::text,
           pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    WHERE c.confrelid = 'articles'::regclass
      AND c.confdeltype = 'c'          -- 'c' = ON DELETE CASCADE
    ORDER BY 1;
END; $$;

GRANT EXECUTE ON FUNCTION admin_cascade_guard() TO authenticated, service_role;
