"""
RSS Collector Module (Cloud版)
news.ceek.jp のRSSフィードを巡回し、Cloudflare Workers AIでベクトル化後、
Supabase (Postgres + pgvector) に保存する。
GitHub Actionsから定期実行される想定。
"""

import hashlib
import os

import feedparser
import requests
from supabase import create_client

# --- 設定 (環境変数 or Streamlit secrets) ---

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
CF_MODEL = "@cf/baai/bge-base-en-v1.5"

FEEDS = [
    "https://news.ceek.jp/search.cgi?feed=1",
    "https://news.ceek.jp/search.cgi?category_id=national&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=politics&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=business&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=world&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=triple&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=it&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=sports&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=entertainment&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=science&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=obituaries&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=local&feed=1",
    "https://news.ceek.jp/search.cgi?category_id=etc&feed=1",
]


def _article_id(link: str) -> str:
    """URLからユニークIDを生成する。"""
    return hashlib.sha256(link.encode()).hexdigest()[:16]


def fetch_feed(url: str) -> list[dict]:
    """RSSフィードをパースし、記事リストを返す。"""
    feed = feedparser.parse(url)
    articles = []
    for entry in feed.entries:
        link = entry.get("link", "")
        if not link:
            continue
        articles.append({
            "id": _article_id(link),
            "title": entry.get("title", ""),
            "link": link,
            "summary": entry.get("summary", ""),
            "published": entry.get("published", ""),
            "category": ",".join(
                t.get("term", "") for t in entry.get("tags", [])
            ),
        })
    return articles


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Cloudflare Workers AI でテキストをベクトル化する。"""
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/"
        f"{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}"
    )
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        json={"text": texts},
        timeout=120,
    )
    resp.raise_for_status()
    result = resp.json()
    return result["result"]["data"]


def collect() -> int:
    """全フィードを巡回し、新規記事をSupabaseに保存する。"""
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 既存リンクを取得してデデュープ
    existing = sb.table("articles").select("link").execute()
    existing_links = {r["link"] for r in existing.data}

    # 全フィードから新規記事を収集
    new_articles = []
    for url in FEEDS:
        for a in fetch_feed(url):
            if a["link"] not in existing_links:
                existing_links.add(a["link"])  # フィード間の重複も排除
                new_articles.append(a)

    if not new_articles:
        print("No new articles found.")
        return 0

    # バッチでベクトル化（Cloudflare APIのバッチ上限を考慮し100件ずつ）
    batch_size = 100
    for i in range(0, len(new_articles), batch_size):
        batch = new_articles[i : i + batch_size]
        texts = [f"{a['title']} {a['summary']}" for a in batch]
        embeddings = embed_texts(texts)

        rows = []
        for a, emb in zip(batch, embeddings):
            rows.append({
                "id": a["id"],
                "title": a["title"],
                "link": a["link"],
                "summary": a["summary"],
                "published": a["published"],
                "category": a["category"],
                "embedding": emb,
            })

        sb.table("articles").upsert(rows, on_conflict="link").execute()

    print(f"Collected {len(new_articles)} new articles.")
    return len(new_articles)


if __name__ == "__main__":
    collect()
