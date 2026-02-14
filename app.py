"""
Streamlit News Viewer (Cloud版 / Card Layout + Dashboard)
タブ形式UIでニュース閲覧とダッシュボードを提供する。
"""

import pandas as pd
import requests
import streamlit as st
from supabase import create_client

from engine import RankingEngine

st.set_page_config(page_title="OwnNews", page_icon="📰", layout="wide")

# --- カスタムCSS ---

st.markdown("""
<style>
/* カード全体 */
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlock"] {
    padding: 0 !important;
}
/* ボタンを小さく */
div.stButton > button {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    min-height: 0;
}
/* カード画像の角丸 */
div[data-testid="stImage"] img {
    border-radius: 6px;
    object-fit: cover;
}
</style>
""", unsafe_allow_html=True)

PLACEHOLDER_IMG = "https://placehold.co/400x200/e8e8e8/999?text=No+Image"
COLS_PER_ROW = 3


# --- Supabase ---

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
    """Groq APIで記事を深掘り分析する。"""
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


# --- カード描画 ---

def render_card(article: dict, index: int, engine: RankingEngine) -> None:
    """1枚のニュースカードを描画する。"""
    img = article.get("image_url") or PLACEHOLDER_IMG
    similarity = article.get("similarity", 0)
    score_pct = max(0, min(100, similarity * 100))
    title = article.get("title", "")
    link = article.get("link", "")
    category = article.get("category", "")
    published = article.get("published", "")

    with st.container(border=True):
        # サムネイル画像
        st.image(img, use_container_width=True)

        # タイトル（リンク）+ スコア
        st.markdown(
            f"**[{title}]({link})**"
            f" &nbsp;`{score_pct:.0f}%`"
        )

        # メタ情報
        meta = []
        if published:
            meta.append(published[:16])
        if category:
            meta.append(category)
        if meta:
            st.caption(" ／ ".join(meta))

        # アクションボタン（横並び）
        c1, c2, c3 = st.columns(3)
        with c1:
            if st.button("👁", key=f"r_{index}", help="閲覧として記録"):
                engine.record_view(article["id"])
                st.toast(f"「{title[:15]}…」を記録")
                st.rerun()
        with c2:
            if st.button("🔍", key=f"d_{index}", help="深掘り分析"):
                engine.record_deep_dive(article["id"])
                st.rerun()
        with c3:
            if st.button("👎", key=f"x_{index}", help="興味なし"):
                engine.record_not_interested(article["id"])
                st.toast(f"「{title[:15]}…」を除外")
                st.rerun()


# --- Tab 1: ニュースフィード ---

def render_news_tab(engine: RankingEngine) -> None:
    """ニュースフィードタブを描画する。"""
    # --- サイドバー ---
    with st.sidebar:
        st.header("設定")
        filter_strength = st.slider(
            "フィルタ強度",
            min_value=0.0,
            max_value=1.0,
            value=0.5,
            step=0.05,
            help="1.0=パーソナライズ強 / 0.0=多様性重視",
        )
        top_n = st.slider("表示件数", 6, 60, 30, step=3)

    # --- 深掘り結果の表示 ---
    if "dive_result" in st.session_state:
        dive = st.session_state.pop("dive_result")
        st.info(f"🔍 **{dive['title']}**\n\n{dive['analysis']}")

    # --- 記事取得 ---
    try:
        articles = engine.rank(
            filter_strength=filter_strength, top_n=top_n + 30
        )
    except Exception as e:
        st.error(f"記事の取得に失敗しました: {e}")
        return

    if not articles:
        st.info("記事がまだありません。GitHub Actions による収集をお待ちください。")
        return

    # --- 既読・除外済み記事をフィルタ ---
    interacted_ids = engine.get_interacted_ids(
        ["view", "deep_dive", "not_interested"]
    )
    articles = [a for a in articles if a["id"] not in interacted_ids]
    articles = articles[:top_n]

    if not articles:
        st.info("未読の記事がありません。次回の収集をお待ちください。")
        return

    st.caption(f"{len(articles)} 件（未読） ／ フィルタ: {filter_strength:.2f}")

    # --- 深掘りの処理（rerun前にセッションに保存） ---
    for i, article in enumerate(articles):
        if st.session_state.get(f"_dive_pending_{i}"):
            del st.session_state[f"_dive_pending_{i}"]
            try:
                analysis = deep_dive(
                    article["title"], article.get("summary", "")
                )
                st.session_state["dive_result"] = {
                    "title": article["title"],
                    "analysis": analysis,
                }
            except Exception as e:
                st.session_state["dive_result"] = {
                    "title": article["title"],
                    "analysis": f"分析失敗: {e}",
                }
            st.rerun()

    # --- カードグリッド ---
    for row_start in range(0, len(articles), COLS_PER_ROW):
        cols = st.columns(COLS_PER_ROW)
        for col_idx, col in enumerate(cols):
            idx = row_start + col_idx
            if idx >= len(articles):
                break
            with col:
                render_card(articles[idx], idx, engine)


# --- Tab 2: ダッシュボード ---

def render_dashboard_tab(engine: RankingEngine) -> None:
    """ダッシュボードタブを描画する。"""
    try:
        stats = engine.get_stats()
    except Exception as e:
        st.error(f"統計情報の取得に失敗しました: {e}")
        return

    # ===== 上段: 統計エリア =====
    st.subheader("統計")
    col_metrics, col_category, col_daily = st.columns(3)

    # --- メトリクス ---
    with col_metrics:
        st.metric("総記事数", f"{stats['total_articles']:,}")
        st.metric("閲覧済み", f"{stats['view_count']:,}")
        st.metric("興味なし", f"{stats['not_interested_count']:,}")

    # --- カテゴリ別閲覧数 ---
    with col_category:
        st.caption("カテゴリ別 閲覧数")
        cat_counts = stats.get("category_counts", {})
        if cat_counts:
            df_cat = pd.DataFrame(
                list(cat_counts.items()),
                columns=["カテゴリ", "件数"],
            ).sort_values("件数", ascending=False)
            st.bar_chart(df_cat, x="カテゴリ", y="件数")
        else:
            st.caption("まだ閲覧データがありません")

    # --- 日別収集数 ---
    with col_daily:
        st.caption("日別 記事収集数")
        daily_counts = stats.get("daily_counts", {})
        if daily_counts:
            df_daily = pd.DataFrame(
                list(daily_counts.items()),
                columns=["日付", "件数"],
            ).sort_values("日付")
            # 直近14日に絞る
            df_daily = df_daily.tail(14)
            st.line_chart(df_daily, x="日付", y="件数")
        else:
            st.caption("まだ収集データがありません")

    st.divider()

    # ===== 下段: 閲覧履歴 =====
    st.subheader("履歴")
    col_viewed, col_disliked = st.columns(2)

    # --- 閲覧済み ---
    with col_viewed:
        st.markdown("**👁 閲覧した記事**")
        viewed = engine.get_interaction_history(
            ["view", "deep_dive"], limit=50
        )
        if viewed:
            for item in viewed:
                title = item["title"]
                link = item["link"]
                cat = item.get("category", "")
                ts = item["created_at"][:16] if item.get("created_at") else ""
                badge = "🔍" if item["interaction_type"] == "deep_dive" else "👁"
                st.markdown(
                    f"{badge} **[{title}]({link})**"
                    if link else f"{badge} **{title}**"
                )
                meta = []
                if ts:
                    meta.append(ts)
                if cat:
                    meta.append(cat)
                if meta:
                    st.caption(" ／ ".join(meta))
        else:
            st.caption("まだ閲覧履歴がありません")

    # --- 興味なし ---
    with col_disliked:
        st.markdown("**👎 興味なしにした記事**")
        disliked = engine.get_interaction_history(
            ["not_interested"], limit=50
        )
        if disliked:
            for item in disliked:
                title = item["title"]
                link = item["link"]
                cat = item.get("category", "")
                ts = item["created_at"][:16] if item.get("created_at") else ""
                st.markdown(
                    f"**[{title}]({link})**"
                    if link else f"**{title}**"
                )
                meta = []
                if ts:
                    meta.append(ts)
                if cat:
                    meta.append(cat)
                if meta:
                    st.caption(" ／ ".join(meta))
        else:
            st.caption("まだデータがありません")


# --- メインUI ---

def main() -> None:
    st.title("📰 OwnNews")

    engine = get_engine()

    tab_news, tab_dashboard = st.tabs(["ニュース", "ダッシュボード"])

    with tab_news:
        render_news_tab(engine)

    with tab_dashboard:
        render_dashboard_tab(engine)


if __name__ == "__main__":
    main()
