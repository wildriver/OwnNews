-- Add embedding_m3 column (1024 dimensions for bge-m3)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding_m3 vector(1024);
ALTER TABLE user_vectors ADD COLUMN IF NOT EXISTS vector_m3 vector(1024);

-- Create index for the new column
CREATE INDEX IF NOT EXISTS articles_embedding_m3_idx
    ON articles USING ivfflat (embedding_m3 vector_cosine_ops)
    with (lists = 100);

-- Match articles function for BGE-M3
CREATE OR REPLACE FUNCTION match_articles_m3(
    query_vector vector(1024),
    match_count  int
)
RETURNS TABLE (
    id         text,
    title      text,
    link       text,
    summary    text,
    published  text,
    category   text,
    image_url  text,
    source     text,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        a.id, a.title, a.link, a.summary, a.published, a.category,
        a.image_url, a.source,
        1 - (a.embedding_m3 <=> query_vector) AS similarity
    FROM articles a
    WHERE a.embedding_m3 IS NOT NULL
    ORDER BY a.embedding_m3 <=> query_vector
    LIMIT match_count;
$$;
