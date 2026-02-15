#!/usr/bin/env python3
"""
既存記事のカテゴリ事前分類をバックフィルするスクリプト。
collector.py で事前分類が導入された後、既存記事の category_medium, category_minor を計算して更新する。
Groq APIのレート制限 (30 RPM) を考慮し、リクエスト間にスリープを入れる。
"""

import os
import sys
import time

from supabase import create_client

from categories import classify_medium, extract_keywords


def backfill_categories(supabase_url: str, supabase_key: str) -> int:
    """既存記事のカテゴリを更新する。"""
    sb = create_client(supabase_url, supabase_key)

    # まだ category_medium が未設定（NULL or 空文字）の記事を取得
    # Supabase のデフォルトリミットは1000件なので、ページネーションで全件取得
    all_articles = []
    offset = 0
    page_size = 1000
    while True:
        resp = (
            sb.table("articles")
            .select("id, title, summary, category")
            .or_("category_medium.is.null,category_medium.eq.")
            .not_.is_("embedding", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = resp.data or []
        all_articles.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    if not all_articles:
        print("No articles need backfilling.")
        return 0

    total = len(all_articles)
    print(f"Found {total} articles to backfill.")

    updated = 0
    for i, a in enumerate(all_articles):
        med = classify_medium(a.get("title", ""), a.get("category", ""))
        kws = extract_keywords(a.get("title", ""), a.get("summary", ""))

        # update で既存行のカテゴリカラムのみ更新（upsertだと他カラムがnullになる）
        sb.table("articles").update({
            "category_medium": med,
            "category_minor": kws,
        }).eq("id", a["id"]).execute()

        updated += 1
        if (i + 1) % 50 == 0:
            print(f"Processed {i + 1}/{total} articles...")

        # Groq API レート制限対策: 30 RPM = 2秒間隔
        # ただし fallback（API key なしやエラー時）はスリープ不要
        time.sleep(2.1)

    print(f"Backfill complete. Updated {updated} articles.")
    return updated


if __name__ == "__main__":
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables are required.")
        sys.exit(1)

    backfill_categories(SUPABASE_URL, SUPABASE_KEY)
