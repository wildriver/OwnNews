"""
Streamlit News Viewer (分散アーキテクチャ版)
共有DB（記事）と個人DB（ユーザデータ）を分離。
オンボーディング、情報的健康パネル、3タブUIを提供する。
"""

import pandas as pd
import requests
import streamlit as st
from supabase import create_client

from engine import ONBOARDING_CATEGORIES, RankingEngine

st.set_page_config(page_title="OwnNews", page_icon="📰", layout="wide")

# --- カスタムCSS ---

st.markdown("""
<style>
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlock"] {
    padding: 0 !important;
}
div.stButton > button {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    min-height: 0;
}
div[data-testid="stImage"] img {
    border-radius: 6px;
    object-fit: cover;
}
</style>
""", unsafe_allow_html=True)

PLACEHOLDER_IMG = "https://placehold.co/400x200/e8e8e8/999?text=No+Image"
COLS_PER_ROW = 3


# --- Supabase 2-DB接続 ---

@st.cache_resource
def get_articles_db():
    """共有DB（記事用）クライアント。"""
    return create_client(
        st.secrets["ARTICLES_SUPABASE_URL"],
        st.secrets["ARTICLES_SUPABASE_KEY"],
    )


@st.cache_resource
def get_user_db():
    """個人DB（ユーザデータ用）クライアント。"""
    return create_client(
        st.secrets["USER_SUPABASE_URL"],
        st.secrets["USER_SUPABASE_KEY"],
    )


@st.cache_resource
def get_engine():
    return RankingEngine(
        articles_db=get_articles_db(),
        user_db=get_user_db(),
    )


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


# --- オンボーディング ---

def render_onboarding(engine: RankingEngine) -> None:
    """初回起動時のオンボーディング画面を描画する。"""
    st.title("📰 OwnNews へようこそ！")
    st.markdown(
        "あなたの興味に合わせたニュースフィードを作成します。\n"
        "まず、興味のあるカテゴリを選択し、表示される記事に投票してください。"
    )

    # ステップ1: カテゴリ選択
    if "onboard_step" not in st.session_state:
        st.session_state["onboard_step"] = 1

    if st.session_state["onboard_step"] == 1:
        st.subheader("① 興味のあるカテゴリを選択")
        selected = []
        cols = st.columns(3)
        for i, cat in enumerate(ONBOARDING_CATEGORIES):
            with cols[i % 3]:
                if st.checkbox(cat, value=True, key=f"ob_cat_{i}"):
                    selected.append(cat)

        if st.button("次へ →", disabled=len(selected) == 0):
            st.session_state["onboard_categories"] = selected
            st.session_state["onboard_step"] = 2
            st.rerun()

    # ステップ2: 記事への投票
    elif st.session_state["onboard_step"] == 2:
        st.subheader("② 記事に投票してください")
        st.caption("👍 興味あり / 👎 興味なし を押してください")

        categories = st.session_state.get("onboard_categories", [])
        if "onboard_articles" not in st.session_state:
            articles = engine.get_onboarding_articles(categories, count=15)
            st.session_state["onboard_articles"] = articles
            st.session_state["onboard_votes"] = {}

        articles = st.session_state["onboard_articles"]
        votes = st.session_state["onboard_votes"]

        if not articles:
            st.warning("記事がまだ収集されていません。オンボーディングをスキップします。")
            engine.complete_onboarding([], [])
            _clear_onboarding_state()
            st.rerun()
            return

        for i, article in enumerate(articles):
            with st.container(border=True):
                c1, c2 = st.columns([4, 1])
                with c1:
                    title = article.get("title", "")
                    cat = article.get("category", "")
                    st.markdown(f"**{title}**")
                    if cat:
                        st.caption(cat)
                with c2:
                    current_vote = votes.get(article["id"])
                    b1, b2 = st.columns(2)
                    with b1:
                        liked = st.button(
                            "👍" if current_vote != "like" else "✅",
                            key=f"ob_like_{i}",
                        )
                        if liked:
                            votes[article["id"]] = "like"
                            st.rerun()
                    with b2:
                        disliked = st.button(
                            "👎" if current_vote != "dislike" else "❌",
                            key=f"ob_dislike_{i}",
                        )
                        if disliked:
                            votes[article["id"]] = "dislike"
                            st.rerun()

        voted_count = len(votes)
        st.progress(min(1.0, voted_count / max(1, len(articles))))
        st.caption(f"{voted_count} / {len(articles)} 件投票済み")

        if st.button(
            "完了 → ニュースを見る",
            disabled=voted_count < 3,
            type="primary",
        ):
            liked_ids = [k for k, v in votes.items() if v == "like"]
            disliked_ids = [k for k, v in votes.items() if v == "dislike"]
            engine.complete_onboarding(liked_ids, disliked_ids)
            _clear_onboarding_state()
            st.rerun()


def _clear_onboarding_state() -> None:
    """オンボーディング用のセッション変数をクリアする。"""
    for key in [
        "onboard_step", "onboard_categories",
        "onboard_articles", "onboard_votes",
    ]:
        st.session_state.pop(key, None)


# --- 情報的健康パネル（サイドバー） ---

def render_info_health_panel(engine: RankingEngine) -> None:
    """サイドバーに情報的健康パネルを描画する。"""
    st.header("🥗 情報的健康")

    health = engine.get_info_health()
    total = health["total_viewed"]

    if total == 0:
        st.caption("記事を閲覧すると、情報摂取の\nバランスが表示されます。")
        return

    # 多様性スコア（ゲージ風表示）
    score = health["diversity_score"]
    bias = health["bias_level"]

    if score >= 70:
        score_color = "🟢"
    elif score >= 40:
        score_color = "🟡"
    else:
        score_color = "🔴"

    st.metric("多様性スコア", f"{score_color} {score}/100")
    st.caption(f"偏食度: {bias}")

    # カテゴリ別摂取バランス（横棒グラフ）
    dist = health["category_distribution"]
    if dist:
        st.caption("カテゴリ別 摂取量")
        df = pd.DataFrame(
            list(dist.items()),
            columns=["カテゴリ", "件数"],
        ).sort_values("件数", ascending=True)
        st.bar_chart(df, x="カテゴリ", y="件数", horizontal=True)

    # 最頻カテゴリ
    if health["dominant_category"]:
        ratio_pct = int(health["dominant_ratio"] * 100)
        st.caption(
            f"最多: **{health['dominant_category']}** ({ratio_pct}%)"
        )

    # 不足カテゴリの提案
    missing = health["missing_categories"]
    if missing:
        suggestions = "、".join(missing[:3])
        st.info(f"💡 **{suggestions}** の記事も\n読んでみましょう")


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
        st.image(img, use_container_width=True)
        st.markdown(
            f"**[{title}]({link})**"
            f" &nbsp;`{score_pct:.0f}%`"
        )
        meta = []
        if published:
            meta.append(published[:16])
        if category:
            meta.append(category)
        if meta:
            st.caption(" ／ ".join(meta))

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

        st.divider()
        render_info_health_panel(engine)

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

    st.subheader("統計")
    col_metrics, col_category, col_daily = st.columns(3)

    with col_metrics:
        st.metric("総記事数", f"{stats['total_articles']:,}")
        st.metric("閲覧済み", f"{stats['view_count']:,}")
        st.metric("興味なし", f"{stats['not_interested_count']:,}")

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

    with col_daily:
        st.caption("日別 記事収集数")
        daily_counts = stats.get("daily_counts", {})
        if daily_counts:
            df_daily = pd.DataFrame(
                list(daily_counts.items()),
                columns=["日付", "件数"],
            ).sort_values("日付")
            df_daily = df_daily.tail(14)
            st.line_chart(df_daily, x="日付", y="件数")
        else:
            st.caption("まだ収集データがありません")

    st.divider()

    st.subheader("履歴")
    col_viewed, col_disliked = st.columns(2)

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


# --- Tab 3: フィルタ比較（Phase 2 プレースホルダ） ---

def render_filter_tab(engine: RankingEngine) -> None:
    """フィルタ比較タブ（Phase 2 で本格実装）。"""
    st.subheader("🔄 フィルタ比較")
    st.info(
        "**この機能は Phase 2 で実装予定です。**\n\n"
        "将来的に以下の機能が追加されます：\n"
        "- 自分のフィルタ（関心ベクトル）を公開\n"
        "- 他のユーザのフィルタでニュースを閲覧\n"
        "- 情報摂取バランスの比較（レーダーチャート）\n"
        "- Federated Learning による推薦精度の向上"
    )

    # 現在の情報的健康サマリーを表示
    health = engine.get_info_health()
    if health["total_viewed"] > 0:
        st.subheader("あなたの情報プロファイル")
        col1, col2 = st.columns(2)
        with col1:
            st.metric("多様性スコア", f"{health['diversity_score']}/100")
            st.metric("偏食度", health["bias_level"])
        with col2:
            st.metric("閲覧記事数", health["total_viewed"])
            if health["dominant_category"]:
                st.metric(
                    "最多カテゴリ",
                    health["dominant_category"],
                )

        dist = health["category_distribution"]
        if dist:
            st.caption("カテゴリ分布")
            df = pd.DataFrame(
                list(dist.items()),
                columns=["カテゴリ", "件数"],
            ).sort_values("件数", ascending=False)
            st.bar_chart(df, x="カテゴリ", y="件数")


# --- メインUI ---

def main() -> None:
    engine = get_engine()

    # オンボーディング未完了なら専用画面
    if not engine.is_onboarded():
        render_onboarding(engine)
        return

    st.title("📰 OwnNews")

    tab_news, tab_dashboard, tab_filter = st.tabs(
        ["ニュース", "ダッシュボード", "フィルタ比較"]
    )

    with tab_news:
        render_news_tab(engine)

    with tab_dashboard:
        render_dashboard_tab(engine)

    with tab_filter:
        render_filter_tab(engine)


if __name__ == "__main__":
    main()
