-- OwnNews: Supabase セットアップ用SQL
-- Supabase Dashboard > SQL Editor で実行してください

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

-- image_urlカラムが既存テーブルにない場合の追加用（既にテーブルがある場合）
-- alter table articles add column if not exists image_url text;

-- 3. ユーザーベクトルテーブル
create table if not exists user_vectors (
    user_id    text primary key default 'default',
    vector     vector(768),
    updated_at timestamptz default now()
);

-- 4. ベクトル類似度検索用インデックス
create index if not exists articles_embedding_idx
    on articles using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- 5. 類似度検索RPC関数
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

-- 6. ランダム記事取得RPC関数（セレンディピティ用）
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
