"""
Streamlit News Viewer (単一DB + Google Auth版)
Google OAuth 認証で各ユーザを識別し、パーソナライズされたニュースフィードを提供する。
CSS先読み + JS切り替えによる高速記事展開、round-robin配置による隙間なしレイアウト。
"""

import html as html_module

import pandas as pd
import requests
import streamlit as st
from supabase import create_client

from engine import ONBOARDING_CATEGORIES, RankingEngine

st.set_page_config(page_title="OwnNews", page_icon="📰", layout="wide")

# --- クリーンな白系CSS + toggleDetail JS ---

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

[data-testid="stAppViewContainer"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* タイトな列間隔 */
[data-testid="stHorizontalBlock"] {
    gap: 8px !important;
}

/* カード */
div[data-testid="stContainer"] {
    border: 1px solid #e8e8e8 !important;
    border-radius: 10px !important;
    transition: box-shadow 0.15s;
}
div[data-testid="stContainer"]:hover {
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

/* ボタン */
div.stButton > button {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    min-height: 0;
    border-radius: 6px;
}

/* 画像 */
div[data-testid="stImage"] img {
    border-radius: 6px;
    object-fit: cover;
}

/* カード内タイトル */
.card-title-row {
    cursor: pointer;
    padding: 4px 0;
    font-weight: 500;
    font-size: 0.92rem;
    color: #1a1a1a;
    line-height: 1.35;
    user-select: none;
}
.card-title-row:hover {
    color: #1a73e8;
}
.card-meta {
    font-size: 0.75rem;
    color: #888;
    margin-bottom: 2px;
}
.card-reason {
    font-size: 0.72rem;
    color: #1a73e8;
    margin: 1px 0 3px;
}
.card-detail {
    font-size: 0.88rem;
    color: #333;
    line-height: 1.5;
}
.card-detail a {
    color: #1a73e8;
    text-decoration: none;
}
.card-detail a:hover {
    text-decoration: underline;
}
.card-dive-result {
    background: #e8f4fd;
    border-radius: 8px;
    padding: 10px 12px;
    margin: 8px 0 4px;
    font-size: 0.85rem;
    color: #333;
    line-height: 1.5;
}

/* レスポンシブ */
@media (max-width: 768px) {
    div.stButton > button {
        min-height: 44px;
        font-size: 0.9rem;
        padding: 0.4rem 0.8rem;
    }
    div[data-testid="stImage"] img {
        max-height: 150px;
    }
}
</style>
""", unsafe_allow_html=True)

# JS注入: st.markdownの<script>はReactに干渉するため、components.v1.htmlで注入
import streamlit.components.v1 as components
components.html("""
<script>
document.addEventListener('click', function(e) {
    var row = e.target.closest('[data-detail]');
    if (!row) return;
    var detailId = row.getAttribute('data-detail');
    var el = window.parent.document.getElementById(detailId);
    if (!el) return;
    var aid = detailId.replace('detail_', '');
    var arrow = window.parent.document.getElementById('arrow_' + aid);
    if (el.style.display === 'none' || el.style.display === '') {
        el.style.display = 'block';
        if (arrow) arrow.textContent = '▼';
    } else {
        el.style.display = 'none';
        if (arrow) arrow.textContent = '▶';
    }
});
</script>
""", height=0)

PAGE_SIZE = 20


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


# --- 画像の有無判定 ---

def _has_valid_image(group: dict) -> bool:
    """画像URLが存在し、プレースホルダーでないかを返す。"""
    url = group.get("image_url") or ""
    if not url:
        return False
    if "placehold" in url or "noimage" in url.lower():
        return False
    return True


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


# --- 階層的健康分析パネル（共通） ---

def render_hierarchical_health(engine: RankingEngine) -> None:
    """中分類・小分類の詳細分析を描画する。"""
    try:
        hier = engine.get_hierarchical_health()
    except Exception:
        st.caption("詳細分析を取得できませんでした")
        return

    col_med, col_minor = st.columns(2)

    with col_med:
        med = hier["medium"]
        if med["distribution"]:
            med_score = med["diversity_score"]
            st.caption(f"**中分類** 多様性: {med_score}/100")
            df_med = pd.DataFrame(
                list(med["distribution"].items()),
                columns=["中分類", "件数"],
            )
            st.bar_chart(df_med, x="中分類", y="件数")
        else:
            st.caption("中分類データなし")

    with col_minor:
        minor = hier["minor"]
        if minor["distribution"]:
            minor_score = minor["diversity_score"]
            st.caption(f"**小分類（キーワード）** 多様性: {minor_score}/100")
            df_minor = pd.DataFrame(
                list(minor["distribution"].items()),
                columns=["キーワード", "件数"],
            )
            st.bar_chart(df_minor, x="キーワード", y="件数")
        else:
            st.caption("小分類データなし")


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

    st.metric("多様性スコア（大分類）", f"{score_color} {score}/100")
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

    # 階層的分析（中分類・小分類）
    with st.expander("📊 詳細分析（中分類・小分類）"):
        render_hierarchical_health(engine)


# --- カード描画 ---

def _do_interaction(
    engine: RankingEngine, aids: list[str], action: str,
    invalidate: bool = False,
) -> None:
    """インタラクションを記録する。グループ内の全記事IDに適用。"""
    try:
        for aid in aids:
            if action == "view":
                engine.record_view(aid)
            elif action == "deep_dive":
                engine.record_deep_dive(aid)
            elif action == "not_interested":
                engine.record_not_interested(aid)
        if invalidate:
            _invalidate_feed()
    except Exception as e:
        st.error(f"記録に失敗しました: {e}")


def _build_card_html(group: dict, dive_result: str | None) -> str:
    """カードのHTML（メタ・タイトル・詳細）を構築する。rerun不要の即時展開用。"""
    aid = group["id"]
    related = group.get("related", [])
    title = group.get("title", "")
    link = group.get("link", "")
    summary = group.get("summary", "") or ""
    category = group.get("category", "")
    published = group.get("published", "")
    reason = group.get("reason", "")
    similarity = group.get("similarity", 0)
    score_pct = max(0, min(100, similarity * 100))

    detail_id = f"detail_{aid}"
    # 深掘り結果がある場合は最初から開いた状態にする
    force_open = dive_result is not None
    display = "block" if force_open else "none"
    arrow = "▼" if force_open else "▶"

    # メタ情報
    meta = []
    if published:
        meta.append(html_module.escape(published[:16]))
    if category:
        meta.append(html_module.escape(category))
    meta.append(f"{score_pct:.0f}%")
    if related:
        meta.append(f"+{len(related)}")
    meta_str = " ／ ".join(meta)

    # 推薦理由
    reason_html = ""
    if reason:
        reason_html = (
            f'<div class="card-reason">'
            f'💡 {html_module.escape(reason)}</div>'
        )

    # 詳細コンテンツ
    detail_parts = []
    if summary:
        detail_parts.append(
            f'<p style="margin:6px 0;">{html_module.escape(summary)}</p>'
        )
    detail_parts.append(
        f'<p>🔗 <a href="{html_module.escape(link)}" target="_blank">'
        f'{html_module.escape(title)}</a></p>'
    )
    for rel in related:
        rt = html_module.escape(rel.get("title", ""))
        rl = html_module.escape(rel.get("link", ""))
        detail_parts.append(
            f'<p>🔗 <a href="{rl}" target="_blank">{rt}</a></p>'
        )

    # 深掘り結果
    dive_html = ""
    if dive_result:
        dive_html = (
            f'<div class="card-dive-result">'
            f'{html_module.escape(dive_result)}</div>'
        )

    detail_content = "\n".join(detail_parts) + dive_html

    return f"""
    <div class="card-meta">{meta_str}</div>
    {reason_html}
    <div class="card-title-row" data-detail="{detail_id}">
        <span id="arrow_{aid}">{arrow}</span> {html_module.escape(title)}
    </div>
    <div id="{detail_id}" class="card-detail" style="display:{display};">
        {detail_content}
    </div>
    """


@st.fragment
def render_card(group: dict, engine: RankingEngine) -> None:
    """記事カードを描画する。タイトル展開はJS即時、深掘り/除外はStreamlit。"""
    aid = group["id"]
    related = group.get("related", [])
    all_ids = [aid] + [r["id"] for r in related]
    title = group.get("title", "")
    summary = group.get("summary", "") or ""

    dive_key = f"dive_{aid}"
    dive_result = st.session_state.get(dive_key)

    with st.container(border=True):
        # 画像（あれば）
        if _has_valid_image(group):
            st.image(group["image_url"], use_container_width=True)

        # カード本体をHTMLで先読みレンダリング
        card_html = _build_card_html(group, dive_result)
        st.markdown(card_html, unsafe_allow_html=True)

        # インタラクションボタン（Streamlit — サーバー通信が必要）
        c1, c2 = st.columns(2)
        with c1:
            if st.button("🔍 深掘り", key=f"d_{aid}"):
                _do_interaction(engine, all_ids, "deep_dive", invalidate=False)
                with st.spinner("分析中..."):
                    try:
                        analysis = deep_dive(title, summary)
                    except Exception as e:
                        analysis = f"分析失敗: {e}"
                st.session_state[dive_key] = analysis
                st.rerun(scope="fragment")
        with c2:
            if st.button("👎 除外", key=f"x_{aid}"):
                _do_interaction(engine, all_ids, "not_interested", invalidate=True)
                st.rerun()


def _invalidate_feed() -> None:
    """フィード記事のキャッシュをクリアして再取得させる。"""
    st.session_state.pop("feed_groups", None)
    st.session_state.pop("feed_cache_key", None)
    st.session_state.pop("feed_show_count", None)


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
        cols_per_row = st.slider(
            "カラム数",
            min_value=1,
            max_value=6,
            value=4,
            step=1,
            help="1行あたりの列数（大画面では多く設定）",
        )

        st.divider()
        render_info_health_panel(engine)

    # 健康スコアを日次記録（1セッション1回）
    if "health_snapshot_done" not in st.session_state:
        try:
            engine.record_health_snapshot()
            st.session_state["health_snapshot_done"] = True
        except Exception:
            pass

    # 記事取得（セッションにキャッシュして rerun 間で安定させる）
    cache_key = f"feed_{filter_strength:.2f}"
    if "feed_groups" not in st.session_state or st.session_state.get("feed_cache_key") != cache_key:
        try:
            raw = engine.rank(filter_strength=filter_strength, top_n=100)
        except Exception as e:
            st.error(f"記事の取得に失敗しました: {e}")
            return

        # 既読・除外済み記事をフィルタ
        interacted_ids = engine.get_interacted_ids(
            ["view", "deep_dive", "not_interested"]
        )
        filtered = [a for a in raw if a["id"] not in interacted_ids]

        # 類似記事をグループ化
        groups = engine.group_similar_articles(filtered, threshold=0.85)

        st.session_state["feed_groups"] = groups
        st.session_state["feed_cache_key"] = cache_key
        st.session_state["feed_show_count"] = PAGE_SIZE

    groups = st.session_state["feed_groups"]

    if not groups:
        st.info("未読の記事がありません。次回の収集をお待ちください。")
        return

    show_count = st.session_state.get("feed_show_count", PAGE_SIZE)
    visible = groups[:show_count]

    st.caption(f"{len(groups)} グループ（未読） ／ フィルタ: {filter_strength:.2f}")

    if st.button("🔄 記事を更新"):
        _invalidate_feed()
        st.rerun()

    # Round-robin配置: カードを各列に均等分配（マソンリー風レイアウト）
    cols = st.columns(cols_per_row)
    for i, group in enumerate(visible):
        with cols[i % cols_per_row]:
            render_card(group, engine)

    # 無限スクロール: 残りがあれば自動読み込みトリガー
    if show_count < len(groups):
        remaining = len(groups) - show_count
        load_more = st.button(
            f"⬇ もっと読み込む（残り {remaining}）",
            key="load_more_btn",
            use_container_width=True,
        )
        if load_more:
            st.session_state["feed_show_count"] = show_count + PAGE_SIZE
            st.rerun()

        # Intersection Observer で自動読み込み
        st.markdown("""
        <div id="scroll-sentinel" style="height:1px;"></div>
        <script>
        const sentinel = document.getElementById('scroll-sentinel');
        if (sentinel) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const btn = document.querySelector('button[kind="secondary"]');
                        if (btn && btn.textContent.includes('もっと読み込む')) {
                            btn.click();
                            observer.disconnect();
                        }
                    }
                });
            }, { threshold: 0.1 });
            observer.observe(sentinel);
        }
        </script>
        """, unsafe_allow_html=True)


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

    # 情報的健康スコア推移
    st.subheader("📈 情報的健康スコア推移")
    try:
        history = engine.get_health_history(days=30)
        if history:
            df_health = pd.DataFrame(history)
            df_health = df_health.rename(columns={
                "score_date": "日付",
                "diversity": "多様性スコア",
            })
            st.line_chart(df_health, x="日付", y="多様性スコア")
        else:
            st.caption("まだ履歴データがありません（日々の利用で蓄積されます）")
    except Exception:
        st.caption("スコア履歴の取得に失敗しました")

    st.divider()

    # 階層的健康分析（ダッシュボード版）
    st.subheader("📊 情報摂取の詳細分析")
    render_hierarchical_health(engine)

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
