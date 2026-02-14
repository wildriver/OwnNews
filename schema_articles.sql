-- OwnNews: 共有DB（記事用）セットアップSQL
-- 運営者が Supabase Dashboard > SQL Editor で実行してください
-- このDBは記事データのみを格納し、全ユーザに対してREAD-ONLYで公開します

-- 1. pgvector拡張を有効化
create extension if not exists vector;

-- 2. 記事テーブル（embeddingカラム付き）
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

-- 3. ベクトル類似度検索用インデックス
create index if not exists articles_embedding_idx
    on articles using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- 4. 類似度検索RPC関数
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

-- 5. ランダム記事取得RPC関数（セレンディピティ用）
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

-- 6. 公開フィルタテーブル（Phase 2 で使用）
create table if not exists public_filters (
    filter_id      uuid primary key default gen_random_uuid(),
    name           text not null,
    description    text,
    vector         vector(768) not null,
    category_dist  jsonb,
    contributor_id uuid,
    created_at     timestamptz default now()
);

-- 7. RLS（Row Level Security）
-- 記事テーブル: 全ユーザにSELECTのみ許可
alter table articles enable row level security;
create policy "articles_select_all" on articles
    for select using (true);

-- 公開フィルタテーブル: SELECTは全員、INSERTは認証ユーザ
alter table public_filters enable row level security;
create policy "public_filters_select_all" on public_filters
    for select using (true);
create policy "public_filters_insert_auth" on public_filters
    for insert with check (true);
