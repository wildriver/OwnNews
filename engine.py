"""
Ranking Engine (Cloud版)
Supabase (pgvector) を使ったベクトル類似度検索とユーザーベクトル管理。
Embeddingは収集時にDB保存済みのため、閲覧時にEmbedding APIは呼ばない。
"""

import json
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


class RankingEngine:
    """Supabase pgvector を使った記事ランキングとユーザーベクトル管理。"""

    def __init__(self, supabase: Client, user_id: str = "default"):
        self.sb = supabase
        self.user_id = user_id

    # --- ユーザーベクトル ---

    def get_user_vector(self) -> list[float] | None:
        """Supabaseからユーザーベクトルを取得する。"""
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
        """ユーザーベクトルをSupabaseに保存する。"""
        self.sb.table("user_vectors").upsert({
            "user_id": self.user_id,
            "vector": vector,
        }).execute()

    def _init_user_vector(self) -> list[float]:
        """ユーザーベクトルが未設定の場合、最新記事の平均ベクトルで初期化する。"""
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
        """
        記事をランキングして返す。

        filter_strength (F ∈ [0, 1]):
            F → 1: 類似度上位N件のみ
            F → 0: 類似度上位の件数を減らし、ランダム記事を混ぜる
        """
        user_vec = self.get_user_vector()
        if not user_vec:
            user_vec = self._init_user_vector()
        if not user_vec:
            # ベクトルもなく記事もない
            return self._get_latest(top_n)

        # F に応じて類似記事とランダム記事の配分を決定
        similar_count = max(1, int(top_n * filter_strength))
        random_count = top_n - similar_count

        # 類似度上位を取得
        similar_resp = self.sb.rpc(
            "match_articles",
            {"query_vector": user_vec, "match_count": similar_count},
        ).execute()
        results = similar_resp.data or []

        # ランダム記事を取得（セレンディピティ）
        if random_count > 0:
            similar_ids = {r["id"] for r in results}
            random_resp = self.sb.rpc(
                "random_articles",
                {"pick_count": random_count + 10},  # 重複除去用に多めに取得
            ).execute()
            for r in random_resp.data or []:
                if r["id"] not in similar_ids and len(results) < top_n:
                    r["similarity"] = 0.0  # ランダム記事はスコアなし
                    results.append(r)

        return results

    def _get_latest(self, limit: int) -> list[dict]:
        """ベクトル未設定時のフォールバック: 最新記事を返す。"""
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
        """ユーザーの操作をuser_interactionsテーブルに記録する。"""
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
        """指定タイプのインタラクション済み article_id を返す。"""
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
        """インタラクション履歴を記事情報付きで返す。"""
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

        # 記事情報を一括取得
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
        """ダッシュボード用の統計情報を返す。"""
        # 総記事数
        total_resp = (
            self.sb.table("articles")
            .select("id", count="exact")
            .execute()
        )
        total_articles = total_resp.count or 0

        # インタラクション一覧
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

        # カテゴリ別閲覧数（閲覧した記事のカテゴリを集計）
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
            # カテゴリはカンマ区切りの場合があるので分割
            all_cats = []
            for c in cats:
                all_cats.extend(
                    t.strip() for t in c.split(",") if t.strip()
                )
            category_counts = dict(Counter(all_cats))

        # 日別収集数（直近14日）
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
                day = r["collected_at"][:10]  # YYYY-MM-DD
                daily_counts[day] = daily_counts.get(day, 0) + 1

        return {
            "total_articles": total_articles,
            "view_count": view_count,
            "not_interested_count": not_interested_count,
            "category_counts": category_counts,
            "daily_counts": daily_counts,
        }

    # --- フィードバック ---

    def _get_article_embedding(self, article_id: str) -> np.ndarray | None:
        """記事のembeddingベクトルを取得する。"""
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
        """記事を閲覧した: 弱い正のフィードバック (α=0.03)"""
        self._record_interaction(article_id, "view")
        self._apply_feedback(article_id, alpha=0.03)

    def record_deep_dive(self, article_id: str) -> None:
        """深掘りボタンを押した: 強い正のフィードバック (α=0.15)"""
        self._record_interaction(article_id, "deep_dive")
        self._apply_feedback(article_id, alpha=0.15)

    def record_not_interested(self, article_id: str) -> None:
        """興味なしボタンを押した: 強い負のフィードバック (α=-0.2)"""
        self._record_interaction(article_id, "not_interested")
        self._apply_feedback(article_id, alpha=-0.2)

    def _apply_feedback(self, article_id: str, alpha: float) -> None:
        """
        ユーザーベクトルを更新する。

        alpha > 0: 正のフィードバック → u_new = (1-α)*u + α*v  (vに近づく)
        alpha < 0: 負のフィードバック → u_new = (1+α)*u - α*v  (vから遠ざかる)
          ※ α=-0.2 の場合: u_new = 0.8*u + 0.2*(u - v) の方向 → vから離れる
        """
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
            # 負のフィードバック: vから遠ざかる方向に更新
            strength = abs(alpha)
            new_vec = (1 + strength) * u - strength * v
            # ノルムを保持（ベクトルの大きさが発散しないよう正規化）
            norm = np.linalg.norm(new_vec)
            if norm > 0:
                new_vec = new_vec * (np.linalg.norm(u) / norm)

        self._save_user_vector(new_vec.tolist())
