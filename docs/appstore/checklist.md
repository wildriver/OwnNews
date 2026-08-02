# App Store 提出チェックリスト

順番に上から。⚠印はブロッカー（これを飛ばすと提出できない/リジェクトされる）。

## 1. 事前準備（Apple Developer Portal / App Store Connect）

- [ ] Apple Developer Programが有効（チーム `LP34H67XY3`）— 済
- [ ] ⚠ App Store Connectで新規App作成
      - プラットフォーム: iOS / 名前: OwnNews / プライマリ言語: 日本語
      - バンドルID: `com.arakawa-lab.ownnews` / SKU: `ownnews-ios-001`
- [ ] ⚠ 契約・税金・口座（Agreements, Tax, and Banking）で
      「無料アプリの契約(Free Apps)」がアクティブなこと

## 2. アプリ実装

- [x] アプリアイコン(1024px)
- [x] ITSAppUsesNonExemptEncryption = false
- [x] プライバシーポリシーページ(/privacy)
- [ ] ⚠ **Sign in with Apple 実装**（Googleログイン併設のため必須。review-notes.md参照）
- [ ] バージョン/ビルド番号の確認（1.0 / 1）

## 3. メタデータ入力（metadata.md からコピペ）

- [ ] アプリ名・サブタイトル・カテゴリ
- [ ] 説明文・プロモテキスト・キーワード
- [ ] プライバシーポリシーURL・サポートURL
- [ ] App Privacy質問票（metadata.mdの表の通り）
- [ ] 年齢制限指定
- [ ] 価格: 無料 / 配信地域: 日本（必要なら全世界）

## 4. スクリーンショット（screenshots/ フォルダ）

必須: 6.9インチ（iPhone 17 Pro Max等、1320×2868px）1〜10枚
※ 6.9インチ1サイズ分をアップすれば他サイズは自動流用される

- [ ] 01: フィード（あなたのバブル/バブルの外）
- [ ] 02: ダッシュボード（情報的健康スコア+レーダー）
- [ ] 03: ダッシュボード（記事母集団/見落としニュース）
- [ ] 04: 記事詳細 or 履歴
- [ ] 05: ウェルカム（コンセプト説明）

## 5. ビルドのアップロード

```bash
cd ios
# 1) Archive（App Store用は generic destination でビルド）
xcodebuild -project OwnNews.xcodeproj -scheme OwnNews \
  -destination 'generic/platform=iOS' \
  -archivePath build/OwnNews.xcarchive \
  -allowProvisioningUpdates archive

# 2) App Store Connectへアップロード（ExportOptions.plist使用）
xcodebuild -exportArchive \
  -archivePath build/OwnNews.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist \
  -allowProvisioningUpdates
```

※ アップロードはXcode GUI（Product > Archive → Distribute App）の方が確実。
   CLIの場合は ExportOptions.plist（method: app-store-connect）が必要。

- [ ] Archiveの作成
- [ ] App Store Connectへのアップロード
- [ ] 処理完了後、バージョンにビルドを紐付け

## 6. 提出前の最終確認

- [ ] TestFlightで自分の実機に配布して一通り動作確認（推奨）
- [ ] 審査ノート・デモアカウントを入力（review-notes.md）
- [ ] 輸出コンプライアンスの回答（自動: ITSAppUsesNonExemptEncryption設定済み）
- [ ] 「審査へ提出」

## 審査の目安

- 通常24〜48時間で結果が出る（初回は数日かかることもある）
- リジェクト時は review-notes.md の「想定されるリジェクトと対応方針」を参照
