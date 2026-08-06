-- 閲覧履歴が記事のretentionで道連れ削除される問題の修正（2026-08-06の事故対応）
--
-- 事故の経緯:
--   実DBには schema.sql に記載の無い制約
--     user_interactions_article_id_fkey
--       FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
--   が張られていた。2026-08-02にDBサイズ超過対策としてWorkerのretentionを
--   30日→7日に短縮した際、約85,000件の記事削除に連鎖して閲覧履歴が失われた
--   （user_interactions の n_tup_del=754、生存行は記事と同じ7日境界で切れていた）。
--
-- なぜ制約を落とすのが正しいか:
--   user_interactions は migrate_phase1.sql で title/link/category/栄養素スコアを
--   スナップショット保存する設計に変更済みで、「記事がpruneされても履歴は残る」
--   ことが前提になっている（管理RPCも articles をJOINしていない）。
--   原設計の schema.sql にもこのFKは無い。記事は7日で消えるが履歴は研究データ
--   として恒久保存すべきものなので、両者のライフサイクルを分離する。
--
-- 副次的効果:
--   端末に残るローカル履歴をサーバーへ復元する経路（sync.tsの安全弁）は、
--   このFKがあると「記事が既に無い」履歴のINSERTが弾かれて機能しない。
--   本マイグレーション適用後に復元が可能になる。

ALTER TABLE user_interactions
    DROP CONSTRAINT IF EXISTS user_interactions_article_id_fkey;
