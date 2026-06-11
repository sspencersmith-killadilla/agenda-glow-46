ALTER TABLE public.agenda_items
  ADD COLUMN IF NOT EXISTS is_grant boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grant_award_amount numeric,
  ADD COLUMN IF NOT EXISTS grant_match_amount numeric,
  ADD COLUMN IF NOT EXISTS grantor text;

CREATE INDEX IF NOT EXISTS agenda_items_is_grant_idx ON public.agenda_items (is_grant) WHERE is_grant;