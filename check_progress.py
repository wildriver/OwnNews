import os
from supabase import create_client

def load_env():
    for path in ["web/.env.local", ".env.local"]:
        if os.path.exists(path):
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        os.environ[k.strip()] = v.strip().strip('"').strip("'")

load_env()

URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

sb = create_client(URL, KEY)

# Check articles with embedding_m3
count_resp = sb.table("articles").select("id", count="exact").not_.is_("embedding_m3", "null").execute()
print(f"Articles with embedding_m3: {count_resp.count}")

# Check user_vectors
users_resp = sb.table("user_vectors").select("user_id, vector_m3", count="exact").not_.is_("vector_m3", "null").execute()
print(f"Users with vector_m3: {users_resp.count}")
