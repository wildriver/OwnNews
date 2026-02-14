"""
Ranking Engine (分散アーキテクチャ版)
共有DB (articles) と個人DB (user data) を分離。
情報的健康スコア計算機能を含む。
"""

import json
import math
from collections import Counter

import numpy as np
from supabase import Client


def _parse_vector(v) -> list[float]:
    """Supabase pgvectorの値をfloatリストに変換する。
    文字列 "[0.01, -0.02, ...]" またはリストのどちらにも対応。
    """
    if isinstance(v, str):
        return json.loads(v)
    return v


# オンボーディング用カテゴリ定義
ONBOARDING_CATEGORIES = [
    "政治", "経済", "国際", "IT・テクノロジー",
    "スポーツ", "エンタメ", "科学", "社会", "地方",
]


class RankingEngine:
    """共有DB + 個人DB を使った記事ランキングとユーザーベクトル管理。"""

    def __init__(
        self,
        articles_db: Client,
        user_db: Client,
        user_id: str = "default",
    ):
        self.articles_db = articles_db
        self.user_db = user_db
        self.user_id = user_id

    # --- オンボーディング ---

    def is_onboarded(self) -> bool:
        """ユーザーがオンボーディング済みかを返す。"""
        resp = (
            self.user_db.table("user_profile")
            .select("onboarded")
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
        # 👍記事のembeddingを取得
        if liked_ids:
            resp = (
                self.articles_db.table("articles")
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
                # 👎記事のembeddingも取得して負の影響を与える
                neg_embeddings = None
                if disliked_ids:
                    neg_resp = (
                        self.articles_db.table("articles")
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

                # 初期ベクトル = 👍平均 - 0.3 * 👎平均
                avg = embeddings.mean(axis=0)
                if neg_embeddings is not None:
                    neg_avg = neg_embeddings.mean(axis=0)
                    avg = avg - 0.3 * neg_avg
                    norm = np.linalg.norm(avg)
                    if norm > 0:
                        avg = avg * (np.linalg.norm(embeddings.mean(axis=0)) / norm)

                self._save_user_vector(avg.tolist())

        # オンボーディング完了フラグ
        self.user_db.table("user_profile").update(
            {"onboarded": True}
        ).execute()

    def get_onboarding_articles(
        self, categories: list[str], count: int = 20
    ) -> list[dict]:
        """オンボーディング用の代表記事を取得する。"""
        results = []
        per_cat = max(3, count // max(1, len(categories)))
        for cat in categories:
            resp = (
                self.articles_db.table("articles")
                .select("id, title, link, summary, category, image_url")
                .ilike("category", f"%{cat}%")
                .not_.is_("embedding", "null")
                .limit(per_cat)
                .execute()
            )
            results.extend(resp.data or [])
        # カテゴリで取れない場合はランダム補完
        if len(results) < count:
            random_resp = self.articles_db.rpc(
                "random_articles", {"pick_count": count - len(results) + 5}
            ).execute()
            existing_ids = {r["id"] for r in results}
            for r in random_resp.data or []:
                if r["id"] not in existing_ids and len(results) < count:
                    results.append(r)
        return results[:count]

    # --- ユーザーベクトル ---

    def get_user_vector(self) -> list[float] | None:
        """個人DBからユーザーベクトルを取得する。"""
        resp = (
            self.user_db.table("user_vectors")
            .select("vector")
            .eq("user_id", self.user_id)
            .execute()
        )
        if resp.data:
            return _parse_vector(resp.data[0]["vector"])
        return None

    def _save_user_vector(self, vector: list[float]) -> None:
        """ユーザーベクトルを個人DBに保存する。"""
        self.user_db.table("user_vectors").upsert({
            "user_id": self.user_id,
            "vector": vector,
        }).execute()

    def _init_user_vector(self) -> list[float]:
        """ユーザーベクトルが未設定の場合、最新記事の平均ベクトルで初期化する。"""
        resp = (
            self.articles_db.table("articles")
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
        """記事をランキングして返す。"""
        user_vec = self.get_user_vector()
        if not user_vec:
            user_vec = self._init_user_vector()
        if not user_vec:
            return self._get_latest(top_n)

        similar_count = max(1, int(top_n * filter_strength))
        random_count = top_n - similar_count

        # 類似度上位を取得（共有DB）
        similar_resp = self.articles_db.rpc(
            "match_articles",
            {"query_vector": user_vec, "match_count": similar_count},
        ).execute()
        results = similar_resp.data or []

        # ランダム記事を取得（共有DB）
        if random_count > 0:
            similar_ids = {r["id"] for r in results}
            random_resp = self.articles_db.rpc(
                "random_articles",
                {"pick_count": random_count + 10},
            ).execute()
            for r in random_resp.data or []:
                if r["id"] not in similar_ids and len(results) < top_n:
                    r["similarity"] = 0.0
                    results.append(r)

        return results

    def _get_latest(self, limit: int) -> list[dict]:
        """ベクトル未設定時のフォールバック: 最新記事を返す。"""
        resp = (
            self.articles_db.table("articles")
            .select("id, title, link, summary, published, category, image_url")
            .order("collected_at", desc=True)
            .limit(limit)
            .execute()
        )
        for r in resp.data:
            r["similarity"] = 0.0
        return resp.data

    # --- インタラクション記録（個人DB） ---

    def _record_interaction(
        self, article_id: str, interaction_type: str
    ) -> None:
        """ユーザーの操作を個人DBのuser_interactionsテーブルに記録する。"""
        self.user_db.table("user_interactions").upsert(
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
        """指定タイプのインタラクション済み article_id を返す。"""
        query = (
            self.user_db.table("user_interactions")
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
        """インタラクション履歴を記事情報付きで返す。"""
        resp = (
            self.user_db.table("user_interactions")
            .select("article_id, interaction_type, created_at")
            .eq("user_id", self.user_id)
            .in_("interaction_type", interaction_types)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        if not resp.data:
            return []

        # 記事情報を共有DBから一括取得
        article_ids = list({r["article_id"] for r in resp.data})
        articles_resp = (
            self.articles_db.table("articles")
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
        """ダッシュボード用の統計情報を返す。"""
        # 総記事数（共有DB）
        total_resp = (
            self.articles_db.table("articles")
            .select("id", count="exact")
            .execute()
        )
        total_articles = total_resp.count or 0

        # インタラクション一覧（個人DB）
        interactions_resp = (
            self.user_db.table("user_interactions")
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

        # カテゴリ別閲覧数
        viewed_ids = [
            i["article_id"] for i in interactions
            if i["interaction_type"] in ("view", "deep_dive")
        ]
        category_counts: dict[str, int] = {}
        if viewed_ids:
            cat_resp = (
                self.articles_db.table("articles")
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

        # 日別収集数（共有DB）
        daily_resp = (
            self.articles_db.table("articles")
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

        食事の栄養バランスのアナロジーで、ニュース情報の摂取バランスを評価。
        Shannon entropy で多様性を、最頻カテゴリ占有率で偏食度を測定する。
        """
        # 閲覧記事のカテゴリ分布を集計（個人DB + 共有DB）
        interactions_resp = (
            self.user_db.table("user_interactions")
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

        # カテゴリ情報を共有DBから取得
        cat_resp = (
            self.articles_db.table("articles")
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

        # カテゴリ分布
        counter = Counter(all_cats)
        total = sum(counter.values())
        distribution = dict(counter.most_common())

        # Shannon entropy で多様性スコアを計算（0-100に正規化）
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

        # 偏食度（最頻カテゴリの占有率）
        dominant_cat, dominant_count = counter.most_common(1)[0]
        dominant_ratio = dominant_count / total

        if dominant_ratio > 0.6:
            bias_level = "偏食（強）"
        elif dominant_ratio > 0.4:
            bias_level = "やや偏り"
        else:
            bias_level = "バランス良好"

        # 不足カテゴリ（閲覧数が0または極端に少ないカテゴリ）
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

    # --- フィードバック ---

    def _get_article_embedding(self, article_id: str) -> np.ndarray | None:
        """記事のembeddingベクトルを共有DBから取得する。"""
        resp = (
            self.articles_db.table("articles")
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
        """記事を閲覧した: 弱い正のフィードバック (alpha=0.03)"""
        self._record_interaction(article_id, "view")
        self._apply_feedback(article_id, alpha=0.03)

    def record_deep_dive(self, article_id: str) -> None:
        """深掘りボタンを押した: 強い正のフィードバック (alpha=0.15)"""
        self._record_interaction(article_id, "deep_dive")
        self._apply_feedback(article_id, alpha=0.15)

    def record_not_interested(self, article_id: str) -> None:
        """興味なしボタンを押した: 強い負のフィードバック (alpha=-0.2)"""
        self._record_interaction(article_id, "not_interested")
        self._apply_feedback(article_id, alpha=-0.2)

    def _apply_feedback(self, article_id: str, alpha: float) -> None:
        """ユーザーベクトルを更新する。"""
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
