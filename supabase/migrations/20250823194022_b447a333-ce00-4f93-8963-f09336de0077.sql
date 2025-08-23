-- Enable realtime for clerk_notes and clerk_lists tables
ALTER TABLE public.clerk_notes REPLICA IDENTITY FULL;
ALTER TABLE public.clerk_lists REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.clerk_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clerk_lists;