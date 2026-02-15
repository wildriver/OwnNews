"""
カテゴリ分類ロジック（collector.py と engine.py で共有）
大分類→中分類キーワードマッピング、中分類・小分類の抽出関数を提供する。
"""

import re

# 大分類→中分類キーワードのマッピング
CATEGORY_TAXONOMY: dict[str, list[str]] = {
    "政治": ["選挙", "国会", "内閣", "与党", "野党", "外交", "防衛", "憲法", "政策", "行政"],
    "経済": ["株式", "為替", "金融", "企業", "雇用", "貿易", "景気", "物価", "税制", "投資", "不動産"],
    "国際": ["米国", "中国", "韓国", "北朝鮮", "ロシア", "EU", "中東", "アジア", "国連", "紛争"],
    "IT・テクノロジー": ["AI", "人工知能", "スマホ", "セキュリティ", "SNS", "半導体", "ロボット", "宇宙", "通信", "ゲーム", "アプリ"],
    "スポーツ": ["野球", "サッカー", "テニス", "ゴルフ", "バスケ", "陸上", "水泳", "格闘技", "相撲", "競馬", "五輪", "ラグビー"],
    "エンタメ": ["映画", "音楽", "ドラマ", "アニメ", "芸能", "お笑い", "漫画", "舞台", "アイドル", "バラエティ"],
    "科学": ["宇宙", "医療", "環境", "気候", "生物", "物理", "化学", "研究", "ノーベル", "発見"],
    "社会": ["事件", "事故", "裁判", "福祉", "教育", "医療", "災害", "犯罪", "少子化", "高齢化"],
    "地方": ["観光", "祭り", "特産", "自治体", "再開発", "過疎", "移住", "地域"],
    "ビジネス": ["起業", "決算", "M&A", "IPO", "マーケティング", "人事", "経営"],
    "生活": ["健康", "グルメ", "レシピ", "育児", "住まい", "ファッション", "旅行"],
    "環境": ["気候変動", "脱炭素", "再生可能", "リサイクル", "生態系", "温暖化"],
    "文化": ["文学", "美術", "歴史", "伝統", "哲学", "宗教", "建築"],
}

# カタカナ固有名詞抽出パターン（3文字以上）
_KATAKANA_RE = re.compile(r"[ァ-ヴー]{3,}")
# 「」内テキスト抽出パターン
_BRACKET_RE = re.compile(r"「([^」]+)」")

# 小分類で除外する一般的なカタカナ語
_COMMON_KATAKANA = frozenset([
    "ニュース", "テレビ", "インター", "サービス",
    "システム", "プロジェクト", "コメント",
])


def classify_medium(title: str, category: str) -> str:
    """タイトル内キーワードマッチで中分類を返す。"""
    cats = [c.strip() for c in category.split(",") if c.strip()] if category else []
    for cat in cats:
        keywords = CATEGORY_TAXONOMY.get(cat, [])
        for kw in keywords:
            if kw in title:
                return kw
    # カテゴリ不一致でも全分類を走査
    for keywords in CATEGORY_TAXONOMY.values():
        for kw in keywords:
            if kw in title:
                return kw
    return "その他"


def extract_minor_keywords(title: str) -> list[str]:
    """カタカナ固有名詞と「」内テキストを小分類として抽出。"""
    minors: list[str] = []
    for m in _KATAKANA_RE.finditer(title):
        word = m.group()
        if word not in _COMMON_KATAKANA:
            minors.append(word)
    for m in _BRACKET_RE.finditer(title):
        minors.append(m.group(1))
    return minors
