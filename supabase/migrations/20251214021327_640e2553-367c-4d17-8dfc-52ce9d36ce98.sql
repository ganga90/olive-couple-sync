-- Fix storage bucket security: make buckets private and add owner-scoped policies

-- 1. Update buckets to be private
UPDATE storage.buckets SET public = false WHERE id = 'whatsapp-media';
UPDATE storage.buckets SET public = false WHERE id = 'note-media';

-- 2. Drop existing overly permissive SELECT policies
DROP POLICY IF EXISTS "Public read access for whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for note media" ON storage.objects;

-- 3. Create owner-scoped SELECT policies for authenticated users
-- For note-media: allow users to read their own files (folder name = user_id)
CREATE POLICY "Users can read their own note media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'note-media' 
  AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

-- For whatsapp-media: allow users to read files in their folder or couple members
CREATE POLICY "Users can read their own whatsapp media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'whatsapp-media' 
  AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

-- Also allow couple members to read media attached to shared notes
-- by checking if the note's couple_id matches the user's couple membership
CREATE POLICY "Couple members can read shared note media"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('note-media', 'whatsapp-media')
  AND EXISTS (
    SELECT 1 FROM public.clerk_notes n
    JOIN public.clerk_couple_members m ON m.couple_id = n.couple_id
    WHERE m.user_id = (auth.jwt() ->> 'sub')
    AND n.media_urls IS NOT NULL
    AND name = ANY(
      SELECT unnest(n.media_urls)
    )
  )
);