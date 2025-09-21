-- Add DELETE policy for clerk_couple_members to allow users to remove themselves from couples
CREATE POLICY "clerk_couple_members_delete" 
ON public.clerk_couple_members 
FOR DELETE 
USING (user_id = (auth.jwt() ->> 'sub'));