# App Review 審査メモ（App Store Connect「Appレビューに関する情報」欄用）

## 審査員向けノート（英語で提出。日本語訳を併記）

```
Thank you for reviewing OwnNews.

OwnNews is a non-commercial news reader developed by a university research
laboratory, focused on "informational health" — helping users see and balance
their own news consumption.

KEY POINTS FOR REVIEW:

1. Native functionality beyond the web content (Guideline 4.2):
   - Daily local notifications (5 times a day) scheduled natively via
     UNCalendarNotificationTrigger to encourage balanced news reading.
   - The recommendation engine runs entirely ON-DEVICE: the user's interest
     vector is computed and stored locally and is never uploaded. This
     privacy-by-design architecture is the core research theme of the app.

2. Login:
   - Google Sign-In and Sign in with Apple are both available.
   - Reviewers can create an account instantly via Sign in with Apple.
     No demo account is needed.

3. No ads, no tracking, no in-app purchases. No ATT prompt is shown because
   we do not track users across apps or websites.

4. News content is aggregated from public RSS feeds of major Japanese news
   outlets (NHK, ITmedia, etc.) and the CEEK.JP news aggregator, with
   attribution and links to the original articles.

If you have any questions, please contact: yutaka@arakawa-lab.com
```

### 日本語訳（参考）

OwnNewsは大学研究室が開発する非営利のニュースリーダーで、「情報的健康」——
自分のニュース摂取を可視化しバランスを取ること——に焦点を当てています。

1. Web内容を超えるネイティブ機能（ガイドライン4.2対応）:
   毎日5回のローカル通知、端末内で完結する推薦エンジン（関心ベクトルは非送信）
2. ログイン: Googleログイン と Sign in with Apple の両方を提供。デモアカウントは下記
3. 広告なし・トラッキングなし・課金なし（ATTプロンプト非表示の理由）
4. ニュースは国内主要メディアの公開RSSとCEEK.JPから収集し、出典表示と原文リンクあり

---

## デモアカウントについて（不要）

Sign in with Appleを実装済みのため、審査員は自分のApple IDでその場で
サインインしてすべての機能を確認できる。**デモアカウントの用意は不要**。

App Store Connectの「サインインが必要」欄は:
- 「サインイン情報を提供」のチェックを**外し**、
- 代わりに審査ノートに「Reviewers can create an account instantly via
  Sign in with Apple. No demo account is needed.」と書く（上記ノートに含めてある）。

※ もし審査員から「デモアカウントを出せ」と返ってきた場合のみ、
   2段階認証を無効にしたGoogleアカウントを作って対応する。

---

## 想定されるリジェクトと対応方針

### 1. ガイドライン4.8（最重要・現状ブロッカー）
**「サードパーティログイン（Google）を提供するアプリは、Sign in with Appleなど
プライバシー配慮型のログインを併設しなければならない」**

- 現状: Googleログインのみ → **このままでは高確率でリジェクト**
- 対応: SupabaseはSign in with Appleをサポートしている。
  Webアプリに「Appleでサインイン」ボタンを追加する（実装工数: 中）。
  Apple Developer Portal側で App ID に Sign in with Apple capability を追加し、
  Supabase側にService IDとキーを設定する。

### 2. ガイドライン4.2（最小限の機能 / Webクリッピング）
**「Webサイトをパッケージしただけのアプリは却下される」**

- リスク: 本アプリはWKWebViewラッパーであるため指摘される可能性がある
- 緩和材料（審査ノートに明記済み）:
  - ネイティブのローカル通知（毎日5回、UNCalendarNotificationTrigger）
  - 端末内推薦エンジンという設計思想（研究プロジェクト）
- さらに強化するなら（任意・リジェクトされた場合の次の一手）:
  - 通知時刻のカスタマイズをネイティブUIで提供
  - ウィジェット（今日の見落としニュース）追加
  - オフライン閲覧の明示的サポート

### 3. ガイドライン5.2.3 / 5.2.2（コンテンツの権利）
- ニュース記事はRSS公開分の見出し+抜粋のみ利用し、本文は原文サイトへリンク
- CEEK.JPへの配慮（アクセス間隔・素性明示UA）も実施済み
- 指摘された場合: /aboutページの「コンテンツの取り扱い」を提示

### 4. 研究プロジェクトである旨
- 学術・非営利であることはプラス材料。審査ノートに明記済み

---

## 実装TODO（申請前に必要）

- [ ] **Sign in with Apple の実装**（4.8対応・必須）
- [ ] デモアカウント作成
- [ ] App Store用配布ビルド（Archive → App Store Connect アップロード）
- [ ] （推奨）TestFlightで実機配布して最終確認
