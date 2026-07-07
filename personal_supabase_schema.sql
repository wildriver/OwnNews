-- OwnNews 個人DB（あなた専用のSupabaseプロジェクト）用スキーマ
--
-- 「個人のSupabase = ローカル」モデル:
-- 閲覧履歴と関心ベクトルは運営側の共有DBには保存されず、
-- あなた自身が作成したSupabaseプロジェクトにのみ保存されます。
--
-- 使い方:
--   1. https://supabase.com で自分のプロジェクトを作成（Freeプランで十分）
--   2. Dashboard > SQL Editor でこのファイルの内容を実行
--   3. OwnNews の Settings 画面で Project URL と anon key を入力
--
-- 注意: このDBはあなた1人で使う前提です。anon key を知っている人は
-- データを読み書きできるため、keyは他人と共有しないでください。

-- 閲覧履歴（記事メタデータのスナップショット付き）
create table if not exists my_interactions (
    article_id        text not null,
    interaction_type  text not null,   -- 'view' | 'deep_dive' | 'not_interested'
    created_at        timestamptz default now(),
    category          text default '',
    category_medium   text default '',
    category_minor    text[] default '{}',
    fact_score        int,
    context_score     int,
    perspective_score int,
    emotion_score     int,
    immediacy_score   int,
    primary key (article_id, interaction_type)
);

-- エンジン状態（関心ベクトル・フィルタ強度）: 常に1行のみ
create table if not exists my_state (
    id              int primary key default 1 check (id = 1),
    vector          jsonb,            -- 1024次元の関心ベクトル
    filter_strength float default 0.5,
    updated_at      timestamptz default now()
);
