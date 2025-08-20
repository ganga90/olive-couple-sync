-- Create lists table to track all lists (manual and auto-generated)
CREATE TABLE public.clerk_lists (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  couple_id uuid,
  author_id text,
  is_manual boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(name, couple_id, author_id)
);

-- Enable RLS
ALTER TABLE public.clerk_lists ENABLE ROW LEVEL SECURITY;

-- Create policies for lists
CREATE POLICY "Users can view their lists via Clerk" 
ON public.clerk_lists 
FOR SELECT 
USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

CREATE POLICY "Users can insert their own lists via Clerk" 
ON public.clerk_lists 
FOR INSERT 
WITH CHECK ((author_id = (auth.jwt() ->> 'sub'::text)) AND ((couple_id IS NULL) OR is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

CREATE POLICY "Users can update their lists via Clerk" 
ON public.clerk_lists 
FOR UPDATE 
USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

CREATE POLICY "Users can delete their lists via Clerk" 
ON public.clerk_lists 
FOR DELETE 
USING ((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_clerk_lists_updated_at
BEFORE UPDATE ON public.clerk_lists
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Add foreign key reference from notes to lists (optional, for future enhancement)
ALTER TABLE public.clerk_notes ADD COLUMN list_id uuid REFERENCES public.clerk_lists(id);