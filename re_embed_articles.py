import os
import requests
from supabase import create_client
import time

# Helper to load from files
def load_env():
    # Try .env.local
    if os.path.exists("web/.env.local"):
        with open("web/.env.local") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    if k not in os.environ:
                        os.environ[k] = v
    # Try .streamlit/secrets.toml (simple parser)
    if os.path.exists(".streamlit/secrets.toml"):
        with open(".streamlit/secrets.toml") as f:
            for line in f:
                if "=" in line:
                    k, v = line.strip().split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v

load_env()

# Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
CF_MODEL = "@cf/baai/bge-m3"

def embed_texts(texts):
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}"
    resp = requests.post(
        url,
        headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        json={"text": texts},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["result"]["data"]

def migrate():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Fetch articles where embedding_m3 is null
    # We limit to small batches to observe the "Neurons" consumption
    # The user requested to stay within the free tier (10,000 neurons/day)
    # BGE-M3 is 1,075 Neurons per 1M tokens.
    # 150 articles with 200 tokens each = 30,000 tokens = ~32 Neurons. Very safe.
    batch_size = 20
    max_articles = 200 # Process 200 articles at a time per run to be safe
    
    print(f"Starting migration to {CF_MODEL}...")
    
    processed = 0
    while processed < max_articles:
        resp = sb.table("articles").select("id, title, summary").is_("embedding_m3", "null").limit(batch_size).execute()
        articles = resp.data
        if not articles:
            print("All articles processed.")
            break
            
        texts = [f"{a['title']} {a['summary']}" for a in articles]
        try:
            embeddings = embed_texts(texts)
            
            for a, emb in zip(articles, embeddings):
                sb.table("articles").update({"embedding_m3": emb}).eq("id", a["id"]).execute()
            
            processed += len(articles)
            print(f"Processed {processed} articles...")
            time.sleep(1) # Small delay to avoid rate limiting
        except Exception as e:
            print(f"Error processing batch: {e}")
            break

if __name__ == "__main__":
    migrate()
