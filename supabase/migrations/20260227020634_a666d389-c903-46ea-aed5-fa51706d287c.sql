
-- Add tasks_enabled flag to calendar_connections
ALTER TABLE public.calendar_connections 
ADD COLUMN IF NOT EXISTS tasks_enabled boolean DEFAULT false;
