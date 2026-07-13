"""
RSS Collector Module
Fetches RSS feeds and saves raw article data to Supabase.
栄養素スコアリング・埋め込み生成は Cloudflare Worker (article-processor) が担当する。
"""

import hashlib
import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import feedparser
import requests
from supabase import create_client

# --- Config ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# 素性を明示したUser-Agent（協力元CEEKへの礼儀・問い合わせ先を含める）
FEED_AGENT = (
    "OwnNewsBot/1.0 (research project; "
    "+https://ownnews-web.pages.dev; contact: yutaka@arakawa-lab.com)"
)

# ホスト別の最小リクエスト間隔（秒）。CEEKはAIアクセス急増への対策として
# バースト的な連続アクセスを弾く（空を返す）。CEEKへは十分に間隔を空け、
# 1分あたり数リクエスト程度に抑える（我々の総アクセスは13回/収集=65回/日と
# もともと少ないので、バースト判定を避けることが目的）。
CEEK_HOST = "news.ceek.jp"
CEEK_MIN_INTERVAL = 10.0     # CEEKへの連続リクエスト間隔（保守的に広め）
DEFAULT_MIN_INTERVAL = 1.5   # 他ホストは軽めでよい
REQUEST_JITTER_SEC = 3.0     # 機械的な等間隔を避けるゆらぎ
# 空(0件)が返ったときのリトライ（スロットリングからの回復用）。
# リトライもCEEK負荷になるので控えめに。
EMPTY_RETRIES = 1
EMPTY_RETRY_WAIT_SEC = 12.0

# OGP画像取得の並列数。記事リンクは各報道機関サイト（約110ホストに分散）で
# CEEKではないため、並列化してもCEEKに負荷はかからない。逐次だと数百件×最大5秒で
# 収集が数分〜十数分かかっていたのを短縮する。
OGP_WORKERS = 6

# 直近リクエスト時刻（ホスト別）。同一ホストへの連続アクセスの間隔制御に使う。
_last_request_at: dict[str, float] = {}


def _throttle_host(url: str) -> None:
    """同一ホストへの連続アクセスがレート制限に触れないよう間隔を空ける。
    CEEK は特に広く、他ホストは軽めに。ゆらぎを足して機械的な等間隔を避ける。"""
    host = urlparse(url).netloc
    min_gap = CEEK_MIN_INTERVAL if host == CEEK_HOST else DEFAULT_MIN_INTERVAL
    last = _last_request_at.get(host)
    if last is not None:
        wait = min_gap - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait + random.uniform(0, REQUEST_JITTER_SEC))
    _last_request_at[host] = time.monotonic()

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
    """RSSフィードをパースし、記事リストを返す。

    同一ホストへの連続アクセスは間隔を空ける（CEEKは特に広く）。
    それでも0件が返ったときは、さらに待ってから1回だけ取り直す。
    """
    _throttle_host(feed_def["url"])
    feed = feedparser.parse(feed_def["url"], agent=FEED_AGENT)
    for _ in range(EMPTY_RETRIES):
        if feed.entries:
            break
        # 0件 = スロットリングの可能性。長めに待ってから取り直す（ホスト間隔も尊重）
        time.sleep(EMPTY_RETRY_WAIT_SEC)
        _throttle_host(feed_def["url"])
        feed = feedparser.parse(feed_def["url"], agent=FEED_AGENT)

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

    # 全フィードから記事を収集（フィード間の重複はリンクで排除）。
    # 同一ホストへの連続アクセスは fetch_feed 内で間隔制御（CEEKは特に広く）。
    # 各フィードの取得件数はログに残す（どのカテゴリが痩せているか後から確認可能）。
    fetched: dict[str, dict] = {}
    empty_feeds: list[str] = []
    for feed_def in FEEDS:
        try:
            arts = fetch_feed(feed_def)
            for a in arts:
                if a["link"] not in fetched:
                    fetched[a["link"]] = a
            label = feed_def["url"].split("category_id=")[-1].split("&")[0]
            print(f"  feed {feed_def['source']:10s} {label:16s} -> {len(arts):3d} entries")
            if not arts:
                empty_feeds.append(f"{feed_def['source']}:{label}")
        except Exception as e:
            print(f"Feed error ({feed_def['url']}): {e}")
            empty_feeds.append(f"{feed_def['source']}:{feed_def['url']}")

    if empty_feeds:
        print(f"Empty feeds ({len(empty_feeds)}): {', '.join(empty_feeds)}")

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

    # OGP画像を並列取得（記事リンクはCEEKではなく各報道機関サイトに分散するため
    # 並列化してもCEEKには負荷がかからない。逐次だと数百件×最大5秒で遅かった）。
    with ThreadPoolExecutor(max_workers=OGP_WORKERS) as pool:
        images = list(pool.map(lambda a: fetch_ogp_image(a["link"]), new_articles))

    rows = []
    for a, img in zip(new_articles, images):
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
