-- grouping_threshold カラムを追加
ALTER TABLE public.user_profile ADD COLUMN IF NOT EXISTS grouping_threshold float DEFAULT 0.92;
