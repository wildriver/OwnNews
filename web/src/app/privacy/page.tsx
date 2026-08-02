import Link from 'next/link'
import { ArrowLeft, ShieldCheck, Database, Smartphone, Bell, Trash2, Mail } from 'lucide-react'

export const runtime = 'edge'

export const metadata = {
    title: 'プライバシーポリシー | OwnNews',
    description: 'OwnNewsの個人情報・データの取り扱いについて',
}

// プライバシーポリシー（公開ページ）。App Store申請のPrivacy Policy URLとしても使用する。
// ローカルファースト設計（嗜好データは端末内・推薦計算はクライアント側）を正確に記述する。
export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border">
                <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
                    <span className="text-lg font-bold tracking-tight text-primary">OwnNews</span>
                    <Link href="/" className="text-[13px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <ArrowLeft className="w-4 h-4" />トップへ
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-5 py-10 space-y-8">
                <h1 className="text-2xl font-bold tracking-tight">プライバシーポリシー</h1>
                <p className="text-[13px] text-muted-foreground">最終更新日: 2026年8月2日</p>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />基本方針
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        OwnNews（以下「本サービス」）は、大学研究室が研究目的で運営するニュースリーダーです。
                        本サービスは<strong className="text-foreground">「嗜好情報をサーバに置かない」ローカルファースト設計</strong>を
                        採用しています。ニュースの推薦計算はすべてお使いの端末内で行われ、
                        あなたがどの記事に関心を持っているかを表す関心ベクトルの生成・利用は端末内で完結します。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Smartphone className="w-5 h-5 text-primary" />端末内にのみ保存されるデータ
                    </h2>
                    <ul className="text-[15.5px] leading-relaxed text-muted-foreground list-disc pl-5 space-y-1">
                        <li>関心ベクトル（あなたの興味を表す数値表現）</li>
                        <li>記事パックのキャッシュ</li>
                        <li>フィード表示に関する設定</li>
                    </ul>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        これらは端末のブラウザストレージ（IndexedDB）に保存され、運営サーバには送信されません。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Database className="w-5 h-5 text-primary" />アカウントに紐付けて保存されるデータ
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        Googleアカウントでログインした場合、複数端末間での同期のために、以下のデータを
                        運営サーバ（Supabase）に保存します。これらは行レベルセキュリティにより本人のみが
                        アクセスでき、他のユーザーからは見えません。
                    </p>
                    <ul className="text-[15.5px] leading-relaxed text-muted-foreground list-disc pl-5 space-y-1">
                        <li>メールアドレス（アカウント識別のため）</li>
                        <li>閲覧・リアクション履歴（記事ID・操作種別・時刻）</li>
                        <li>フィード設定（視野の広さ・ジャンルの表示/非表示）</li>
                    </ul>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        閲覧数・リアクション数は個人を特定できない集計値として全ユーザー共通の
                        「世間の窓」機能（みんなが読んでいる記事の表示）に利用されます。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Bell className="w-5 h-5 text-primary" />通知
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        iOSアプリの通知は端末内で予約されるローカル通知です（毎日決まった時刻）。
                        通知のために端末情報が外部に送信されることはありません。
                        Webブラウザ版のプッシュ通知を有効にした場合は、配信先を示す購読情報
                        （エンドポイントURL・公開鍵）をサーバに保存します。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Trash2 className="w-5 h-5 text-primary" />データの削除
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        設定画面からローカルデータの全消去ができます。アカウントに紐付くサーバ上のデータの
                        削除を希望される場合は、下記の窓口までご連絡ください。研究データとして利用する場合は、
                        個人を特定できない形に匿名化した上で統計的に処理します。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" />お問い合わせ
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        データの取り扱いに関するお問い合わせ:{' '}
                        <a href="mailto:yutaka@arakawa-lab.com" className="text-primary hover:underline">
                            yutaka@arakawa-lab.com
                        </a>
                    </p>
                </section>
            </main>
        </div>
    )
}
