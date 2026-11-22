ALTER TABLE public.dt_kore_learning_items
  ADD COLUMN IF NOT EXISTS question_or_trigger_en text;

ALTER TABLE public.phone_learning_items
  ADD COLUMN IF NOT EXISTS question_or_trigger_en text,
  ADD COLUMN IF NOT EXISTS doubt_for_owner_en text;

ALTER TABLE public.phone_knowledge_base
  ADD COLUMN IF NOT EXISTS title_en text;
