<arg_value>#!/usr/bin/env python3
"""
既存記事のカテゴリ事前分類をバックフィルするスクリプト。
collector.py で事前分類が導入された後、既存記事の category_medium, category_minor を計算して更新する。
"""

import os
import sys

from supabase import create_client

from categories import classify_medium, extract_keywords


def _parse_vector(v):
    """Supabase pgvectorの値をfloatリストに変換する。"""
    import json
    if isinstance(v, str):
        return json.loads(v)
    return v


def backfill_categories(supabase_url: str, supabase_key: str, batch_size: int = 100) -> int:
    """既存記事のカテゴリを更新する。"""
    sb = create_client(supabase_url, supabase_key)

    # まだ category_medium, category_minor が未設定の記事を取得
    resp = (
        sb.table("articles")
        .select("id, title, summary, category")
        .is_("category_medium", "null")
        .is_("category_minor", "null")
        .not_.is_("embedding", "null")  # ベクトル化済みの記事のみ対象
        .execute()
    )
    articles = resp.data or []

    if not articles:
        print("No articles need backfilling.")
        return 0

    total = len(articles)
    print(f"Found {total} articles to backfill.")

    updated = 0
    for i in range(0, total, batch_size):
        batch = articles[i : i + batch_size]

        rows_to_update = []
        for a in batch:
            med = classify_medium(a.get("title", ""), a.get("category", ""))
            kws = extract_keywords(a.get("title", ""), a.get("summary", ""))

            rows_to_update.append({
                "id": a["id"],
                "category_medium": med,
                "category_minor": kws,
            })

        # Supabaseのアップデート関数を使用
        sb.table("articles").upsert(rows_to_update, on_conflict="id").execute()
        updated += len(batch)
        print(f"Processed {i + len(batch)}/{total} articles...")

    print(f"Backfill complete. Updated {updated} articles.")
    return updated


if __name__ == "__main__":
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("Error: SUPABASE_URL and SUPABASE_KEY environment variables are required.")
        sys.exit(1)

    backfill_categories(SUPABASE_URL, SUPABASE_KEY)