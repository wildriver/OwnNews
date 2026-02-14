# OwnNews — 分散型パーソナル・ニュースキュレーター

中央集権的なプラットフォーマーに依存せず、ユーザーが自分のデータを自分で管理する分散型ニュースキュレーターです。記事データは共有DBで提供し、閲覧履歴・学習データは各ユーザーの個人DBで管理します。

## コンセプト

- **分散アーキテクチャ**: 記事は共有DB（運営者管理）、ユーザデータは個人DB（ユーザ管理）
- **情報的健康**: 食事の栄養バランスのアナロジーで情報摂取の偏りを可視化
- **コールドスタート解決**: オンボーディングでカテゴリ選択 + 記事投票

## アーキテクチャ

```
GitHub Actions (1日5回cron)
  │  ① RSS取得 (news.ceek.jp)
  │  ② Cloudflare Workers AI でベクトル化
  │  ③ 共有DB へ保存
  ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│  共有DB（運営者管理）      │     │  個人DB（ユーザ管理）      │
│  Supabase + pgvector     │     │  Supabase + pgvector     │
│  ├─ articles (embedding) │     │  ├─ user_profile         │
│  ├─ match_articles() RPC │     │  ├─ user_vectors         │
│  ├─ random_articles() RPC│     │  └─ user_interactions    │
│  └─ public_filters (Ph2) │     │                          │
│  → SELECT のみ許可 (RLS)  │     │  → 各ユーザが自分で用意   │
└───────────┬──────────────┘     └──────────┬───────────────┘
            │ 記事取得（読み取り専用）         │ ユーザデータ（読み書き）
            └───────────┬──────────────────────┘
                        ▼
              ┌──────────────────┐
              │  Streamlit Cloud │
              │  (UI)            │
              │  ├─ オンボーディング│
              │  ├─ ニュースフィード│
              │  ├─ 情報的健康パネル│
              │  ├─ ダッシュボード  │
              │  └─ 🔍 深掘り→Groq│
              └──────────────────┘
```

| 役割 | サービス | 無料枠 |
|------|---------|--------|
| 定期収集 | GitHub Actions | パブリックリポジトリ無制限 |
| 共有DB | Supabase (Postgres + pgvector) | 500MB DB |
| 個人DB | Supabase (各ユーザ) | 500MB DB |
| 埋め込み | Cloudflare Workers AI | 10,000 neurons/日 |
| 深掘り推論 | Groq API | 無料枠あり |
| UI | Streamlit Community Cloud | パブリックアプリ無料 |

## セットアップ

### 運営者向け（共有DB + 収集パイプライン）

#### 1. 共有DB (Supabase) を作成

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. **SQL Editor** で [schema_articles.sql](schema_articles.sql) を実行
3. **Project Settings > API** から URL と anon key を控える

#### 2. Cloudflare Workers AI を設定

1. [dash.cloudflare.com](https://dash.cloudflare.com) でアカウント作成
2. **Workers & Pages** から Account ID を取得
3. **My Profile > API Tokens** で Workers AI Read 権限のトークンを作成

#### 3. GitHub リポジトリ設定

Repository secrets に以下を登録:

| Name | 値 |
|------|---|
| `SUPABASE_URL` | 共有DBの Project URL |
| `SUPABASE_KEY` | 共有DBの anon public キー |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | Cloudflare API Token |

#### 4. 動作確認

**Actions** タブ > **Collect News** > **Run workflow** で手動実行。

### 利用者向け（個人DB + アプリ）

#### 1. 個人DB (Supabase) を作成

1. [supabase.com](https://supabase.com) で **自分用の** プロジェクトを作成
2. **SQL Editor** で [schema_user.sql](schema_user.sql) を実行
3. **Project Settings > API** から URL と anon key を控える

#### 2. Streamlit アプリを設定

Streamlit Community Cloud（または ローカル）で `.streamlit/secrets.toml` を設定:

```toml
# 共有DB（運営者から提供される値）
ARTICLES_SUPABASE_URL = "https://xxxxx.supabase.co"
ARTICLES_SUPABASE_KEY = "eyJ..."

# 個人DB（自分のSupabase）
USER_SUPABASE_URL = "https://yyyyy.supabase.co"
USER_SUPABASE_KEY = "eyJ..."

# オプション
GROQ_API_KEY = "gsk_..."
```

#### 3. 初回起動

アプリを開くとオンボーディング画面が表示されます:
1. 興味のあるカテゴリを選択
2. 表示される記事に 👍/👎 で投票
3. 初期関心ベクトルが生成され、パーソナライズされたフィードが表示されます

## 使い方

### ニュースタブ

- **フィルタ強度**: 1.0（パーソナライズ強） ↔ 0.0（多様性重視）
- **👁 閲覧記録**: 弱い正のフィードバック (α=0.03)
- **🔍 深掘り**: Groq API で背景分析 + 強い正のフィードバック (α=0.15)
- **👎 興味なし**: 強い負のフィードバック (α=-0.2)

### 情報的健康パネル（サイドバー）

食事の栄養バランスのアナロジーで、情報摂取の偏りを可視化します:

| 指標 | 計算方法 |
|------|---------|
| 多様性スコア | Shannon entropy（0-100に正規化） |
| 偏食度 | 最頻カテゴリの占有率 |
| 不足カテゴリ | 閲覧数0のカテゴリを提案 |

### ダッシュボードタブ

- 統計（総記事数、閲覧数、興味なし数）
- カテゴリ別閲覧グラフ
- 日別記事収集数
- 閲覧履歴・除外履歴

### フィルタ比較タブ（Phase 2）

将来的に実装予定:
- 自分のフィルタを公開
- 他ユーザのフィルタでニュースを閲覧
- 情報摂取バランスの比較
- Federated Learning による推薦精度向上

## ファイル構成

```
OwnNews/
├── .github/workflows/
│   └── collect.yml              # GitHub Actions (1日5回cron)
├── .streamlit/
│   └── secrets.toml.example     # シークレット設定テンプレート
├── collector.py                  # RSS収集 + Cloudflare Embed + 共有DB保存
├── engine.py                     # 2-DB ランキングエンジン + 情報的健康
├── app.py                        # Streamlit UI (3タブ + オンボーディング)
├── schema_articles.sql           # 共有DBセットアップ用SQL
├── schema_user.sql               # 個人DBセットアップ用SQL
├── supabase_schema.sql           # (旧) 単一DBスキーマ（参考用）
├── requirements.txt              # Python依存パッケージ
└── README.md                     # 本ファイル
```

## 設定リファレンス

| 項目 | 場所 | デフォルト値 |
|------|------|-------------|
| Embedding モデル | `collector.py` | `@cf/baai/bge-base-en-v1.5` |
| ベクトル次元数 | `schema_articles.sql` | 768 |
| Groq モデル | `app.py` | `llama-3.3-70b-versatile` |
| RSS フィード | `collector.py` | news.ceek.jp 全13カテゴリ |
| 収集間隔 | `collect.yml` | 1日5回 (JST 6,11,16,18,21時) |
| フィードバック学習率 | `engine.py` | 👁 α=0.03 / 🔍 α=0.15 / 👎 α=-0.2 |
