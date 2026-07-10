// アーキテクチャ図（アルゴリズム開示ページ用・静的SVG）
// 核心メッセージ: 「サーバーは共通データの準備まで。学習と推薦はあなたの端末の中」
// という境界を1枚で示す。実装を変えたらこの図も更新すること。

const G = '#0E9F6E'      // primary
const AMBER = '#D97706'
const INK = '#3B4340'
const MUTE = '#6E7672'
const LINE = '#D8DDD9'

function Box({ x, y, w, h, title, sub, accent }: {
    x: number; y: number; w: number; h: number; title: string; sub?: string; accent?: string
}) {
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} rx={8} fill="#FFFFFF" stroke={accent || LINE} strokeWidth={accent ? 1.5 : 1} />
            <text x={x + w / 2} y={sub ? y + h / 2 - 5 : y + h / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK}>{title}</text>
            {sub && <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontSize={9.5} fill={MUTE}>{sub}</text>}
        </g>
    )
}

function Arrow({ x1, y1, x2, y2, label, dashed }: {
    x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: boolean
}) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    return (
        <g>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={MUTE} strokeWidth={1.3}
                strokeDasharray={dashed ? '4 3' : undefined} markerEnd="url(#arrow)" />
            {label && (
                <text x={mx} y={my - 6} textAnchor="middle" fontSize={9} fill={MUTE}>{label}</text>
            )}
        </g>
    )
}

export function ArchitectureDiagram() {
    return (
        <div className="overflow-x-auto">
            <svg viewBox="0 0 720 400" className="min-w-[640px] w-full h-auto" role="img"
                aria-label="OwnNewsのアーキテクチャ図。サーバー側は記事の収集・AI解析・パック配信までを行い、関心の学習と推薦の計算はすべてあなたの端末内で行われる。">
                <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={MUTE} />
                    </marker>
                </defs>

                {/* ゾーン背景 */}
                <rect x={8} y={30} width={330} height={310} rx={12} fill="#F2F3F1" />
                <rect x={382} y={30} width={330} height={340} rx={12} fill="#E9F5F0" stroke={G} strokeWidth={1} strokeDasharray="5 4" />
                <text x={24} y={54} fontSize={11} fontWeight={700} fill={MUTE}>サーバー側（共通データの準備だけ）</text>
                <text x={398} y={54} fontSize={11} fontWeight={700} fill={G}>あなたの端末の中（学習・推薦はここ）</text>

                {/* 境界線ラベル */}
                <text x={360} y={205} textAnchor="middle" fontSize={9} fill={MUTE} transform="rotate(-90 360 205)">境界</text>

                {/* サーバー側 */}
                <Box x={30} y={70} w={130} h={44} title="CEEK.JP NEWS" sub="RSS（見出し・抜粋）" />
                <Arrow x1={95} y1={114} x2={95} y2={140} label="1日5回 収集" />
                <Box x={30} y={140} w={130} h={44} title="記事データベース" sub="共有・個人情報なし" />
                <Arrow x1={160} y1={162} x2={196} y2={162} />
                <Box x={196} y={140} w={124} h={44} title="AI解析" sub="埋め込み+栄養素" />
                <Arrow x1={258} y1={184} x2={258} y2={216} />
                <Box x={196} y={216} w={124} h={52} title="記事パック" sub="直近800件+匿名集計" />
                <Box x={30} y={280} w={290} h={44} title="研究用の観測" sub="利用者数・バブルの形などの集計のみ" accent={LINE} />

                {/* 境界を越える配信 */}
                <Arrow x1={320} y1={242} x2={402} y2={242} label="CDN配信" />

                {/* 端末側 */}
                <Box x={402} y={216} w={130} h={52} title="記事パック受信" sub="端末にキャッシュ" />
                <Box x={402} y={70} w={130} h={52} title="閲覧行動" sub="閲覧時間・スクロール等" />
                <Arrow x1={467} y1={122} x2={467} y2={148} label="学習率α" />
                <Box x={402} y={148} w={130} h={48} title="関心ベクトル" sub="1024次元・あなた専用" accent={G} />
                <Arrow x1={532} y1={196} x2={564} y2={222} />
                <Arrow x1={532} y1={242} x2={564} y2={240} />
                <Box x={556} y={216} w={140} h={52} title="コサイン類似度" sub="全記事×関心ベクトル" accent={G} />
                <Arrow x1={600} y1={268} x2={560} y2={300} />
                <Arrow x1={650} y1={268} x2={660} y2={300} />
                <Box x={402} y={300} w={170} h={52} title="あなたのバブル" sub="類似度 0.65 以上" accent={G} />
                <Box x={586} y={300} w={120} h={52} title="世間の窓" sub="他の人の注目順" accent={AMBER} />

                {/* 同期（本人のみ・境界を戻る点線） */}
                <Arrow x1={402} y1={160} x2={296} y2={118} label="同期（本人のみ）" dashed />
                <Box x={196} y={70} w={124} h={44} title="アカウント保管庫" sub="ベクトル・履歴" />
            </svg>
        </div>
    )
}
