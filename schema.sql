-- OwnNews: 統合DBスキーマ（記事 + ユーザデータ）
-- 運営者が Supabase Dashboard > SQL Editor で実行してください
-- Google OAuth 認証でユーザを識別し、email を user_id として使用します

-- 1. pgvector拡張を有効化
create extension if not exists vector;

-- 2. 記事テーブル（全ユーザ共有）
create table if not exists articles (
    id           text primary key,
    title        text not null,
    link         text not null unique,
    summary      text,
    published    text,
    category     text,
    image_url    text,
    embedding    vector(768),
    collected_at timestamptz default now()
);

-- 3. ユーザプロファイル（Google email = primary key）
create table if not exists user_profile (
    user_id      text primary key,  -- Google email アドレス
    display_name text default '',
    onboarded    boolean default false,
    created_at   timestamptz default now()
);

-- 4. ユーザ関心ベクトル
create table if not exists user_vectors (
    user_id    text primary key references user_profile(user_id) on delete cascade,
    vector     vector(768),
    updated_at timestamptz default now()
);

-- 5. ユーザインタラクション履歴
create table if not exists user_interactions (
    user_id          text not null references user_profile(user_id) on delete cascade,
    article_id       text not null,
    interaction_type text not null,  -- 'view', 'deep_dive', 'not_interested'
    created_at       timestamptz default now(),
    primary key (user_id, article_id, interaction_type)
);

-- 6. 情報的健康スコア履歴
create table if not exists health_score_history (
    user_id      text not null references user_profile(user_id) on delete cascade,
    score_date   date not null,
    diversity    float,
    bias_ratio   float,
    top_category text,
    detail       jsonb,
    primary key (user_id, score_date)
);

-- 8. 公開フィルタ（Phase 2 用）
create table if not exists public_filters (
    filter_id      uuid primary key default gen_random_uuid(),
    name           text not null,
    description    text,
    vector         vector(768) not null,
    category_dist  jsonb,
    contributor_id text references user_profile(user_id),
    created_at     timestamptz default now()
);

-- 9. ベクトル類似度検索用インデックス
create index if not exists articles_embedding_idx
    on articles using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- 10. パフォーマンス用インデックス
create index if not exists user_interactions_user_id_idx
    on user_interactions(user_id);
create index if not exists user_interactions_created_at_idx
    on user_interactions(created_at desc);

-- 11. 類似度検索RPC関数（既存の関数を削除してから再作成）
drop function if exists match_articles(vector, int);
create or replace function match_articles(
    query_vector vector(768),
    match_count  int
)
returns table (
    id         text,
    title      text,
    link       text,
    summary    text,
    published  text,
    category   text,
    image_url  text,
    similarity float
)
language sql stable
as $$
    select
        a.id, a.title, a.link, a.summary, a.published, a.category,
        a.image_url,
        1 - (a.embedding <=> query_vector) as similarity
    from articles a
    where a.embedding is not null
    order by a.embedding <=> query_vector
    limit match_count;
$$;

-- 12. ランダム記事取得RPC関数
drop function if exists random_articles(int);
create or replace function random_articles(pick_count int)
returns table (
    id        text,
    title     text,
    link      text,
    summary   text,
    published text,
    category  text,
    image_url text
)
language sql stable
as $$
    select a.id, a.title, a.link, a.summary, a.published, a.category, a.image_url
    from articles a
    where a.embedding is not null
    order by random()
    limit pick_count;
$$;

-- 13. RLSポリシー
alter table articles enable row level security;
create policy "articles_select_all" on articles
    for select using (true);
-- articles への INSERT/UPDATE は GitHub Actions（service_role key）のみ

alter table user_profile enable row level security;
create policy "user_profile_all" on user_profile
    for all using (true);

alter table user_vectors enable row level security;
create policy "user_vectors_all" on user_vectors
    for all using (true);

alter table user_interactions enable row level security;
create policy "user_interactions_all" on user_interactions
    for all using (true);

alter table health_score_history enable row level security;
create policy "health_score_history_all" on health_score_history
    for all using (true);

alter table public_filters enable row level security;
create policy "public_filters_select_all" on public_filters
    for select using (true);
create policy "public_filters_insert" on public_filters
    for insert with check (true);
