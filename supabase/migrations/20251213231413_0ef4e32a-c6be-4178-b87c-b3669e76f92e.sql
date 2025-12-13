-- Drop existing policies on note-media bucket objects
DROP POLICY IF EXISTS "Users can upload note media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view note media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete note media" ON storage.objects;
DROP POLICY IF EXISTS "note_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "note_media_select" ON storage.objects;
DROP POLICY IF EXISTS "note_media_delete" ON storage.objects;

-- Create new policies that use folder path instead of owner_id
-- Users can upload to their own folder (folder name = user_id string)
CREATE POLICY "note_media_insert_clerk"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'note-media' 
  AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

-- Anyone can view note-media since it's a public bucket
CREATE POLICY "note_media_select_public"
ON storage.objects FOR SELECT
USING (bucket_id = 'note-media');

-- Users can delete from their own folder
CREATE POLICY "note_media_delete_clerk"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'note-media' 
  AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);

-- Users can update their own files
CREATE POLICY "note_media_update_clerk"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'note-media' 
  AND (storage.foldername(name))[1] = (auth.jwt() ->> 'sub')
);