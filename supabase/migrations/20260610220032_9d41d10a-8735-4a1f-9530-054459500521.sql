ALTER TABLE public.agenda_items
  ADD COLUMN IF NOT EXISTS locations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS matter_url text,
  ADD COLUMN IF NOT EXISTS matter_guid text;