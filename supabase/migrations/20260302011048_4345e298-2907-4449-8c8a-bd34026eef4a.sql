ALTER TABLE public.olive_router_log
ADD COLUMN IF NOT EXISTS media_present boolean DEFAULT false;