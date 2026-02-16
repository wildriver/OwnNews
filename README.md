# OwnNews — パーソナル・ニュースキュレーター

Google認証で誰でもすぐに使える、パーソナライズされたニュースキュレーターです。最新のNext.js App RouterとCloudflare Workers AIを組み合わせたアーキテクチャに進化しました。

## コンセプト

- **ゼロセットアップ**: Googleアカウントでログインするだけで利用開始
- **情報的健康**: 情報摂取の偏りを可視化し、バランスの良い情報収集をサポート
- **個人化と探索の両立**: 独自のアルゴリズムにより、好きな話題と新しい発見をブレンド
- **多角的視点**: 似た内容の記事を自動グルーピングし、異なるメディアの報じ方を比較

## アーキテクチャ

```text
GitHub Actions (Python)
  │  ① RSS取得 (news.ceek.jp)
  │  ② Cloudflare Workers (article-processor) へ送信
  ▼
Cloudflare Workers (AI Processor)
  │  ③ BGE-M3 によるベクトル化
  │  ④ Llama 3 による多段階カテゴリ分類
  ▼
Supabase (PostgreSQL + pgvector)
  │  ⑤ 記事・ベクトルの保存
  │  ⑥ ユーザープロフィール・履歴管理
  ▼
Next.js Web App (Vercel/Cloudflare Pages)
  │  ⑦ パーソナライズド・ランキング・エンジン
  │  ⑧ 「別の視点」グルーピング・エンジン
  └─ UI: Tailwind CSS + Lucide Icons
```

## 技術スタック

| 役割 | テクノロジー / サービス |
|------|-------------------------|
| **Frontend** | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| **Backend** | Next.js Server Actions, Supabase (Auth/Database) |
| **Database** | PostgreSQL + pgvector (Supabase) |
| **AI Processing** | Cloudflare Workers AI, BGE-M3 (Embedding), Llama 3 (Classification) |
| **Collector** | Python, GitHub Actions |
| **Discovery** | Groq API (分析・深掘り) |

## 開発者向けセットアップ

### 1. Supabase の設定
1. [Supabase](https://supabase.com) でプロジェクトを作成
2. `migrate_taxonomy.sql` および `migrate_m3.sql` を実行してテーブルと関数を作成
3. Auth設定で Google Provider を有効化

### 2. Cloudflare Workers のデプロイ
1. `workers/article-processor` ディレクトリで `npx wrangler deploy` を実行
2. Workers の環境変数に Supabase の API 情報を設定

### 3. Web アプリケーションの起動
1. `web` ディレクトリへ移動
2. `.env.local` に必要な環境変数（Supabase, Groq等）を設定
3. `npm install`
4. `npm run dev`

### 4. 記事収集スクリプト
1. ルートディレクトリの `collector.py` を実行（または GitHub Actions で定期実行）

## 主要機能

### ニュースフィード
- **フィルタ強度設定**: パーソナライズ（個人化）の度合いをスライダーで調整
- **まとめ強度設定**: 関連記事をどの程度厳密にグルーピングするかを調整（コサイン類似度）
- **深掘り機能**: 記事の内容を AI が分析し、背景知識や関連情報を提示

### ダッシュボード & 情報的健康
- **カテゴリ分布**: 自分がどのジャンルの記事を多く読んでいるかを可視化
- **時間軸分析**: 興味関心の移り変わりを期間別（週/月/3ヶ月）で確認

## 免責事項
本プロジェクトは研究・学習目的のプロトタイプです。RSSフィードの利用規約に従ってご利用ください。
