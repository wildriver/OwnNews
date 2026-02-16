-- Drop existing function first (return type changed)
DROP FUNCTION IF EXISTS match_articles_m3(vector, integer);

-- Update match_articles_m3 to include category_medium and category_minor
CREATE OR REPLACE FUNCTION match_articles_m3(
    query_vector vector(1024),
    match_count  int
)
RETURNS TABLE (
    id              text,
    title           text,
    link            text,
    summary         text,
    published       text,
    category        text,
    category_medium text,
    category_minor  text[],
    image_url       text,
    similarity      float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        a.id, a.title, a.link, a.summary, a.published, a.category,
        a.category_medium, a.category_minor,
        a.image_url,
        1 - (a.embedding_m3 <=> query_vector) AS similarity
    FROM articles a
    WHERE a.embedding_m3 IS NOT NULL
    ORDER BY a.embedding_m3 <=> query_vector
    LIMIT match_count;
$$;
