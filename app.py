"""
Streamlit News Viewer (単一DB + Google Auth版)
Google OAuth 認証で各ユーザを識別し、パーソナライズされたニュースフィードを提供する。
情報的健康パネル、オンボーディング、3タブUIを含む。
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


# --- Supabase ---

@st.cache_resource
def get_supabase():
    """単一Supabaseクライアント。"""
    return create_client(
        st.secrets["SUPABASE_URL"],
        st.secrets["SUPABASE_KEY"],
    )


def get_engine(user_id: str) -> RankingEngine:
    """認証済みユーザのRankingEngineを返す。"""
    return RankingEngine(supabase=get_supabase(), user_id=user_id)


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


# --- ログイン画面 ---

def render_login() -> None:
    """未認証時のログイン画面を描画する。"""
    st.title("📰 OwnNews")
    st.markdown(
        "AIによるパーソナライズされたニュースフィードを体験しましょう。\n\n"
        "利用するには、Googleアカウントでログインしてください。"
    )

    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        if st.button(
            "🔐 Googleでログイン",
            type="primary",
            use_container_width=True,
        ):
            st.login("google")

    st.divider()
    st.caption(
        "**プライバシーについて**\n\n"
        "- 閲覧履歴や興味データはあなた専用として保存されます\n"
        "- Googleアカウントはログイン認証のみに使用されます\n"
        "- 記事データは全ユーザで共有、閲覧履歴は個人ごとに分離されます"
    )


# --- オンボーディング ---

def render_onboarding(engine: RankingEngine) -> None:
    """初回起動時のオンボーディング画面を描画する。"""
    st.title("📰 OwnNews へようこそ！")
    st.markdown(
        f"**{st.user.name}** さん、あなたの興味に合わせたニュースフィードを作成します。\n"
        "まず、興味のあるカテゴリを選択し、表示される記事に投票してください。"
    )

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
                        if st.button(
                            "👍" if current_vote != "like" else "✅",
                            key=f"ob_like_{i}",
                        ):
                            votes[article["id"]] = "like"
                            st.rerun()
                    with b2:
                        if st.button(
                            "👎" if current_vote != "dislike" else "❌",
                            key=f"ob_dislike_{i}",
                        ):
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

    dist = health["category_distribution"]
    if dist:
        st.caption("カテゴリ別 摂取量")
        df = pd.DataFrame(
            list(dist.items()),
            columns=["カテゴリ", "件数"],
        ).sort_values("件数", ascending=True)
        st.bar_chart(df, x="カテゴリ", y="件数", horizontal=True)

    if health["dominant_category"]:
        ratio_pct = int(health["dominant_ratio"] * 100)
        st.caption(
            f"最多: **{health['dominant_category']}** ({ratio_pct}%)"
        )

    missing = health["missing_categories"]
    if missing:
        suggestions = "、".join(missing[:3])
        st.info(f"💡 **{suggestions}** の記事も\n読んでみましょう")


# --- カード描画 ---

def _do_interaction(engine: RankingEngine, aid: str, action: str, title: str) -> None:
    """インタラクションを記録してフィードを更新する。"""
    try:
        if action == "view":
            engine.record_view(aid)
        elif action == "deep_dive":
            engine.record_deep_dive(aid)
        elif action == "not_interested":
            engine.record_not_interested(aid)
        _invalidate_feed()
    except Exception as e:
        st.error(f"記録に失敗しました: {e}")


def render_card(article: dict, engine: RankingEngine) -> None:
    aid = article["id"]
    img = article.get("image_url") or PLACEHOLDER_IMG
    similarity = article.get("similarity", 0)
    score_pct = max(0, min(100, similarity * 100))
    title = article.get("title", "")
    link = article.get("link", "")
    summary = article.get("summary", "")
    category = article.get("category", "")
    published = article.get("published", "")

    with st.container(border=True):
        st.image(img, use_container_width=True)

        meta = []
        if published:
            meta.append(published[:16])
        if category:
            meta.append(category)
        meta.append(f"マッチ {score_pct:.0f}%")
        st.caption(" ／ ".join(meta))

        # 記事を内部展開（クリックで開閉）
        with st.expander(title, expanded=False):
            if summary:
                st.markdown(summary)
            st.markdown(f"[🔗 元記事を開く]({link})")

            # 深掘り結果
            dive_key = f"dive_{aid}"
            if dive_key in st.session_state:
                st.info(st.session_state[dive_key])

        c1, c2, c3 = st.columns(3)
        with c1:
            if st.button("👁 閲覧", key=f"r_{aid}"):
                _do_interaction(engine, aid, "view", title)
                st.rerun()
        with c2:
            if st.button("🔍 深掘り", key=f"d_{aid}"):
                _do_interaction(engine, aid, "deep_dive", title)
                try:
                    analysis = deep_dive(title, summary)
                except Exception as e:
                    analysis = f"分析失敗: {e}"
                st.session_state[f"dive_{aid}"] = analysis
                st.rerun()
        with c3:
            if st.button("👎 除外", key=f"x_{aid}"):
                _do_interaction(engine, aid, "not_interested", title)
                st.rerun()


def _invalidate_feed() -> None:
    """フィード記事のキャッシュをクリアして再取得させる。"""
    st.session_state.pop("feed_articles", None)


# --- Tab 1: ニュースフィード ---

def render_news_tab(engine: RankingEngine) -> None:
    with st.sidebar:
        st.header("設定")

        # ユーザ情報 + ログアウト
        st.caption(f"👤 {st.user.name}")
        st.caption(f"📧 {st.user.email}")
        if st.button("🚪 ログアウト", use_container_width=True):
            st.logout()

        st.divider()

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

    # 記事取得（セッションにキャッシュして rerun 間で安定させる）
    cache_key = f"feed_{filter_strength:.2f}_{top_n}"
    if "feed_articles" not in st.session_state or st.session_state.get("feed_cache_key") != cache_key:
        try:
            raw = engine.rank(
                filter_strength=filter_strength, top_n=top_n + 30
            )
        except Exception as e:
            st.error(f"記事の取得に失敗しました: {e}")
            return
        st.session_state["feed_articles"] = raw
        st.session_state["feed_cache_key"] = cache_key

    all_articles = st.session_state["feed_articles"]

    if not all_articles:
        st.info("記事がまだありません。GitHub Actions による収集をお待ちください。")
        return

    # 既読・除外済み記事をフィルタ
    interacted_ids = engine.get_interacted_ids(
        ["view", "deep_dive", "not_interested"]
    )
    articles = [a for a in all_articles if a["id"] not in interacted_ids]
    articles = articles[:top_n]

    if not articles:
        st.info("未読の記事がありません。次回の収集をお待ちください。")
        return

    st.caption(f"{len(articles)} 件（未読） ／ フィルタ: {filter_strength:.2f}")

    if st.button("🔄 記事を更新"):
        _invalidate_feed()
        st.rerun()

    # カードグリッド
    for row_start in range(0, len(articles), COLS_PER_ROW):
        cols = st.columns(COLS_PER_ROW)
        for col_idx, col in enumerate(cols):
            idx = row_start + col_idx
            if idx >= len(articles):
                break
            with col:
                render_card(articles[idx], engine)


# --- Tab 2: ダッシュボード ---

def render_dashboard_tab(engine: RankingEngine) -> None:
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


# --- Tab 3: フィルタ比較（Phase 2） ---

def render_filter_tab(engine: RankingEngine) -> None:
    st.subheader("🔄 フィルタ比較")
    st.info(
        "**この機能は Phase 2 で実装予定です。**\n\n"
        "将来的に以下の機能が追加されます：\n"
        "- 自分のフィルタ（関心ベクトル）を公開\n"
        "- 他のユーザのフィルタでニュースを閲覧\n"
        "- 情報摂取バランスの比較（レーダーチャート）\n"
        "- Federated Learning による推薦精度の向上"
    )

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
                st.metric("最多カテゴリ", health["dominant_category"])

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
    # 認証ゲート
    if not st.user.is_logged_in:
        render_login()
        st.stop()

    user_email = st.user.email
    engine = get_engine(user_id=user_email)

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
