-- Update match_articles_m3 to include nutrient scores
DROP FUNCTION IF EXISTS match_articles_m3(vector(1024), int);

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
    category_medium text,
    category_minor text[],
    embedding_m3 vector(1024),
    fact_score int,
    context_score int,
    perspective_score int,
    emotion_score int,
    immediacy_score int,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        a.id, a.title, a.link, a.summary, a.published, a.category,
        a.image_url,
        a.category_medium, a.category_minor,
        a.embedding_m3,
        a.fact_score, a.context_score, a.perspective_score, a.emotion_score, a.immediacy_score,
        1 - (a.embedding_m3 <=> query_vector) AS similarity
    FROM articles a
    WHERE a.embedding_m3 IS NOT NULL
    ORDER BY a.embedding_m3 <=> query_vector
    LIMIT match_count;
$$;
