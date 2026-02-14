# OwnNews — パーソナル・ニュースキュレーター

Google認証で誰でもすぐに使える、パーソナライズされたニュースキュレーターです。記事のベクトル類似度に基づくレコメンデーションと、情報摂取の偏りを可視化する「情報的健康」機能を備えています。

## コンセプト

- **ゼロセットアップ**: Googleアカウントでログインするだけで利用開始
- **情報的健康**: 食事の栄養バランスのアナロジーで情報摂取の偏りを可視化
- **コールドスタート解決**: オンボーディングでカテゴリ選択 + 記事投票

## アーキテクチャ

```
GitHub Actions (1日5回cron)
  │  ① RSS取得 (news.ceek.jp)
  │  ② Cloudflare Workers AI でベクトル化
  │  ③ Supabase へ保存
  ▼
┌──────────────────────────┐
│  Supabase（運営者管理）     │
│  Postgres + pgvector      │
│  ├─ articles (embedding)  │
│  ├─ user_profile          │
│  ├─ user_vectors          │
│  ├─ user_interactions     │
│  ├─ match_articles() RPC  │
│  ├─ random_articles() RPC │
│  └─ public_filters (Ph2)  │
└───────────┬──────────────┘
            │
            ▼
  ┌──────────────────┐
  │  Streamlit Cloud │
  │  (単一Webアプリ)  │
  │  ├─ Google認証    │
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
| DB | Supabase (Postgres + pgvector) | 500MB DB |
| 埋め込み | Cloudflare Workers AI | 10,000 neurons/日 |
| 深掘り推論 | Groq API | 無料枠あり |
| UI | Streamlit Community Cloud | パブリックアプリ無料 |
| 認証 | Google OAuth 2.0 | 無料 |

## 運営者セットアップ

### 1. Supabase を作成

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. **SQL Editor** で [schema.sql](schema.sql) を実行
3. **Project Settings > API** から URL と anon key を控える

### 2. Cloudflare Workers AI を設定

1. [dash.cloudflare.com](https://dash.cloudflare.com) でアカウント作成
2. **Workers & Pages** から Account ID を取得
3. **My Profile > API Tokens** で Workers AI Read 権限のトークンを作成

### 3. Google OAuth を設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIとサービス > OAuth同意画面** を設定（外部ユーザ向け）
3. **APIとサービス > 認証情報 > OAuth 2.0 クライアントID** を作成
   - アプリケーションの種類: ウェブアプリケーション
   - 承認済みのリダイレクト URI: `https://ownnews.streamlit.app/oauth2callback`
4. クライアントID と クライアントシークレット を控える

### 4. GitHub リポジトリ設定

Repository secrets に以下を登録（記事収集用）:

| Name | 値 |
|------|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_KEY` | Supabase anon public キー |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | Cloudflare API Token |

### 5. Streamlit Cloud デプロイ

Streamlit Cloud の Secrets に以下を設定:

```toml
SUPABASE_URL = "https://xxxxx.supabase.co"
SUPABASE_KEY = "eyJ..."
GROQ_API_KEY = "gsk_..."

[auth]
redirect_uri = "https://ownnews.streamlit.app/oauth2callback"
cookie_secret = "ランダムな文字列"

[auth.google]
client_id = "xxx.apps.googleusercontent.com"
client_secret = "GOCSPX-xxx"
server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
```

### 6. 動作確認

**Actions** タブ > **Collect News** > **Run workflow** で手動実行し、記事が収集されることを確認。

## 利用者向け

**Googleアカウントでログインするだけ**で利用できます。セットアップは不要です。

1. アプリにアクセス
2. 「Googleでログイン」をクリック
3. 初回はオンボーディング（カテゴリ選択 + 記事投票）
4. パーソナライズされたニュースフィードが表示されます

## 使い方

### ニュースタブ

- **フィルタ強度**: 1.0（パーソナライズ強） ↔ 0.0（多様性重視）
- **👁 閲覧記録**: 弱い正のフィードバック (α=0.03)
- **🔍 深掘り**: Groq API で背景分析 + 強い正のフィードバック (α=0.15)
- **👎 興味なし**: 強い負のフィードバック (α=-0.2)

### 情報的健康パネル（サイドバー）

食事の栄養バランスのアナロジーで、情報摂取の偏りを可視化します:

| 指標 | 計算方法 |
|------|---------
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

## ファイル構成

```
OwnNews/
├── .github/workflows/
│   └── collect.yml              # GitHub Actions (1日5回cron)
├── .streamlit/
│   └── secrets.toml.example     # シークレット設定テンプレート
├── collector.py                  # RSS収集 + Cloudflare Embed + DB保存
├── engine.py                     # ランキングエンジン + 情報的健康
├── app.py                        # Streamlit UI (Google認証 + 3タブ)
├── schema.sql                    # DBセットアップ用SQL
├── requirements.txt              # Python依存パッケージ
└── README.md                     # 本ファイル
```

## 設定リファレンス

| 項目 | 場所 | デフォルト値 |
|------|------|-------------|
| Embedding モデル | `collector.py` | `@cf/baai/bge-base-en-v1.5` |
| ベクトル次元数 | `schema.sql` | 768 |
| Groq モデル | `app.py` | `llama-3.3-70b-versatile` |
| RSS フィード | `collector.py` | news.ceek.jp 全13カテゴリ |
| 収集間隔 | `collect.yml` | 1日5回 (JST 6,11,16,18,21時) |
| フィードバック学習率 | `engine.py` | 👁 α=0.03 / 🔍 α=0.15 / 👎 α=-0.2 |
