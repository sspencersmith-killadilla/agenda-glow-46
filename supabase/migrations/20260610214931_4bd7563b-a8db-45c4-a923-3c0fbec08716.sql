
ALTER TABLE public.agenda_items
  ADD COLUMN matter_id integer,
  ADD COLUMN matter_short_name text,
  ADD COLUMN matter_status text,
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN staff_report_url text,
  ADD COLUMN enrichment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN enrichment_error text,
  ADD COLUMN enriched_at timestamptz,
  ADD COLUMN funding_source text,
  ADD COLUMN vendor text,
  ADD COLUMN recommendation text,
  ADD COLUMN background text,
  ADD COLUMN detailed_summary text;

CREATE INDEX IF NOT EXISTS idx_agenda_items_enrichment_status ON public.agenda_items(enrichment_status);
