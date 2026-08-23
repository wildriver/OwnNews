# 実DBの制約スナップショット（2026-08-06取得）

2026-08-06のデータ消失事故（schema.sqlに無い `ON DELETE CASCADE` が実DBに存在し、
記事のretentionに連鎖して閲覧履歴が失われた）を受けて、実DBの制約一覧を記録する。
リポジトリのSQLと実DBは乖離しうる。スキーマ変更をしたら、SQL Editorで下記クエリを
再実行してこのファイルを更新すること。

```sql
SELECT format('%s | %s | %s', conrelid::regclass, conname, pg_get_constraintdef(oid))
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype IN ('f','p','u','c')
ORDER BY 1;
```

## 安全性の要点

- **articles を参照する外部キーは存在しない**（事故原因の
  `user_interactions_article_id_fkey` は 20260806160000 で除去済み）。
  記事はretentionで日次削除されるため、articles へのFKは今後も作らないこと。
  再発は `admin_cascade_guard()`（Worker毎実行＋管理画面バナー）が自動検知する。
- `user_profile` 宛てのCASCADEは意図的な設計（退会時に本人データを削除するため）。
- `ux_events`（20260823120000で追加）は**FKを一切持たない**。研究データなので連鎖削除の
  経路を作らない方針。退会時の削除は必要になった時点で明示的に行う。

## 制約一覧

| テーブル | 制約名 | 定義 |
|---|---|---|
| admin_users | admin_users_pkey | PRIMARY KEY (email) |
| article_reactions | article_reactions_pkey | PRIMARY KEY (user_id, article_id, reaction) |
| article_reactions | article_reactions_reaction_check | CHECK (reaction = ANY ('agree','disagree','surprise','insight','doubt','perspective')) |
| article_reactions | article_reactions_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE |
| articles | articles_link_key | UNIQUE (link) |
| articles | articles_pkey | PRIMARY KEY (id) |
| deep_dive_cache | deep_dive_cache_pkey | PRIMARY KEY (article_id) |
| filter_history | filter_history_pkey | PRIMARY KEY (id) |
| filter_history | filter_history_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) |
| health_score_history | health_score_history_pkey | PRIMARY KEY (user_id, score_date) |
| health_score_history | health_score_history_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE |
| public_filters | public_filters_contributor_id_fkey | FOREIGN KEY (contributor_id) REFERENCES user_profile(user_id) |
| public_filters | public_filters_pkey | PRIMARY KEY (filter_id) |
| push_subscriptions | push_subscriptions_pkey | PRIMARY KEY (endpoint) |
| usage_events | usage_events_pkey | PRIMARY KEY (user_id, event, day) |
| usage_events | usage_events_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE |
| user_interactions | user_interactions_pkey | PRIMARY KEY (user_id, article_id, interaction_type) |
| user_interactions | user_interactions_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE |
| user_profile | user_profile_pkey | PRIMARY KEY (user_id) |
| ux_events | ux_events_pkey | PRIMARY KEY (id) |
| user_vectors | user_vectors_pkey | PRIMARY KEY (user_id) |
| watched_tag_events | watched_tag_events_action_check | CHECK (action = ANY ('watch','unwatch')) |
| watched_tag_events | watched_tag_events_pkey | PRIMARY KEY (id) |
| watched_tag_events | watched_tag_events_user_id_fkey | FOREIGN KEY (user_id) REFERENCES user_profile(user_id) ON DELETE CASCADE |
