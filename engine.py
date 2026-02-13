"""
Ranking Engine (Cloud版)
Supabase (pgvector) を使ったベクトル類似度検索とユーザーベクトル管理。
Embeddingは収集時にDB保存済みのため、閲覧時にEmbedding APIは呼ばない。
"""

import json

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
            .select("id, title, link, summary, published, category")
            .order("collected_at", desc=True)
            .limit(limit)
            .execute()
        )
        for r in resp.data:
            r["similarity"] = 0.0
        return resp.data

    # --- フィードバック ---

    def update_user_vector(
        self, article_id: str, alpha: float = 0.1
    ) -> None:
        """
        クリックされた記事のベクトルでユーザーベクトルを更新する。
        u_new = (1 - α) * u_old + α * v_clicked
        """
        # クリック記事のembeddingを取得
        resp = (
            self.sb.table("articles")
            .select("embedding")
            .eq("id", article_id)
            .execute()
        )
        if not resp.data or resp.data[0]["embedding"] is None:
            return

        v_clicked = np.array(
            _parse_vector(resp.data[0]["embedding"]), dtype=np.float32
        )

        user_vec = self.get_user_vector()
        if user_vec is None:
            new_vec = v_clicked
        else:
            u_old = np.array(user_vec, dtype=np.float32)
            new_vec = (1 - alpha) * u_old + alpha * v_clicked

        self._save_user_vector(new_vec.tolist())
