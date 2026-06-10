
CREATE TABLE public.agendas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  meeting_date DATE,
  source_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.agenda_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agenda_id UUID NOT NULL REFERENCES public.agendas(id) ON DELETE CASCADE,
  item_number TEXT,
  raw_title TEXT NOT NULL,
  item_type TEXT,
  department TEXT,
  cost_estimate TEXT,
  cost_numeric NUMERIC,
  plain_summary TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agenda_items_agenda_id ON public.agenda_items(agenda_id);

GRANT SELECT ON public.agendas TO anon, authenticated;
GRANT ALL ON public.agendas TO service_role;
GRANT SELECT ON public.agenda_items TO anon, authenticated;
GRANT ALL ON public.agenda_items TO service_role;

ALTER TABLE public.agendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view agendas" ON public.agendas FOR SELECT USING (true);
CREATE POLICY "Anyone can view agenda items" ON public.agenda_items FOR SELECT USING (true);
