-- Add nutrient score columns to articles table
-- Each score is an integer between 0 and 100

ALTER TABLE articles 
ADD COLUMN IF NOT EXISTS fact_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS context_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS perspective_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS emotion_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS immediacy_score INT DEFAULT 0;

-- Optional: Comment on columns for clarity
COMMENT ON COLUMN articles.fact_score IS '事実 (Fact): 骨格・客観データ (0-100)';
COMMENT ON COLUMN articles.context_score IS '背景 (Context): 理解のためのエネルギー・経緯 (0-100)';
COMMENT ON COLUMN articles.perspective_score IS '多角的視点 (Perspective): 反対意見・異なる立場 (0-100)';
COMMENT ON COLUMN articles.emotion_score IS '感情的フック (Emotion): 共感・驚き・演出 (0-100)';
COMMENT ON COLUMN articles.immediacy_score IS '速報性 (Immediacy): 即効性・鮮度 (0-100)';
