"""
RSS Collector Module
Fetches RSS feeds, saves raw data to Supabase, and scores nutrient values via Groq API.
"""

import hashlib
import json
import os
import re
import time

import feedparser
import requests
from supabase import create_client

# --- Config ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL   = "llama-3.1-8b-instant"

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


def score_articles_with_groq(articles: list[dict]) -> list[dict]:
    """
    Groq API (llama-3.1-8b-instant) を使って記事の栄養素スコアを計算する。
    articles: [{"id": ..., "title": ..., "summary": ...}, ...]
    返り値: [{"id": ..., "fact_score": int, "context_score": int, ...}, ...]
    """
    if not GROQ_API_KEY or not articles:
        return []

    simplified = [
        {"id": a["id"], "title": a["title"], "summary": a.get("summary", "")[:200]}
        for a in articles
    ]

    prompt = f"""You are a news analyst. Score each article on 5 dimensions (0-100 integers).

Definitions:
- fact_score: Objective facts, data, 5W1H clarity. High=detailed stats/facts. Low=vague rumors.
- context_score: Background info, history, "why". High=deep analysis. Low=just what happened.
- perspective_score: Multiple viewpoints. High=pros/cons, diverse opinions. Low=single-sided.
- emotion_score: Emotional impact. High=heartwarming/shocking. Low=dry reporting.
- immediacy_score: Breaking news urgency. High=live/breaking. Low=evergreen/historical.

Articles:
{json.dumps(simplified, ensure_ascii=False)}

Output ONLY a JSON array, no markdown:
[{{"id": "...", "fact_score": 50, "context_score": 50, "perspective_score": 50, "emotion_score": 50, "immediacy_score": 50}}]"""

    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": "Output only valid JSON arrays."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.1,
                "max_tokens": 1024,
            },
            timeout=30,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]

        # JSON 部分だけ抽出
        start = content.find("[")
        end = content.rfind("]")
        if start < 0 or end < 0:
            return []
        data = json.loads(content[start:end + 1])
        return data

    except Exception as e:
        print(f"  [Groq] Scoring error: {e}")
        return []


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
        img = fetch_ogp_image(a["link"])
        rows.append({
            "id": a["id"],
            "title": a["title"],
            "link": a["link"],
            "summary": a["summary"],
            "published": a["published"],
            "category": a["category"],
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

    # --- Groq で栄養素スコアリング ---
    if GROQ_API_KEY:
        print(f"Scoring {len(new_articles)} articles with Groq ({GROQ_MODEL})...")
        score_batch = 8  # Groq は高速なので 8 件ずつ処理
        scored_total = 0
        for i in range(0, len(new_articles), score_batch):
            batch = new_articles[i: i + score_batch]
            scores = score_articles_with_groq(batch)
            if scores:
                for s in scores:
                    try:
                        sb.table("articles").update({
                            "fact_score":        max(0, min(100, int(s.get("fact_score", 0)))),
                            "context_score":     max(0, min(100, int(s.get("context_score", 0)))),
                            "perspective_score": max(0, min(100, int(s.get("perspective_score", 0)))),
                            "emotion_score":     max(0, min(100, int(s.get("emotion_score", 0)))),
                            "immediacy_score":   max(0, min(100, int(s.get("immediacy_score", 0)))),
                        }).eq("id", s["id"]).execute()
                        scored_total += 1
                    except Exception as e:
                        print(f"  [Groq] DB update error for {s.get('id')}: {e}")
            # Groq レート制限対策: 1秒待機
            time.sleep(1)
        print(f"Scored {scored_total} articles.")
    else:
        print("GROQ_API_KEY not set — skipping nutrient scoring.")

    return len(new_articles)


if __name__ == "__main__":
    collect()
