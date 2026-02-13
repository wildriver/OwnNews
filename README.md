# OwnNews — 自律型パーソナル・ニュースキュレーター (Cloud版)

中央集権的なプラットフォーマーに依存せず、無料クラウドサービスのみでニュースの収集・解析・推薦を行うパーソナルキュレーターです。

## アーキテクチャ

```
GitHub Actions (毎時cron)
  │  ① RSS取得 (news.ceek.jp)
  │  ② Cloudflare Workers AI でベクトル化
  │  ③ Supabase へ保存
  ▼
┌─────────────────────────┐
│  Supabase               │
│  Postgres + pgvector    │
│  ├─ articles (embedding)│
│  └─ user_vectors        │
└────────┬────────────────┘
         │ ベクトル類似度検索
         ▼
┌─────────────────────────┐
│  Streamlit Community    │
│  Cloud (UI)             │
│  ├─ フィルタスライダー    │
│  ├─ 👍 フィードバック     │
│  └─ 🔍 深掘り → Groq    │
└─────────────────────────┘
```

| 役割 | サービス | 無料枠 |
|------|---------|--------|
| 定期収集 | GitHub Actions | パブリックリポジトリ無制限 / プライベート 2,000分/月 |
| DB + ベクトル検索 | Supabase (Postgres + pgvector) | 500MB DB / 無制限API |
| 埋め込み | Cloudflare Workers AI | 10,000 neurons/日 |
| 深掘り推論 | Groq API | 無料枠あり (モデルにより異なる) |
| UI | Streamlit Community Cloud | パブリックアプリ無料 |

## セットアップ

### 1. Supabase プロジェクト作成

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. Dashboard > **SQL Editor** で [supabase_schema.sql](supabase_schema.sql) の内容を実行
3. **Settings > API** から以下を控える:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` キー → `SUPABASE_KEY`

### 2. Cloudflare Workers AI

#### 2-1. アカウント作成

1. [dash.cloudflare.com](https://dash.cloudflare.com) にアクセスし、アカウントを作成（無料プランでOK）
2. ログイン後、ダッシュボードが表示される

#### 2-2. Account ID を取得

1. ダッシュボード左メニューから **Workers & Pages** をクリック
2. 画面右サイドバーに **Account ID** が表示されている
3. この値をコピーして控える → `CF_ACCOUNT_ID`

#### 2-3. API Token を作成

1. ダッシュボード右上のアイコン > **My Profile** をクリック
2. 左メニューの **API Tokens** をクリック
3. **Create Token** ボタンをクリック
4. 下部の **Create Custom Token** > **Get started** をクリック
5. 以下を設定する:
   - **Token name**: `OwnNews Workers AI` (任意の名前)
   - **Permissions**:
     - ドロップダウン1つ目: `Account`
     - ドロップダウン2つ目: `Workers AI`
     - ドロップダウン3つ目: `Read`
   - **Account Resources**: `Include` > 自分のアカウントを選択
6. **Continue to summary** > 内容を確認 > **Create Token**
7. 表示されたトークンをコピーして控える → `CF_API_TOKEN`

> **注意**: トークンは **一度しか表示されません**。必ずこの画面でコピーしてください。

#### 2-4. 動作確認 (curl)

ターミナルで以下を実行し、レスポンスが返ればOKです:

```bash
curl https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5 \
  -H "Authorization: Bearer {CF_API_TOKEN}" \
  -d '{"text": ["テスト文章"]}'
```

成功時のレスポンス例:

```json
{
  "result": {
    "shape": [1, 768],
    "data": [[0.0234, -0.0156, ...]]
  },
  "success": true
}
```

#### 2-5. 無料枠について

- Workers AI の無料枠は **1日あたり 10,000 neurons**
- `bge-base-en-v1.5` の場合、1リクエストあたり約 500 neurons 消費（テキスト量に依存）
- 毎時cron で1回あたり数十件の新規記事であれば、無料枠内で十分に運用可能

### 3. Groq API (深掘り機能用、任意)

1. [console.groq.com](https://console.groq.com) でAPIキーを取得 → `GROQ_API_KEY`

### 4. GitHub リポジトリ設定

1. リポジトリの **Settings > Secrets and variables > Actions** に以下を登録:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `CF_ACCOUNT_ID`
   - `CF_API_TOKEN`
2. Actions タブから **Collect News** ワークフローを手動実行して動作確認

### 5. Streamlit Community Cloud にデプロイ

1. [share.streamlit.io](https://share.streamlit.io) でGitHubリポジトリを連携
2. メインファイルに `app.py` を指定
3. **Advanced settings > Secrets** に以下を設定:

```toml
SUPABASE_URL = "https://xxxxx.supabase.co"
SUPABASE_KEY = "eyJ..."
GROQ_API_KEY = "gsk_..."
```

## 使い方

### フィルタ強度スライダー

| 値 | 動作 |
|----|------|
| **1.0 に近い** | パーソナライズ強: 関心に近い記事のみ表示 |
| **0.5（デフォルト）** | バランス型: 類似記事15件 + ランダム15件 |
| **0.0 に近い** | セレンディピティ重視: ほぼ全件ランダム表示 |

### フィードバック学習

各記事の **👍** ボタンをクリックすると、ユーザー関心ベクトルが更新されます。

```
u_new = (1 - α) * u_old + α * v_clicked    (α = 0.1)
```

### 深掘り機能

**🔍 深掘り** ボタンをクリックすると、Groq API (Llama 3.3 70B) が記事の背景・影響・今後の展望を分析します。オンデマンド実行のためコストを抑えられます。

## ファイル構成

```
OwnNews/
├── .github/workflows/
│   └── collect.yml              # GitHub Actions (毎時cron)
├── .streamlit/
│   └── secrets.toml.example     # シークレット設定テンプレート
├── collector.py                  # RSS収集 + Cloudflare Embed + Supabase保存
├── engine.py                     # Supabase pgvector ランキングエンジン
├── app.py                        # Streamlit UI + Groq深掘り
├── supabase_schema.sql           # DBセットアップ用SQL
├── requirements.txt              # Python依存パッケージ
└── README.md                     # 本ファイル
```

## 設定リファレンス

| 項目 | 場所 | デフォルト値 |
|------|------|-------------|
| Embedding モデル | `collector.py` `CF_MODEL` | `@cf/baai/bge-base-en-v1.5` |
| ベクトル次元数 | `supabase_schema.sql` | 768 |
| Groq モデル | `app.py` `deep_dive()` | `llama-3.3-70b-versatile` |
| RSS フィード一覧 | `collector.py` `FEEDS` | news.ceek.jp 全13カテゴリ |
| 学習率 (α) | `engine.py` `update_user_vector()` | `0.1` |
| 収集間隔 | `.github/workflows/collect.yml` | 毎時0分 |
