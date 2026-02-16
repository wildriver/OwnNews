"""
Re-embed all articles using BGE-M3 via LM Studio local API.
Includes retry logic and connection refresh for Supabase stability.

Prerequisites:
  1. Install LM Studio and download BAAI/bge-m3
  2. Start LM Studio server (default: http://localhost:1234)
  3. pip install supabase requests

Usage:
  python re_embed_lmstudio.py
"""
import os
import sys
import json
import time
import requests
from supabase import create_client

# --- Config ---
LM_STUDIO_URL = "http://localhost:1234/v1/embeddings"
LM_STUDIO_MODEL = "text-embedding-japanese-bge-reranker-v2-m3-v1"
BATCH_SIZE = 20  # Smaller batches for stability
MAX_RETRIES = 5

def load_env():
    """Load env from web/.env.local"""
    for path in ["web/.env.local", ".env.local", ".streamlit/secrets.toml"]:
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k not in os.environ:
                            os.environ[k] = v

load_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
# Prioritize Service Role Key for writes, then fallback to anon key
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or 
    os.environ.get("SUPABASE_KEY") or 
    os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set")
    sys.exit(1)

if os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
    print("Using SUPABASE_SERVICE_ROLE_KEY (Writing enabled)")
else:
    print("WARNING: Using ANON_KEY. Writes might fail due to RLS.")


def new_client():
    """Create a fresh Supabase client."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def check_lmstudio():
    """Verify LM Studio is running and the model is loaded."""
    try:
        resp = requests.get("http://localhost:1234/v1/models", timeout=5)
        resp.raise_for_status()
        models = resp.json().get("data", [])
        print(f"LM Studio models available: {[m['id'] for m in models]}")
        return True
    except Exception as e:
        print(f"ERROR: Cannot connect to LM Studio: {e}")
        print("Make sure LM Studio is running with BGE-M3 loaded.")
        return False


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Get embeddings from LM Studio local API."""
    resp = requests.post(
        LM_STUDIO_URL,
        headers={"Content-Type": "application/json"},
        json={
            "model": LM_STUDIO_MODEL,
            "input": texts,
        },
        timeout=300,
    )
    resp.raise_for_status()
    data = resp.json()["data"]
    data.sort(key=lambda x: x["index"])
    return [d["embedding"] for d in data]


def update_article_with_retry(article_id: str, embedding: list, max_retries: int = MAX_RETRIES):
    """Update a single article's embedding_m3, retrying on failure with fresh client."""
    for attempt in range(max_retries):
        try:
            sb = new_client()
            sb.table("articles").update({"embedding_m3": embedding}).eq("id", article_id).execute()
            return True
        except Exception as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt  # exponential backoff: 1, 2, 4, 8, 16s
                time.sleep(wait)
            else:
                print(f"    FAILED after {max_retries} retries for {article_id}: {e}")
                return False


def migrate():
    if not check_lmstudio():
        sys.exit(1)

    sb = new_client()

    # Count total articles needing embedding
    count_resp = sb.table("articles").select("id", count="exact").is_("embedding_m3", "null").execute()
    total = count_resp.count or 0
    print(f"\nTotal articles needing embedding_m3: {total}")

    if total == 0:
        print("All articles already have embedding_m3!")
        compute_user_vectors()
        return

    processed: int = 0
    errors: int = 0
    start_time: float = time.time()

    while True:
        # Refresh client every iteration to avoid stale connections
        try:
            sb = new_client()
            resp = sb.table("articles") \
                .select("id, title, summary") \
                .is_("embedding_m3", "null") \
                .limit(BATCH_SIZE) \
                .execute()
            articles = resp.data
        except Exception as e:
            print(f"  DB fetch error: {e}, retrying in 5s...")
            time.sleep(5)
            continue

        if not articles:
            break

        # Prepare texts
        texts = []
        for a in articles:
            title = (a.get("title") or "").strip()
            summary = (a.get("summary") or "").strip()
            text = f"{title} {summary}".strip()
            if not text:
                text = "empty"
            texts.append(text)

        try:
            embeddings = embed_texts(texts)

            # Verify dimensions
            if embeddings and len(embeddings[0]) != 1024:
                print(f"WARNING: Expected 1024 dimensions, got {len(embeddings[0])}")
                sys.exit(1)

            # Update DB one by one with retry
            for a, emb in zip(articles, embeddings):
                success = update_article_with_retry(a["id"], emb)
                if not success:
                    errors += 1

            processed += len(articles)
            elapsed = time.time() - start_time
            rate = processed / elapsed if elapsed > 0 else 0
            remaining = (total - processed) / rate if rate > 0 else 0

            print(
                f"  [{processed}/{total}] "
                f"{processed * 100 / total:.1f}% | "
                f"{rate:.1f} articles/sec | "
                f"ETA: {remaining:.0f}s"
            )

        except requests.exceptions.ConnectionError:
            print("ERROR: Lost connection to LM Studio. Retrying in 5s...")
            time.sleep(5)
            continue
        except Exception as e:
            errors += 1
            print(f"  Error: {e}, retrying in 3s...")
            time.sleep(3)
            if errors > 50:
                print("Too many errors, stopping.")
                break

    elapsed = time.time() - start_time
    print(f"\nDone! Processed {processed} articles in {elapsed:.0f}s ({errors} errors)")

    # --- Compute user vectors ---
    compute_user_vectors()


def compute_user_vectors():
    """Compute M3 user vectors from viewed articles."""
    print("\nComputing user vectors from interaction history...")
    sb = new_client()

    users_resp = sb.table("user_interactions") \
        .select("user_id") \
        .in_("interaction_type", ["view", "deep_dive"]) \
        .execute()

    user_ids = list(set(r["user_id"] for r in (users_resp.data or [])))
    print(f"Found {len(user_ids)} users with interactions")

    for uid in user_ids:
        try:
            sb = new_client()

            interactions = sb.table("user_interactions") \
                .select("article_id") \
                .eq("user_id", uid) \
                .in_("interaction_type", ["view", "deep_dive"]) \
                .execute()

            article_ids = [r["article_id"] for r in (interactions.data or [])]
            if not article_ids:
                continue

            articles = sb.table("articles") \
                .select("embedding_m3") \
                .in_("id", article_ids) \
                .not_.is_("embedding_m3", "null") \
                .execute()

            if not articles.data:
                print(f"  {uid}: No articles with embedding_m3 found")
                continue

            # Compute average vector
            vectors = []
            for a in articles.data:
                vec = a["embedding_m3"]
                if isinstance(vec, str):
                    vec = json.loads(vec)
                vectors.append(vec)

            dim = len(vectors[0])
            avg = [0.0] * dim
            for v in vectors:
                for i in range(dim):
                    avg[i] += v[i]
            for i in range(dim):
                avg[i] /= len(vectors)

            sb.table("user_vectors").upsert({
                "user_id": uid,
                "vector_m3": avg,
            }).execute()

            print(f"  {uid}: vector_m3 computed from {len(vectors)} articles ({dim}d)")
        except Exception as e:
            print(f"  Error for {uid}: {e}")

    print("User vectors updated!")


if __name__ == "__main__":
    migrate()
