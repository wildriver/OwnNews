"""
Ranking Engine (単一DB + Google Auth版)
単一Supabase で記事とユーザデータを管理。
ユーザ識別は Google email ベース。
情報的健康スコア計算機能を含む。
"""

import json
import math
import re
from collections import Counter
from datetime import date

import numpy as np
from supabase import Client


def _parse_vector(v) -> list[float]:
    """Supabase pgvectorの値をfloatリストに変換する。"""
    if isinstance(v, str):
        return json.loads(v)
    return v


ONBOARDING_CATEGORIES = [
    "政治", "経済", "国際", "IT・テクノロジー",
    "スポーツ", "エンタメ", "科学", "社会", "地方",
]

# 大分類→中分類キーワードのマッピング
CATEGORY_TAXONOMY: dict[str, list[str]] = {
    "政治": ["選挙", "国会", "内閣", "与党", "野党", "外交", "防衛", "憲法", "政策", "行政"],
    "経済": ["株式", "為替", "金融", "企業", "雇用", "貿易", "景気", "物価", "税制", "投資", "不動産"],
    "国際": ["米国", "中国", "韓国", "北朝鮮", "ロシア", "EU", "中東", "アジア", "国連", "紛争"],
    "IT・テクノロジー": ["AI", "人工知能", "スマホ", "セキュリティ", "SNS", "半導体", "ロボット", "宇宙", "通信", "ゲーム", "アプリ"],
    "スポーツ": ["野球", "サッカー", "テニス", "ゴルフ", "バスケ", "陸上", "水泳", "格闘技", "相撲", "競馬", "五輪", "ラグビー"],
    "エンタメ": ["映画", "音楽", "ドラマ", "アニメ", "芸能", "お笑い", "漫画", "舞台", "アイドル", "バラエティ"],
    "科学": ["宇宙", "医療", "環境", "気候", "生物", "物理", "化学", "研究", "ノーベル", "発見"],
    "社会": ["事件", "事故", "裁判", "福祉", "教育", "医療", "災害", "犯罪", "少子化", "高齢化"],
    "地方": ["観光", "祭り", "特産", "自治体", "再開発", "過疎", "移住", "地域"],
    "ビジネス": ["起業", "決算", "M&A", "IPO", "マーケティング", "人事", "経営"],
    "生活": ["健康", "グルメ", "レシピ", "育児", "住まい", "ファッション", "旅行"],
    "環境": ["気候変動", "脱炭素", "再生可能", "リサイクル", "生態系", "温暖化"],
    "文化": ["文学", "美術", "歴史", "伝統", "哲学", "宗教", "建築"],
}

# カタカナ固有名詞抽出パターン（3文字以上）
_KATAKANA_RE = re.compile(r"[ァ-ヴー]{3,}")
# 「」内テキスト抽出パターン
_BRACKET_RE = re.compile(r"「([^」]+)」")


class RankingEngine:
    """単一Supabase を使った記事ランキングとユーザーベクトル管理。"""

    def __init__(self, supabase: Client, user_id: str):
        if not user_id:
            raise ValueError("user_id (email) is required")
        self.sb = supabase
        self.user_id = user_id

    # --- ユーザプロファイル自動登録 ---

    def _ensure_user_profile(self) -> None:
        """初回アクセス時に user_profile レコードを自動作成する。"""
        resp = (
            self.sb.table("user_profile")
            .select("user_id")
            .eq("user_id", self.user_id)
            .execute()
        )
        if not resp.data:
            self.sb.table("user_profile").insert({
                "user_id": self.user_id,
                "display_name": "",
                "onboarded": False,
            }).execute()

    # --- オンボーディング ---

    def is_onboarded(self) -> bool:
        """ユーザーがオンボーディング済みかを返す。"""
        self._ensure_user_profile()
        resp = (
            self.sb.table("user_profile")
            .select("onboarded")
            .eq("user_id", self.user_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0].get("onboarded", False)
        return False

    def complete_onboarding(
        self, liked_ids: list[str], disliked_ids: list[str]
    ) -> None:
        """オンボーディングを完了し初期ベクトルを生成する。"""
        if liked_ids:
            resp = (
                self.sb.table("articles")
                .select("embedding")
                .in_("id", liked_ids)
                .not_.is_("embedding", "null")
                .execute()
            )
            if resp.data:
                embeddings = np.array(
                    [_parse_vector(r["embedding"]) for r in resp.data],
                    dtype=np.float32,
                )
                neg_embeddings = None
                if disliked_ids:
                    neg_resp = (
                        self.sb.table("articles")
                        .select("embedding")
                        .in_("id", disliked_ids)
                        .not_.is_("embedding", "null")
                        .execute()
                    )
                    if neg_resp.data:
                        neg_embeddings = np.array(
                            [_parse_vector(r["embedding"]) for r in neg_resp.data],
                            dtype=np.float32,
                        )

                avg = embeddings.mean(axis=0)
                if neg_embeddings is not None:
                    neg_avg = neg_embeddings.mean(axis=0)
                    avg = avg - 0.3 * neg_avg
                    norm = np.linalg.norm(avg)
                    if norm > 0:
                        avg = avg * (np.linalg.norm(embeddings.mean(axis=0)) / norm)

                self._save_user_vector(avg.tolist())

        self.sb.table("user_profile").update(
            {"onboarded": True}
        ).eq("user_id", self.user_id).execute()

    def get_onboarding_articles(
        self, categories: list[str], count: int = 20
    ) -> list[dict]:
        """オンボーディング用の代表記事を取得する。"""
        results = []
        per_cat = max(3, count // max(1, len(categories)))
        for cat in categories:
            resp = (
                self.sb.table("articles")
                .select("id, title, link, summary, category, image_url")
                .ilike("category", f"%{cat}%")
                .not_.is_("embedding", "null")
                .limit(per_cat)
                .execute()
            )
            results.extend(resp.data or [])
        if len(results) < count:
            random_resp = self.sb.rpc(
                "random_articles", {"pick_count": count - len(results) + 5}
            ).execute()
            existing_ids = {r["id"] for r in results}
            for r in random_resp.data or []:
                if r["id"] not in existing_ids and len(results) < count:
                    results.append(r)
        return results[:count]

    # --- ユーザーベクトル ---

    def get_user_vector(self) -> list[float] | None:
        resp = (
            self.sb.table("user_vectors")
            .select("vector")
            .eq("user_id", self.user_id)
            .execute()
        )
        if resp.data:
            return _parse_vector(resp.data[0]["vector"])
        return None

    def _save_user_vector(self, vector: list[float]) -> None:
        self.sb.table("user_vectors").upsert({
            "user_id": self.user_id,
            "vector": vector,
        }).execute()

    def _init_user_vector(self) -> list[float]:
        resp = (
            self.sb.table("articles")
            .select("embedding")
            .not_.is_("embedding", "null")
            .limit(100)
            .execute()
        )
        if not resp.data:
            return []
        embeddings = np.array(
            [_parse_vector(r["embedding"]) for r in resp.data],
            dtype=np.float32,
        )
        avg = embeddings.mean(axis=0).tolist()
        self._save_user_vector(avg)
        return avg

    # --- ランキング ---

    def rank(
        self, filter_strength: float = 0.5, top_n: int = 30
    ) -> list[dict]:
        user_vec = self.get_user_vector()
        if not user_vec:
            user_vec = self._init_user_vector()
        if not user_vec:
            return self._get_latest(top_n)

        similar_count = max(1, int(top_n * filter_strength))
        random_count = top_n - similar_count

        similar_resp = self.sb.rpc(
            "match_articles",
            {"query_vector": user_vec, "match_count": similar_count},
        ).execute()
        results = similar_resp.data or []

        if random_count > 0:
            similar_ids = {r["id"] for r in results}
            random_resp = self.sb.rpc(
                "random_articles",
                {"pick_count": random_count + 10},
            ).execute()
            for r in random_resp.data or []:
                if r["id"] not in similar_ids and len(results) < top_n:
                    r["similarity"] = 0.0
                    results.append(r)

        # 推薦理由を付与
        top_cats = self._get_user_top_categories()
        for r in results:
            r["reason"] = self.explain_recommendation(
                r, r.get("similarity", 0), top_cats
            )

        return results

    def _get_latest(self, limit: int) -> list[dict]:
        resp = (
            self.sb.table("articles")
            .select("id, title, link, summary, published, category, image_url")
            .order("collected_at", desc=True)
            .limit(limit)
            .execute()
        )
        for r in resp.data:
            r["similarity"] = 0.0
        return resp.data

    # --- インタラクション記録 ---

    def _record_interaction(
        self, article_id: str, interaction_type: str
    ) -> None:
        self.sb.table("user_interactions").upsert(
            {
                "user_id": self.user_id,
                "article_id": article_id,
                "interaction_type": interaction_type,
            },
            on_conflict="user_id,article_id,interaction_type",
        ).execute()

    def get_interacted_ids(
        self, interaction_types: list[str] | None = None
    ) -> set[str]:
        query = (
            self.sb.table("user_interactions")
            .select("article_id")
            .eq("user_id", self.user_id)
        )
        if interaction_types:
            query = query.in_("interaction_type", interaction_types)
        resp = query.execute()
        return {r["article_id"] for r in resp.data}

    def get_interaction_history(
        self, interaction_types: list[str], limit: int = 50
    ) -> list[dict]:
        resp = (
            self.sb.table("user_interactions")
            .select("article_id, interaction_type, created_at")
            .eq("user_id", self.user_id)
            .in_("interaction_type", interaction_types)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        if not resp.data:
            return []

        article_ids = list({r["article_id"] for r in resp.data})
        articles_resp = (
            self.sb.table("articles")
            .select("id, title, link, category, published, image_url")
            .in_("id", article_ids)
            .execute()
        )
        article_map = {a["id"]: a for a in articles_resp.data}

        result = []
        for r in resp.data:
            article = article_map.get(r["article_id"], {})
            result.append({
                "article_id": r["article_id"],
                "interaction_type": r["interaction_type"],
                "created_at": r["created_at"],
                "title": article.get("title", "(削除済み)"),
                "link": article.get("link", ""),
                "category": article.get("category", ""),
                "published": article.get("published", ""),
                "image_url": article.get("image_url", ""),
            })
        return result

    def get_stats(self) -> dict:
        total_resp = (
            self.sb.table("articles")
            .select("id", count="exact")
            .execute()
        )
        total_articles = total_resp.count or 0

        interactions_resp = (
            self.sb.table("user_interactions")
            .select("article_id, interaction_type")
            .eq("user_id", self.user_id)
            .execute()
        )
        interactions = interactions_resp.data or []
        view_count = sum(
            1 for i in interactions
            if i["interaction_type"] in ("view", "deep_dive")
        )
        not_interested_count = sum(
            1 for i in interactions
            if i["interaction_type"] == "not_interested"
        )

        viewed_ids = [
            i["article_id"] for i in interactions
            if i["interaction_type"] in ("view", "deep_dive")
        ]
        category_counts: dict[str, int] = {}
        if viewed_ids:
            cat_resp = (
                self.sb.table("articles")
                .select("category")
                .in_("id", viewed_ids)
                .execute()
            )
            cats = [
                r["category"] for r in cat_resp.data
                if r.get("category")
            ]
            all_cats = []
            for c in cats:
                all_cats.extend(
                    t.strip() for t in c.split(",") if t.strip()
                )
            category_counts = dict(Counter(all_cats))

        daily_resp = (
            self.sb.table("articles")
            .select("collected_at")
            .order("collected_at", desc=True)
            .limit(2000)
            .execute()
        )
        daily_counts: dict[str, int] = {}
        for r in daily_resp.data:
            if r.get("collected_at"):
                day = r["collected_at"][:10]
                daily_counts[day] = daily_counts.get(day, 0) + 1

        return {
            "total_articles": total_articles,
            "view_count": view_count,
            "not_interested_count": not_interested_count,
            "category_counts": category_counts,
            "daily_counts": daily_counts,
        }

    # --- 情報的健康 ---

    def get_info_health(self) -> dict:
        """情報的健康スコアを計算する。

        Shannon entropy で多様性を、最頻カテゴリ占有率で偏食度を測定。
        """
        interactions_resp = (
            self.sb.table("user_interactions")
            .select("article_id, interaction_type")
            .eq("user_id", self.user_id)
            .in_("interaction_type", ["view", "deep_dive"])
            .execute()
        )
        viewed_ids = [r["article_id"] for r in (interactions_resp.data or [])]

        if not viewed_ids:
            return {
                "category_distribution": {},
                "diversity_score": 0,
                "dominant_category": "",
                "dominant_ratio": 0.0,
                "bias_level": "データ不足",
                "missing_categories": list(ONBOARDING_CATEGORIES),
                "total_viewed": 0,
            }

        cat_resp = (
            self.sb.table("articles")
            .select("category")
            .in_("id", viewed_ids)
            .execute()
        )
        all_cats: list[str] = []
        for r in cat_resp.data or []:
            if r.get("category"):
                all_cats.extend(
                    t.strip() for t in r["category"].split(",") if t.strip()
                )

        if not all_cats:
            return {
                "category_distribution": {},
                "diversity_score": 0,
                "dominant_category": "",
                "dominant_ratio": 0.0,
                "bias_level": "データ不足",
                "missing_categories": list(ONBOARDING_CATEGORIES),
                "total_viewed": len(viewed_ids),
            }

        counter = Counter(all_cats)
        total = sum(counter.values())
        distribution = dict(counter.most_common())

        n_categories = len(counter)
        if n_categories <= 1:
            diversity_score = 0
        else:
            entropy = -sum(
                (c / total) * math.log2(c / total)
                for c in counter.values()
            )
            max_entropy = math.log2(n_categories)
            diversity_score = int((entropy / max_entropy) * 100)

        dominant_cat, dominant_count = counter.most_common(1)[0]
        dominant_ratio = dominant_count / total

        if dominant_ratio > 0.6:
            bias_level = "偏食（強）"
        elif dominant_ratio > 0.4:
            bias_level = "やや偏り"
        else:
            bias_level = "バランス良好"

        seen_cats = set(counter.keys())
        missing = [
            c for c in ONBOARDING_CATEGORIES
            if c not in seen_cats
        ]

        return {
            "category_distribution": distribution,
            "diversity_score": diversity_score,
            "dominant_category": dominant_cat,
            "dominant_ratio": round(dominant_ratio, 2),
            "bias_level": bias_level,
            "missing_categories": missing,
            "total_viewed": len(viewed_ids),
        }

    # --- 階層的カテゴリ分類 ---

    @staticmethod
    def _classify_medium(title: str, category: str) -> str:
        """タイトル内キーワードマッチで中分類を返す。"""
        cats = [c.strip() for c in category.split(",") if c.strip()] if category else []
        for cat in cats:
            keywords = CATEGORY_TAXONOMY.get(cat, [])
            for kw in keywords:
                if kw in title:
                    return kw
        # カテゴリ不一致でも全分類を走査
        for keywords in CATEGORY_TAXONOMY.values():
            for kw in keywords:
                if kw in title:
                    return kw
        return "その他"

    @staticmethod
    def _extract_minor_keywords(title: str) -> list[str]:
        """カタカナ固有名詞と「」内テキストを小分類として抽出。"""
        minors: list[str] = []
        for m in _KATAKANA_RE.finditer(title):
            word = m.group()
            # 一般的な語を除外
            if word not in ("ニュース", "テレビ", "インター", "サービス", "システム", "プロジェクト", "コメント"):
                minors.append(word)
        for m in _BRACKET_RE.finditer(title):
            minors.append(m.group(1))
        return minors

    def get_hierarchical_health(self) -> dict:
        """大・中・小分類それぞれの情報的健康スコアを計算する。"""
        interactions_resp = (
            self.sb.table("user_interactions")
            .select("article_id, interaction_type")
            .eq("user_id", self.user_id)
            .in_("interaction_type", ["view", "deep_dive"])
            .execute()
        )
        viewed_ids = [r["article_id"] for r in (interactions_resp.data or [])]

        empty = {
            "distribution": {},
            "diversity_score": 0,
            "dominant": "",
            "dominant_ratio": 0.0,
        }
        if not viewed_ids:
            return {"major": empty, "medium": empty, "minor": empty, "total_viewed": 0}

        art_resp = (
            self.sb.table("articles")
            .select("title, category")
            .in_("id", viewed_ids)
            .execute()
        )

        major_list: list[str] = []
        medium_list: list[str] = []
        minor_list: list[str] = []

        for r in art_resp.data or []:
            title = r.get("title", "")
            category = r.get("category", "")
            # 大分類
            if category:
                cats = [c.strip() for c in category.split(",") if c.strip()]
                major_list.extend(cats)
            # 中分類
            med = self._classify_medium(title, category)
            medium_list.append(med)
            # 小分類
            minor_list.extend(self._extract_minor_keywords(title))

        def _calc_health(items: list[str]) -> dict:
            if not items:
                return {"distribution": {}, "diversity_score": 0, "dominant": "", "dominant_ratio": 0.0}
            counter = Counter(items)
            total = sum(counter.values())
            n = len(counter)
            if n <= 1:
                score = 0
            else:
                entropy = -sum((c / total) * math.log2(c / total) for c in counter.values())
                score = int((entropy / math.log2(n)) * 100)
            dom, dom_count = counter.most_common(1)[0]
            return {
                "distribution": dict(counter.most_common(10)),
                "diversity_score": score,
                "dominant": dom,
                "dominant_ratio": round(dom_count / total, 2),
            }

        return {
            "major": _calc_health(major_list),
            "medium": _calc_health(medium_list),
            "minor": _calc_health(minor_list),
            "total_viewed": len(viewed_ids),
        }

    # --- 推薦理由の説明 ---

    def explain_recommendation(
        self, article: dict, similarity: float, user_top_categories: list[str]
    ) -> str:
        """1行の推薦理由テキストを生成する。"""
        category = article.get("category", "")
        cats = [c.strip() for c in category.split(",") if c.strip()] if category else []

        # ユーザの上位カテゴリとの一致チェック
        matching = [c for c in cats if c in user_top_categories]

        if similarity > 0.7:
            pct = int(similarity * 100)
            return f"あなたの関心と{pct}%マッチ"
        elif matching:
            return f"よく読む「{matching[0]}」カテゴリの記事"
        elif similarity > 0.3:
            pct = int(similarity * 100)
            return f"関心に近い記事（{pct}%マッチ）"
        elif cats:
            return f"新しい視点: {cats[0]}"
        else:
            return "多様性のための提案"

    def _get_user_top_categories(self, top_n: int = 3) -> list[str]:
        """ユーザの閲覧履歴から上位カテゴリを返す。"""
        resp = (
            self.sb.table("user_interactions")
            .select("article_id")
            .eq("user_id", self.user_id)
            .in_("interaction_type", ["view", "deep_dive"])
            .limit(200)
            .execute()
        )
        if not resp.data:
            return []
        ids = [r["article_id"] for r in resp.data]
        cat_resp = (
            self.sb.table("articles")
            .select("category")
            .in_("id", ids)
            .execute()
        )
        all_cats: list[str] = []
        for r in cat_resp.data or []:
            if r.get("category"):
                all_cats.extend(c.strip() for c in r["category"].split(",") if c.strip())
        if not all_cats:
            return []
        return [c for c, _ in Counter(all_cats).most_common(top_n)]

    # --- 健康スコア履歴 ---

    def record_health_snapshot(self) -> None:
        """現在の健康スコアを日次で記録する（同日は上書き）。"""
        health = self.get_info_health()
        if health["total_viewed"] == 0:
            return
        hier = self.get_hierarchical_health()
        self.sb.table("health_score_history").upsert({
            "user_id": self.user_id,
            "score_date": date.today().isoformat(),
            "diversity": health["diversity_score"],
            "bias_ratio": health["dominant_ratio"],
            "top_category": health["dominant_category"],
            "detail": {
                "major_diversity": hier["major"]["diversity_score"],
                "medium_diversity": hier["medium"]["diversity_score"],
                "minor_diversity": hier["minor"]["diversity_score"],
            },
        }, on_conflict="user_id,score_date").execute()

    def get_health_history(self, days: int = 30) -> list[dict]:
        """過去N日分の健康スコア履歴を取得する。"""
        resp = (
            self.sb.table("health_score_history")
            .select("score_date, diversity, bias_ratio, top_category, detail")
            .eq("user_id", self.user_id)
            .order("score_date", desc=True)
            .limit(days)
            .execute()
        )
        return list(reversed(resp.data or []))

    # --- フィードバック ---

    def _get_article_embedding(self, article_id: str) -> np.ndarray | None:
        resp = (
            self.sb.table("articles")
            .select("embedding")
            .eq("id", article_id)
            .execute()
        )
        if not resp.data or resp.data[0]["embedding"] is None:
            return None
        return np.array(
            _parse_vector(resp.data[0]["embedding"]), dtype=np.float32
        )

    def record_view(self, article_id: str) -> None:
        self._record_interaction(article_id, "view")
        self._apply_feedback(article_id, alpha=0.03)

    def record_deep_dive(self, article_id: str) -> None:
        self._record_interaction(article_id, "deep_dive")
        self._apply_feedback(article_id, alpha=0.15)

    def record_not_interested(self, article_id: str) -> None:
        self._record_interaction(article_id, "not_interested")
        self._apply_feedback(article_id, alpha=-0.2)

    def _apply_feedback(self, article_id: str, alpha: float) -> None:
        v = self._get_article_embedding(article_id)
        if v is None:
            return

        user_vec = self.get_user_vector()
        if user_vec is None:
            if alpha > 0:
                self._save_user_vector(v.tolist())
            return

        u = np.array(user_vec, dtype=np.float32)

        if alpha >= 0:
            new_vec = (1 - alpha) * u + alpha * v
        else:
            strength = abs(alpha)
            new_vec = (1 + strength) * u - strength * v
            norm = np.linalg.norm(new_vec)
            if norm > 0:
                new_vec = new_vec * (np.linalg.norm(u) / norm)

        self._save_user_vector(new_vec.tolist())

    # --- 類似記事グルーピング ---

    def group_similar_articles(
        self, articles: list[dict], threshold: float = 0.85
    ) -> list[dict]:
        """embedding のコサイン類似度で類似記事をグループ化する。

        各グループは代表記事の dict に "related" キー（関連記事リスト）を追加した形式。
        """
        if not articles:
            return []

        ids = [a["id"] for a in articles]
        resp = (
            self.sb.table("articles")
            .select("id, embedding")
            .in_("id", ids)
            .not_.is_("embedding", "null")
            .execute()
        )
        embeddings: dict[str, np.ndarray] = {}
        for r in resp.data or []:
            embeddings[r["id"]] = np.array(
                _parse_vector(r["embedding"]), dtype=np.float32
            )

        grouped: list[dict] = []
        used: set[str] = set()

        for article in articles:
            aid = article["id"]
            if aid in used:
                continue

            emb_i = embeddings.get(aid)
            if emb_i is None:
                grouped.append({**article, "related": []})
                used.add(aid)
                continue

            group = {**article, "related": []}
            used.add(aid)
            norm_i = np.linalg.norm(emb_i)
            if norm_i == 0:
                grouped.append(group)
                continue

            for other in articles:
                oid = other["id"]
                if oid in used:
                    continue
                emb_j = embeddings.get(oid)
                if emb_j is None:
                    continue
                norm_j = np.linalg.norm(emb_j)
                if norm_j == 0:
                    continue
                sim = float(np.dot(emb_i, emb_j) / (norm_i * norm_j))
                if sim >= threshold:
                    group["related"].append(other)
                    used.add(oid)

            grouped.append(group)

        return grouped
