"""
RSS Collector Module
Fetches RSS feeds and saves raw article data to Supabase.
栄養素スコアリング・埋め込み生成は Cloudflare Worker (article-processor) が担当する。
"""

import hashlib
import os
import re

import feedparser
import requests
from supabase import create_client

# --- Config ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# フィード定義:
#   url      : RSS/AtomフィードURL
#   source   : 媒体名（articles.source に保存）
#   category : フィード既定カテゴリ。None の場合はRSSエントリの<category>タグを使用（CEEK用）
FEEDS: list[dict] = [
    # --- CEEK.JP NEWS（アグリゲータ、エントリ側にカテゴリタグあり） ---
    {"url": "https://news.ceek.jp/search.cgi?feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=national&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=politics&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=business&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=world&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=triple&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=it&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=sports&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=entertainment&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=science&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=obituaries&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=local&feed=1", "source": "CEEK.JP", "category": None},
    {"url": "https://news.ceek.jp/search.cgi?category_id=etc&feed=1", "source": "CEEK.JP", "category": None},

    # --- 国内主要メディアの公式RSS ---
    {"url": "https://www3.nhk.or.jp/rss/news/cat0.xml", "source": "NHK", "category": "その他"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat1.xml", "source": "NHK", "category": "社会"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat4.xml", "source": "NHK", "category": "政治"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat5.xml", "source": "NHK", "category": "経済"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat6.xml", "source": "NHK", "category": "国際"},
    {"url": "https://www3.nhk.or.jp/rss/news/cat7.xml", "source": "NHK", "category": "スポーツ"},
    {"url": "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml", "source": "ITmedia", "category": "IT"},
    {"url": "https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf", "source": "Impress Watch", "category": "IT"},
    {"url": "https://gigazine.net/news/rss_2.0/", "source": "GIGAZINE", "category": "IT"},
    {"url": "https://toyokeizai.net/list/feed/rss", "source": "東洋経済", "category": "経済"},
    {"url": "https://feeds.japan.cnet.com/rss/cnet/all.rdf", "source": "CNET Japan", "category": "IT"},
]


def _article_id(link: str) -> str:
    """URLからユニークIDを生成する。"""
    return hashlib.sha256(link.encode()).hexdigest()[:16]


def fetch_feed(feed_def: dict) -> list[dict]:
    """RSSフィードをパースし、記事リストを返す。"""
    feed = feedparser.parse(feed_def["url"])
    articles = []
    for entry in feed.entries:
        link = entry.get("link", "")
        if not link:
            continue
        # カテゴリ: フィード既定値があればそれを、なければRSSタグから
        if feed_def["category"] is not None:
            category = feed_def["category"]
        else:
            category = ",".join(
                t.get("term", "") for t in entry.get("tags", [])
            )
        articles.append({
            "id": _article_id(link),
            "title": entry.get("title", ""),
            "link": link,
            "summary": entry.get("summary", ""),
            "published": entry.get("published", ""),
            "category": category,
            "source": feed_def["source"],
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


def filter_new_links(sb, links: list[str]) -> set[str]:
    """収集済みリンクをDBに照合し、未収集のリンク集合を返す。

    articles 全件を取得すると PostgREST のデフォルト1000行制限で
    照合漏れが起きるため、今回収集したリンクだけを in() で照合する。
    """
    new_links = set(links)
    chunk_size = 100  # URLが長いためINクエリは小さめに分割
    for i in range(0, len(links), chunk_size):
        chunk = links[i: i + chunk_size]
        res = sb.table("articles").select("link").in_("link", chunk).execute()
        for r in res.data:
            new_links.discard(r["link"])
    return new_links


def collect() -> int:
    """全フィードを巡回し、新規記事をSupabaseに保存する。"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL and SUPABASE_KEY must be set.")
        return 0

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 全フィードから記事を収集（フィード間の重複はリンクで排除）
    fetched: dict[str, dict] = {}
    for feed_def in FEEDS:
        try:
            for a in fetch_feed(feed_def):
                if a["link"] not in fetched:
                    fetched[a["link"]] = a
        except Exception as e:
            print(f"Feed error ({feed_def['url']}): {e}")

    if not fetched:
        print("No articles fetched.")
        return 0

    # DBと照合して新規のみ残す
    new_links = filter_new_links(sb, list(fetched.keys()))
    new_articles = [fetched[link] for link in fetched if link in new_links]

    if not new_articles:
        print("No new articles found.")
        return 0

    print(f"Found {len(new_articles)} new articles. Saving raw data...")

    rows = []
    for a in new_articles:
        img = fetch_ogp_image(a["link"])
        rows.append({
            "id": a["id"],
            "title": a["title"],
            "link": a["link"],
            "summary": a["summary"],
            "published": a["published"],
            "category": a["category"],
            "source": a["source"],
            "image_url": img,
        })

    # Upsert in chunks
    batch_size = 50
    for i in range(0, len(rows), batch_size):
        chunk = rows[i: i + batch_size]
        try:
            sb.table("articles").upsert(chunk, on_conflict="link").execute()
        except Exception as e:
            print(f"Error upserting chunk: {e}")

    print(f"Collected {len(new_articles)} new articles.")
    print("Embedding & nutrient scoring will be handled by the Cloudflare Worker.")

    return len(new_articles)


if __name__ == "__main__":
    collect()
