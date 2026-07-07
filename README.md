# OwnNews: A Personalized, Health-Aware News Curator

OwnNews is a next-generation news curation platform designed to promote "Information Health" by visualizing and balancing the user's information diet. It leverages state-of-the-art Large Language Models (LLMs) and Vector Search technologies to provide a personalized yet balanced news consumption experience.

## 0. Design Philosophy: User-Side Recommendation

OwnNewsの根本思想は**情報推薦エンジンをユーザサイドに置く**ことである。
サーバ側で推薦を行う場合、サーバにユーザの嗜好情報（閲覧履歴）を記憶させる必要がある。
OwnNewsでは記事データを一旦すべてローカルに持ってきて、ユーザ側のエンジンでフィルタし、
そのエンジンをクリック履歴からローカルで更新していく。

- **共有サーバ（運営側Supabase）**: 記事メタデータと埋め込みのみを保持。ユーザの嗜好情報は一切保存しない。
- **ブラウザ（推薦エンジン本体）**: 記事パックをIndexedDBにキャッシュし、関心ベクトルとの類似度計算・フィルターバブル分類・トピッククラスタリングをすべて端末内で実行する。
- **個人Supabase（任意・ユーザ所有）**: 「個人のSupabase = ローカル」モデル。端末間同期やバックアップが必要な場合、ユーザ自身が作成したSupabaseプロジェクト（`personal_supabase_schema.sql`）に閲覧履歴と関心ベクトルを保存する。運営者はアクセスできない。

## 1. System Architecture

### 1.1 Overview
- **Frontend / Recommendation Engine**: Next.js 15 (App Router) on Cloudflare Pages。推薦計算はすべてクライアント（ブラウザ）で実行。
- **Article Pack API**: `/api/pack` が記事メタデータ + int8量子化埋め込みをCDNキャッシュ付きで配信。
- **Backend / AI**: Cloudflare Workers executing AI models (Llama 3, BGE-M3).
- **Shared Database**: Supabase (PostgreSQL + pgvector) — 記事データのみ（全ユーザ共有・読み取り公開）。
- **Data Collection**: Python scripts (GitHub Actions)。ソースは [CEEK.JP NEWS](https://news.ceek.jp/) に加え、NHK・ITmedia・Impress Watch・GIGAZINE・東洋経済オンライン・CNET Japan の公式RSS。

### 1.2 Data Pipeline
1.  **Ingestion**: The collector script fetches news articles via RSS (複数ソース).
2.  **Vectorization**: Content is embedded into 1024-dimensional vectors using **BAAI/bge-m3** (multilingual) on Cloudflare Workers.
3.  **Analysis**: **Meta/Llama-3.1-8b-Instruct** (Workers AI) analyzes the content to:
    - Determine "Nutrient Scores" (Fact, Context, Perspective, Emotion, Immediacy).
    - Assign precise categories.
4.  **Storage**: Metadata and vectors are stored in the shared Supabase.
5.  **Distribution**: Workerが収集サイクル毎に記事パック（メタデータ+int8量子化埋め込み）を生成し **Cloudflare R2**（egress無料）へ書き出す。`/api/pack` はR2上の `pack/latest.json` をCDNキャッシュ付きで配信する（R2未設定時はSupabaseから直接生成にフォールバック）。日次スナップショット `pack/daily/YYYY-MM-DD.json` も保存され、推薦実験の再現に使える。
6.  **Retention**: 共有DBは pg_cron の日次ジョブで60日より古い記事の埋め込みをNULL化し、約100〜150MBの定常サイズを維持する（`migrate_retention.sql`）。

### 1.3 Free-Tier Sustainability
すべて無料枠内で恒久運用できるよう設計されている。

| 要素 | サービス | 無料枠に対する消費 |
|---|---|---|
| 収集 | GitHub Actions（publicリポジトリ） | 分数無制限 |
| AI処理 | Workers AI（+Groqフォールバック） | 埋め込みは軽量。スコアリング逼迫時はGroqへ自動フォールバック |
| 共有DB | Supabase 500MB | 保持ポリシーで約150MBに定常化 |
| 配信 | R2 10GB・egress無料 | パック約1〜2MB。ユーザ数が増えてもコスト不変 |
| 推薦計算 | ユーザの端末 | サーバ負荷ゼロ |

## 2. Algorithmic Details

### 2.1 Information Nutrient Scoring
To quantify the "nutritional value" of information, we employ a 5-axis scoring system calculated by Llama 3:
- **Fact (Protein)**: Objectivity, data presence, and 5W1H clarity.
- **Context (Carbohydrate)**: Background information and historical context.
- **Perspective (Vitamins/Minerals)**: Diversity of viewpoints and pros/cons analysis.
- **Emotion (Fat)**: Emotional appeal and dramatic elements.
- **Immediacy (Water)**: Freshness and urgency of the news.

### 2.2 Personalization Engine (Filter Strength) — Client-Side
すべての推薦計算はブラウザ内で行われる。

- **関心ベクトル**: 閲覧時 $v \leftarrow \mathrm{norm}((1-\alpha)v + \alpha e)$（view: $\alpha=0.12$、deep dive: $\alpha=0.25$）、「興味なし」時 $v \leftarrow \mathrm{norm}(v - \beta e)$（$\beta=0.15$）の指数移動平均で端末内更新。初期値はオンボーディングで選択したカテゴリの記事埋め込み平均。
- **バブル分類**: 記事パックの全記事について $\cos(v, e_i)$ を計算し、しきい値 $0.65$ 以上を「バブル内」（類似度順に最大15件）、未満を「バブル外」とする。
- **Filter Strength** ($S \in [0,1]$): バブル外（発見）ゾーンの表示件数 $\lfloor 15 \times S \rceil$ を制御する。$S$ を上げるほどフィルターバブルの外の記事が増える。スライダーはサーバ往復なしで即時再計算される。
- **埋め込みの量子化**: 配信時にL2正規化後int8量子化（1記事1KB）。コサイン類似度の誤差は0.01未満。

### 2.3 Topic Clustering (Grouping Threshold)
To present diverse perspectives on the same topic, we implement a Greedy Clustering algorithm based on semantic similarity.
- **Metric**: Cosine Similarity.
- **Threshold** ($T$): User-adjustable parameter (default $0.92$).
- **Logic**: For a given sorted list of articles, an article $d_j$ is grouped with a leading article $d_i$ if $Similarity(d_i, d_j) \ge T$.

## 3. Technology Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend Framework** | **Next.js 15** | App Router, Server Components, Edge Runtime |
| **Styling** | **Tailwind CSS** | Utility-first CSS, Glassmorphism UI |
| **Edge Computing** | **Cloudflare Workers** | Global low-latency execution |
| **LLM Inference** | **Workers AI** | Llama-3-8b-Instruct, BAAI/bge-m3 |
| **Shared DB** | **Supabase** | PostgreSQL 15, pgvector extension（記事のみ） |
| **User Data** | **IndexedDB + 個人Supabase（任意）** | 嗜好データはユーザ管理。ログイン不要 |

## 4. Deployment / Operations

初回セットアップ手順（すべて無料枠）:

1. **共有Supabase**: SQL Editorで `schema.sql` → `migrate_m3.sql` → `migrate_nutrients_rpc.sql` → `migrate_sources.sql` → `migrate_retention.sql` を順に実行
2. **R2**: Cloudflare Dashboard > R2 でバケット `ownnews-pack` を作成
3. **Worker**: `cd workers/article-processor && npx wrangler deploy`（Secrets: `SUPABASE_URL`, `SUPABASE_KEY`。任意で `GROQ_API_KEY`）
4. **Web**: mainブランチへのpushで `deploy.yml` が Cloudflare Pages に自動デプロイ（PagesプロジェクトにR2バインディング `PACK_BUCKET` → `ownnews-pack` を設定）
5. **収集**: GitHub Actions の `Collect News` を有効化（60日無活動対策のkeepaliveは組み込み済み）
6. **（ユーザ向け）個人DB**: 各ユーザは自分のSupabaseプロジェクトで `personal_supabase_schema.sql` を実行し、アプリのSettings画面で接続

## 5. Acknowledgments

本研究は，科学研究費補助金（**JP23H00216**）ならびに JSTERATO（**JPMJER2502**）の支援のもと実施されている．
また、ニュースソースとして **[CEEK.JP NEWS](https://news.ceek.jp/)** 様のRSSフィードを利用させていただいております。ここに記して感謝申し上げます。

## 6. Disclaimer

This project is a research prototype. Please verify the accuracy of the AI-generated analysis.
Users should comply with the terms of service of the respective news sources.
