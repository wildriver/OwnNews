"""
カテゴリ分類ロジック（collector.py と engine.py で共有）
大分類→中分類キーワードマッピング、キーワード抽出関数を提供する。
キーワード抽出は Groq API (llama-3.1-8b-instant) を使用し、
APIが利用できない場合はカタカナ固有名詞+「」内テキストのフォールバックを使用。
"""

import os
import re

import requests

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

# キーワードで除外する一般的な語句
_COMMON_KEYWORDS = frozenset([
    "ニュース", "テレビ", "インター", "サービス",
    "システム", "プロジェクト", "コメント",
    "開発", "リリース", "アップデート", "機能",
    "アプリ", "サイト", "対応",
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


def extract_keywords(title: str, summary: str = "") -> list[str]:
    """記事の特徴的なキーワードを最大5つ抽出する。

    Groq API (llama-3.1-8b-instant) でキーワード抽出を試み、
    APIキーが未設定またはエラー時はフォールバック（カタカナ固有名詞+「」内テキスト）を使用。

    Returns:
        list[str]: キーワードのリスト（最大5つ）。DB の text[] カラムにそのまま格納可能。
    """
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        return _fallback_extract_keywords(title)

    text = f"{title} {summary}".strip()
    if len(text) < 10:
        return _fallback_extract_keywords(title)

    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "あなたはニュース記事のキーワード抽出器です。"
                            "記事の特徴を表すキーワードを最大5つ、カンマ区切りで出力してください。"
                            "キーワードのみを出力し、説明や番号は不要です。"
                            "例: AI,半導体,NVIDIA,投資,競争"
                        ),
                    },
                    {"role": "user", "content": text[:1500]},
                ],
                "max_tokens": 80,
                "temperature": 0.2,
            },
            timeout=15,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        keywords = _parse_keywords(content)
        if keywords:
            return keywords[:5]
    except Exception as e:
        print(f"Groq API キーワード抽出エラー: {e}")

    return _fallback_extract_keywords(title)


def _parse_keywords(content: str) -> list[str]:
    """Groq API レスポンスからキーワードリストを抽出する。"""
    # 改行・箇条書き記号を除去
    content = re.sub(r"[\n・\-\*\d+\.\)]+", " ", content)
    # カンマ区切りで分割
    keywords = [kw.strip() for kw in content.split(",")]
    # フィルタ: 空文字、短すぎ、メタテキストを除外
    keywords = [
        kw for kw in keywords
        if kw and len(kw) >= 2
        and kw not in _COMMON_KEYWORDS
        and not kw.startswith("キーワード")
        and not kw.startswith("Keywords")
    ]
    # 重複除去（順序保持）
    seen: set[str] = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    return unique


def _fallback_extract_keywords(title: str) -> list[str]:
    """Groq API 不使用時のフォールバック（カタカナ固有名詞+「」内テキスト）。"""
    keywords: list[str] = []
    for m in _KATAKANA_RE.finditer(title):
        word = m.group()
        if word not in _COMMON_KEYWORDS:
            keywords.append(word)
    for m in _BRACKET_RE.finditer(title):
        keywords.append(m.group(1))
    # 重複除去
    seen: set[str] = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    return unique[:5]
