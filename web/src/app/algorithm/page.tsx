import Link from 'next/link'
import { ArrowLeft, Database, Brain, Layers, EyeOff, HeartPulse, HardDrive } from 'lucide-react'

export const runtime = 'edge'

export const metadata = {
    title: 'アルゴリズムの開示 | OwnNews',
    description:
        'OwnNewsで使われている推薦・学習・可視化アルゴリズムの全公開。関心ベクトルの学習式、バブルの判定しきい値、世間の窓の並べ方まで、実装値そのままに説明します。',
}

// アルゴリズム開示ページ（公開）。
// 「推薦の主導権をユーザーに」という思想の実践として、
// 実装のしきい値・計算式をそのまま開示する。実装を変えたらこのページも更新すること。
export default function AlgorithmPage() {
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

            <main className="max-w-3xl mx-auto px-5 py-10 space-y-10">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">アルゴリズムの開示</h1>
                    <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
                        ふつうのニュースアプリでは、何がどんな理由で表示されているかは公開されません。
                        OwnNewsは「推薦の主導権をユーザーに」を掲げる研究プロジェクトとして、
                        使っているアルゴリズムを<strong className="text-foreground">実装値そのままに</strong>公開します。
                    </p>
                </div>

                {/* 1. 収集と解析 */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Database className="w-5 h-5 text-primary" />1. 記事の収集と解析
                    </h2>
                    <ul className="text-[15px] leading-relaxed text-muted-foreground space-y-2 list-disc pl-5">
                        <li>
                            記事はニュース検索サイト <a href="https://news.ceek.jp/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">CEEK.JP NEWS</a> のRSSから
                            1日5回収集します（見出し・短い抜粋・リンクのみ。本文は収集しません）。
                        </li>
                        <li>
                            各記事は多言語埋め込みモデル <strong className="text-foreground">BGE-M3</strong> で
                            <strong className="text-foreground">1024次元のベクトル</strong>に変換されます。
                            意味が近い記事ほど、ベクトルの向きが近くなります。
                        </li>
                        <li>
                            AI（Llama系の言語モデル）が各記事に<strong className="text-foreground">「栄養素」5指標</strong>
                            （事実・背景・視点・感情・速報、各0〜100）と中分類・キーワードを付与します。
                        </li>
                        <li>
                            直近<strong className="text-foreground">800記事</strong>をひとつの「記事パック」にまとめ、
                            全ユーザー共通のデータとして配信します。パックには記事ごとの
                            匿名の閲覧数・リアクション集計も焼き込まれます。
                        </li>
                    </ul>
                </section>

                {/* 2. 関心の学習 */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Brain className="w-5 h-5 text-primary" />2. あなたの関心の学習（端末内）
                    </h2>
                    <p className="text-[15px] leading-relaxed text-muted-foreground">
                        あなたの関心は、記事と同じ1024次元の<strong className="text-foreground">「関心ベクトル」</strong>1本で表現されます。
                        記事を読むたびに、指数移動平均で少しずつ更新されます：
                    </p>
                    <pre className="bg-card border border-border rounded-xl p-4 text-[13px] overflow-x-auto"><code>{`v ← normalize( (1−α)·v + α·e )   … 読んだ記事の方向へ α だけ近づく
v ← normalize( v − 0.15·e )       … 「興味なし」の記事から遠ざかる

v = あなたの関心ベクトル / e = 記事のベクトル / α = 学習率`}</code></pre>
                    <p className="text-[15px] leading-relaxed text-muted-foreground">
                        学習率αは<strong className="text-foreground">どれだけ真剣に読んだか</strong>で決まります。
                        開いただけ（5秒未満）では学習しません：
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] border border-border rounded-xl overflow-hidden">
                            <thead className="bg-secondary/60">
                                <tr>
                                    <th className="text-left font-semibold px-3 py-2">行動</th>
                                    <th className="text-left font-semibold px-3 py-2">学習率 α</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-muted-foreground">
                                <tr><td className="px-3 py-1.5">開いてすぐ閉じた（5秒未満）</td><td className="px-3 py-1.5 tnum">0（学習しない）</td></tr>
                                <tr><td className="px-3 py-1.5">ざっと見た（5〜15秒）</td><td className="px-3 py-1.5 tnum">0.06</td></tr>
                                <tr><td className="px-3 py-1.5">読んだ（15〜40秒）</td><td className="px-3 py-1.5 tnum">0.12</td></tr>
                                <tr><td className="px-3 py-1.5">じっくり読んだ（40〜120秒）</td><td className="px-3 py-1.5 tnum">0.20</td></tr>
                                <tr><td className="px-3 py-1.5">熟読（120秒以上）</td><td className="px-3 py-1.5 tnum">0.25</td></tr>
                                <tr><td className="px-3 py-1.5">＋最後までスクロール</td><td className="px-3 py-1.5 tnum">+0.05（上限0.3）</td></tr>
                                <tr><td className="px-3 py-1.5">AIで深掘り解説を開いた</td><td className="px-3 py-1.5 tnum">0.25</td></tr>
                                <tr><td className="px-3 py-1.5">ストックした</td><td className="px-3 py-1.5 tnum">0.15</td></tr>
                                <tr><td className="px-3 py-1.5">興味なし（×・左スワイプ）</td><td className="px-3 py-1.5 tnum">−0.15（遠ざかる）</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                        この計算はすべて<strong className="text-foreground">あなたのブラウザの中</strong>で行われます。
                        サーバーは学習済みベクトルを端末間同期のために保存するだけで、サーバー側で推薦を計算することはありません。
                    </p>
                </section>

                {/* 3. フィードの組み立て */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Layers className="w-5 h-5 text-primary" />3. フィードの組み立て
                    </h2>
                    <ul className="text-[15px] leading-relaxed text-muted-foreground space-y-2 list-disc pl-5">
                        <li>
                            全記事と関心ベクトルの<strong className="text-foreground">コサイン類似度</strong>を端末内で計算します。
                        </li>
                        <li>
                            <strong className="text-foreground">あなたのバブル</strong>: 類似度が
                            <strong className="text-foreground"> 0.65以上</strong>の記事を類似度順に最大15件。
                            類似度0.88以上の記事同士は「同じ話題」として1枚のカードにまとめます（複数紙の報道の集約）。
                        </li>
                        <li>
                            <strong className="text-foreground">バブルの外（いろいろなニュース）</strong>: 類似度0.65未満の記事を、
                            <strong className="text-foreground">「世間の窓」スコア = 閲覧数 + リアクション数×3</strong>
                            の高い順に並べ、さらに<strong className="text-foreground">全ジャンルから1件ずつ交互に</strong>
                            取り出して偏りをなくします（あなた以外の人がよく読み・反応している記事が、ジャンル均等に並ぶ）。
                        </li>
                        <li>
                            「視野の広さ」スライダー（0.1刻み11段階）は、バブルの外の初期表示量を変えます。
                            どこまでも下にスクロールすれば、設定に関わらず全記事に辿り着けます。
                        </li>
                        <li>閲覧済み・「興味なし」にした記事はフィードから消えます。</li>
                    </ul>
                </section>

                {/* 4. 使っていないもの */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <EyeOff className="w-5 h-5 text-primary" />4. あえて推薦に使っていないもの
                    </h2>
                    <ul className="text-[15px] leading-relaxed text-muted-foreground space-y-2 list-disc pl-5">
                        <li>
                            <strong className="text-foreground">リアクション（賛成・反対など）は推薦に使いません。</strong>
                            反対した記事を減らすと「同意できる記事だけが並ぶ」意見のバブルを作ってしまうためです。
                            リアクションは集計の可視化にだけ使います。
                        </li>
                        <li>
                            広告・スポンサー枠・「おすすめの押し付け」はありません。表示順を金銭で変える仕組みは存在しません。
                        </li>
                    </ul>
                </section>

                {/* 5. 情報的健康の指標 */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <HeartPulse className="w-5 h-5 text-primary" />5. 情報的健康の指標
                    </h2>
                    <ul className="text-[15px] leading-relaxed text-muted-foreground space-y-2 list-disc pl-5">
                        <li>
                            <strong className="text-foreground">多様性スコア</strong>: 閲覧履歴のジャンル分布の
                            シャノンエントロピーを0〜100に正規化したもの。全ジャンルを均等に読むと100、
                            1ジャンルだけだと0に近づきます。
                        </li>
                        <li>
                            <strong className="text-foreground">栄養バランス</strong>: 読んだ記事の栄養素5指標の平均。
                            「事実ばかりで視点が足りない」といった偏りが見えます。
                        </li>
                        <li>
                            <strong className="text-foreground">意見バランス</strong>: 自分が押した賛成と反対の比率。
                            賛成一色なら「同意できる記事だけを読んでいる」サインです。
                        </li>
                    </ul>
                </section>

                {/* 6. データの置き場所 */}
                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <HardDrive className="w-5 h-5 text-primary" />6. データの置き場所
                    </h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px] border border-border rounded-xl overflow-hidden">
                            <thead className="bg-secondary/60">
                                <tr>
                                    <th className="text-left font-semibold px-3 py-2">データ</th>
                                    <th className="text-left font-semibold px-3 py-2">場所</th>
                                    <th className="text-left font-semibold px-3 py-2">誰が見られるか</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border text-muted-foreground">
                                <tr><td className="px-3 py-1.5">記事パック（全記事・共通）</td><td className="px-3 py-1.5">CDN配信＋端末キャッシュ</td><td className="px-3 py-1.5">全員（個人情報なし）</td></tr>
                                <tr><td className="px-3 py-1.5">関心ベクトル・閲覧履歴・設定</td><td className="px-3 py-1.5">端末内＋アカウント同期</td><td className="px-3 py-1.5">本人のみ（アクセス制御）</td></tr>
                                <tr><td className="px-3 py-1.5">リアクション</td><td className="px-3 py-1.5">アカウント同期</td><td className="px-3 py-1.5">本人＋匿名の件数集計のみ公開</td></tr>
                                <tr><td className="px-3 py-1.5">推薦の計算</td><td className="px-3 py-1.5">あなたのブラウザ内</td><td className="px-3 py-1.5">—（サーバーでは計算しない）</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                        運営（研究）が観測するのは、利用者数・閲覧状況・フィルタ強度の分布・バブルの形といった
                        <strong className="text-foreground">研究のための集計</strong>です。詳しくは
                        <Link href="/about" className="text-primary hover:underline">このサービスについて</Link> をご覧ください。
                    </p>
                </section>

                <p className="text-[12px] text-muted-foreground border-t border-border pt-4">
                    このページの数値はすべて実装と同じ値です。アルゴリズムを変更した場合はこのページも更新します。
                    ソースコードは公開リポジトリで確認できます。
                </p>
            </main>

            <footer className="border-t border-border">
                <div className="max-w-3xl mx-auto px-5 py-6 text-[12px] text-muted-foreground">
                    OwnNews — 情報的健康を保つニュースリーダー（研究プロジェクト）
                    <Link href="/about" className="ml-2 underline hover:text-foreground">運営者情報</Link>
                </div>
            </footer>
        </div>
    )
}
