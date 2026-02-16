"""
RSS Collector Module (Simplified)
Fetches RSS feeds and saves raw data to Supabase.
Categorization and Embedding are handled by Cloudflare Workers.
"""

import hashlib
import os

import feedparser
import requests
from supabase import create_client

# --- Config ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

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


def fetch_ogp_image(url: str) -> str:
    """記事URLからOGP画像URLを取得する。取得失敗時は空文字を返す。"""
    try:
        resp = requests.get(url, timeout=5, headers={
            "User-Agent": "OwnNews/1.0 (ogp-fetcher)"
        })
        resp.raise_for_status()
        html = resp.text[:10000]  # 先頭10KBのみ解析
        # og:image を探す
        m = re.search(
            r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.IGNORECASE,
        )
        if not m:
            m = re.search(
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
                html, re.IGNORECASE,
            )
        if m:
            return m.group(1)
    except Exception:
        pass
    return ""


def collect() -> int:
    """全フィードを巡回し、新規記事をSupabaseに保存する。"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL and SUPABASE_KEY must be set.")
        return 0

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

    print(f"Found {len(new_articles)} new articles. Saving raw data...")

    rows = []
    for a in new_articles:
        # Fetch OGP image
        img = fetch_ogp_image(a["link"])
        rows.append({
            "id": a["id"],
            "title": a["title"],
            "link": a["link"],
            "summary": a["summary"],
            "published": a["published"],
            "category": a["category"],
            "image_url": img,
            # embedding_m3, category_medium, etc. are left null for the Worker
        })

    # Upsert in chunks
    batch_size = 50
    for i in range(0, len(rows), batch_size):
        chunk = rows[i : i + batch_size]
        try:
             sb.table("articles").upsert(chunk, on_conflict="link").execute()
        except Exception as e:
            print(f"Error upserting chunk: {e}")

    print(f"Collected {len(new_articles)} new articles.")
    return len(new_articles)


if __name__ == "__main__":
    collect()
