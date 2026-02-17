import os
import time
import json
import requests
import argparse
from supabase import create_client

# --- Configuration ---
# Load env vars from .env.local if present
if os.path.exists("web/.env.local"):
    with open("web/.env.local") as f:
        for line in f:
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.strip().split("=", 1)
                if k not in os.environ:
                    os.environ[k] = v

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

# Cloudflare Config
CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "")
CF_MODEL = "@cf/meta/llama-3.1-8b-instruct"

# Local LLM Config
LOCAL_LLM_URL = os.environ.get("LOCAL_LLM_URL", "http://localhost:1234/v1")
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "llama-3.1-8b-instruct")

def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Supabase URL and Key are required.")
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def generate_prompt(articles):
    start_prompt = """
    You are a professional news analyst. 
    Analyze the following news articles to:
    1. Classify them into a "Medium Category".
    2. Extract "Minor Keywords".
    3. Calculate "Nutrient Scores" (0-100) based on the 5 elements of news.

    Allowed Medium Categories: 政治, 経済, 国際, IT・テクノロジー, スポーツ, エンタメ, 科学, 社会, 地方, ビジネス, 生活, 環境, 文化, その他.
    
    Nutrient Definitions:
    - fact_score (Protein): Base on objective data, 5W1H transparency. High: Detailed stats/facts. Low: Vague rumors.
    - context_score (Carbohydrate): Base on background info, history, "Why". High: Deep dive/Analysis. Low: Just what happened.
    - perspective_score (Vit/Min): Base on multi-viewpoints. High: Pros/Cons, diverse opinions. Low: Single-sided.
    - emotion_score (Fat): Base on emotional hook/drama. High: Heartwarming/Shocking. Low: Dry reporting.
    - immediacy_score (Water): Base on freshness/urgency. High: Breaking news/Live. Low: Evergreen/History.
    
    Input Articles:
    """
    
    articles_json = JSON.stringify([{ "id": a["id"], "title": a["title"], "summary": a.get("summary", "") } for a in articles], indent=2)

    end_prompt = """
    
    Instructions:
    1. Analyze each article title and summary.
    2. Assign a "Medium Category" and "Minor Keywords".
    3. Score each nutrient (0-100) as an integer.
    4. Output strictly a JSON list of objects.
    5. JSON format: [{"id": "...", "category_medium": "...", "category_minor": ["..."], "fact_score": 50, "context_score": 50, "perspective_score": 50, "emotion_score": 50, "immediacy_score": 50}]
    
    Output strictly valid JSON. No markdown.
    """
    return start_prompt + articles_json + end_prompt

# JSON helper for python (using standard json dump instead of JS one in prompt construction above)
def build_prompt_content(articles):
    simplified = [{"id": a["id"], "title": a["title"], "summary": a.get("summary", "")} for a in articles]
    
    return f"""
    You are a professional news analyst. 
    Analyze the following news articles to:
    1. Classify them into a "Medium Category".
    2. Extract "Minor Keywords".
    3. Calculate "Nutrient Scores" (0-100) based on the 5 elements of news.

    Allowed Medium Categories: 政治, 経済, 国際, IT・テクノロジー, スポーツ, エンタメ, 科学, 社会, 地方, ビジネス, 生活, 環境, 文化, その他.
    
    Nutrient Definitions:
    - fact_score (Protein): Base on objective data, 5W1H transparency. High: Detailed stats/facts. Low: Vague rumors.
    - context_score (Carbohydrate): Base on background info, history, "Why". High: Deep dive/Analysis. Low: Just what happened.
    - perspective_score (Vit/Min): Base on multi-viewpoints. High: Pros/Cons, diverse opinions. Low: Single-sided.
    - emotion_score (Fat): Base on emotional hook/drama. High: Heartwarming/Shocking. Low: Dry reporting.
    - immediacy_score (Water): Base on freshness/urgency. High: Breaking news/Live. Low: Evergreen/History.
    
    Input Articles:
    {json.dumps(simplified, ensure_ascii=False, indent=2)}
    
    Instructions:
    1. Analyze each article title and summary.
    2. Assign a "Medium Category" and "Minor Keywords".
    3. Score each nutrient (0-100) as an integer.
    4. Output strictly a JSON list of objects.
    5. JSON format: [{{"id": "...", "category_medium": "...", "category_minor": ["..."], "fact_score": 50, "context_score": 50, "perspective_score": 50, "emotion_score": 50, "immediacy_score": 50}}]
    
    Output strictly valid JSON. No markdown.
    """

def call_cloudflare(prompt):
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}"
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
    payload = {
        "messages": [
            {"role": "system", "content": "You are a precise JSON output machine."},
            {"role": "user", "content": prompt}
        ]
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    result = resp.json()
    return result["result"]["response"]

def call_local_llm(prompt):
    url = f"{LOCAL_LLM_URL}/chat/completions"
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": LOCAL_LLM_MODEL,
        "messages": [
            {"role": "system", "content": "You are a precise JSON output machine."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    result = resp.json()
    return result["choices"][0]["message"]["content"]

def clean_json(text):
    text = text.replace("```json", "").replace("```", "").strip()
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end >= 0:
        return text[start:end+1]
    return text

def process_batch(sb, batch, mode):
    prompt = build_prompt_content(batch)
    
    print(f"  > Calling AI ({mode})...")
    try:
        if mode == "cloudflare":
            response = call_cloudflare(prompt)
        else:
            response = call_local_llm(prompt)
            
        json_str = clean_json(response)
        data = json.loads(json_str)
        
        updates = []
        for item in data:
            # Validate needed fields
            if "id" not in item: continue
            
            update_payload = {
                "fact_score": item.get("fact_score", 0),
                "context_score": item.get("context_score", 0),
                "perspective_score": item.get("perspective_score", 0),
                "emotion_score": item.get("emotion_score", 0),
                "immediacy_score": item.get("immediacy_score", 0),
            }
            # Optional: Update categories if missing or if you want to overwrite
            if item.get("category_medium"):
                update_payload["category_medium"] = item["category_medium"]
            if item.get("category_minor"):
                update_payload["category_minor"] = item["category_minor"]
                
            updates.append({"id": item["id"], "payload": update_payload})
            
        # Update supabase one by one or upsert?
        # Upsert requires all fields or it might clear others if not careful? 
        # Actually 'update' by ID is safer for specific fields.
        print(f"  > Updating {len(updates)} records in Supabase...")
        for up in updates:
            sb.table("articles").update(up["payload"]).eq("id", up["id"]).execute()
            
        return len(updates)
        
    except Exception as e:
        print(f"  ! Error in AI processing: {e}")
        return 0

def main():
    parser = argparse.ArgumentParser(description="Backfill nutrient scores for articles.")
    parser.add_argument("--mode", choices=["cloudflare", "local"], default="local", help="AI Provider")
    parser.add_argument("--batch-size", type=int, default=10, help="Number of articles per batch")
    parser.add_argument("--limit", type=int, default=1000, help="Max articles to process")
    args = parser.parse_args()

    sb = get_supabase()
    
    print(f"Starting backfill. Mode: {args.mode}, Batch: {args.batch_size}")
    
    total_processed = 0
    
    while total_processed < args.limit:
        # Fetch articles with null or 0 fact_score
        # Using .or_ filter for flexibility
        resp = sb.table("articles").select("id, title, summary").or_("fact_score.is.null,fact_score.eq.0").limit(args.batch_size).execute()
        articles = resp.data
        
        if not articles:
            print("No more articles to process.")
            break
            
        print(f"Processing batch of {len(articles)} articles...")
        count = process_batch(sb, articles, args.mode)
        total_processed += count
        
        if args.mode == "cloudflare":
             # Rate limit for free tier precaution
            time.sleep(2) 
            
    print(f"Done. Processed {total_processed} articles.")

if __name__ == "__main__":
    main()
