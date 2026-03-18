-- migrate_user_vector_auto.sql
-- 閲覧履歴から user_vectors.vector_m3 を自動更新する RPC
--
-- 使い方: Supabase ダッシュボード > SQL Editor で実行
-- 実行後、記事を閲覧するたびに /api/interact が自動でこの関数を呼び出す

CREATE OR REPLACE FUNCTION update_user_vector_m3(p_user_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  new_vector vector(1024);
BEGIN
  -- 直近50件の閲覧記事の embedding_m3 を平均化（pgvector の avg() 集計関数を使用）
  SELECT avg(a.embedding_m3)
  INTO new_vector
  FROM (
    SELECT article_id
    FROM user_interactions
    WHERE user_id = p_user_id
      AND interaction_type = 'view'
    ORDER BY created_at DESC
    LIMIT 50
  ) recent
  JOIN articles a ON a.id = recent.article_id
  WHERE a.embedding_m3 IS NOT NULL;

  -- ベクトルが取得できた場合のみ upsert（閲覧記事が 0 件または embedding がない場合はスキップ）
  IF new_vector IS NOT NULL THEN
    INSERT INTO user_vectors (user_id, vector_m3, updated_at)
    VALUES (p_user_id, new_vector, now())
    ON CONFLICT (user_id) DO UPDATE
      SET vector_m3 = EXCLUDED.vector_m3,
          updated_at = now();
  END IF;
END;
$$;
