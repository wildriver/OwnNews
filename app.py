"""
Streamlit News Viewer (Cloud版)
Supabase + pgvectorによるベクトル検索UIと、Groqによる深掘り機能を備える。
Streamlit Community Cloudにデプロイ可能。
"""

import requests
import streamlit as st
from supabase import create_client

from engine import RankingEngine

st.set_page_config(page_title="OwnNews", page_icon="📰", layout="wide")

# --- Supabase クライアント ---


@st.cache_resource
def get_supabase():
    return create_client(
        st.secrets["SUPABASE_URL"],
        st.secrets["SUPABASE_KEY"],
    )


@st.cache_resource
def get_engine():
    return RankingEngine(supabase=get_supabase())


# --- Groq 深掘り ---


def deep_dive(title: str, summary: str) -> str:
    """Groq APIを使って記事を深掘り分析する。"""
    api_key = st.secrets.get("GROQ_API_KEY", "")
    if not api_key:
        return "GROQ_API_KEY が設定されていません。"

    resp = requests.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "あなたはニュースアナリストです。"
                        "与えられたニュース記事について、背景・影響・今後の展望を"
                        "日本語で簡潔に分析してください（300字以内）。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"タイトル: {title}\n概要: {summary}",
                },
            ],
            "max_tokens": 512,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# --- メインUI ---


def main() -> None:
    st.title("📰 OwnNews — パーソナル・ニュースキュレーター")

    engine = get_engine()

    # --- サイドバー ---
    with st.sidebar:
        st.header("設定")

        filter_strength = st.slider(
            "フィルタ強度",
            min_value=0.0,
            max_value=1.0,
            value=0.5,
            step=0.05,
            help=(
                "1.0に近いほどパーソナライズが強く、"
                "0.0に近いほど多様な記事が表示されます。"
            ),
        )

        top_n = st.slider(
            "表示件数",
            min_value=5,
            max_value=100,
            value=30,
            step=5,
        )

    # --- 記事取得 ---
    try:
        articles = engine.rank(
            filter_strength=filter_strength, top_n=top_n
        )
    except Exception as e:
        st.error(f"記事の取得に失敗しました: {e}")
        return

    if not articles:
        st.info("記事がまだありません。GitHub Actions による収集をお待ちください。")
        return

    st.caption(f"{len(articles)} 件表示 ／ フィルタ強度: {filter_strength:.2f}")

    # --- 記事一覧 ---
    for i, article in enumerate(articles):
        similarity = article.get("similarity", 0)
        score_pct = max(0, min(100, similarity * 100))
        st.markdown(
            f"**[{article['title']}]({article['link']})** "
            f"&nbsp; `{score_pct:.0f}%`"
        )
        meta_parts = []
        if article.get("published"):
            meta_parts.append(article["published"])
        if article.get("category"):
            meta_parts.append(article["category"])
        if meta_parts:
            st.caption(" ／ ".join(meta_parts))

        if article.get("summary"):
            with st.expander("概要を表示"):
                st.write(article["summary"])

        # アクションボタン
        col_read, col_dive, col_dislike, col_space = st.columns(
            [1, 1, 1, 4]
        )

        with col_read:
            if st.button("👁 閲覧", key=f"read_{i}"):
                engine.record_view(article["id"])
                st.toast(f"「{article['title'][:20]}…」を記録しました")
                st.rerun()

        with col_dive:
            if st.button("🔍 深掘り", key=f"dive_{i}"):
                engine.record_deep_dive(article["id"])
                with st.spinner("Groq で分析中..."):
                    try:
                        analysis = deep_dive(
                            article["title"],
                            article.get("summary", ""),
                        )
                        st.info(analysis)
                    except Exception as e:
                        st.error(f"深掘り失敗: {e}")

        with col_dislike:
            if st.button("👎 興味なし", key=f"dislike_{i}"):
                engine.record_not_interested(article["id"])
                st.toast(f"「{article['title'][:20]}…」を除外しました")
                st.rerun()

        st.divider()


if __name__ == "__main__":
    main()
