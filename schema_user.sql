-- OwnNews: 個人DB（ユーザデータ用）セットアップSQL
-- 各ユーザが自分の Supabase Dashboard > SQL Editor で実行してください
-- pgvector拡張が必要です（Supabase Freeプランで利用可能）

-- 1. pgvector拡張を有効化
create extension if not exists vector;

-- 2. ユーザプロファイル
create table if not exists user_profile (
    user_id      uuid primary key default gen_random_uuid(),
    display_name text default '',
    onboarded    boolean default false,
    created_at   timestamptz default now()
);

-- 初期レコードを挿入（1ユーザ = 1個人DB）
insert into user_profile (display_name) values ('')
on conflict do nothing;

-- 3. 関心ベクトル
create table if not exists user_vectors (
    user_id    text primary key default 'default',
    vector     vector(768),
    updated_at timestamptz default now()
);

-- 4. 閲覧履歴
create table if not exists user_interactions (
    user_id          text not null default 'default',
    article_id       text not null,
    interaction_type text not null,  -- 'view', 'deep_dive', 'not_interested'
    created_at       timestamptz default now(),
    primary key (user_id, article_id, interaction_type)
);
