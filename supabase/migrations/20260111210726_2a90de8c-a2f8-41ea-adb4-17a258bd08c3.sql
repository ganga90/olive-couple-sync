-- Make storage buckets private (no public access without signed URLs)
-- This does NOT affect RLS policies - uploads/deletes still work for authenticated users

UPDATE storage.buckets SET public = false WHERE id = 'note-media';
UPDATE storage.buckets SET public = false WHERE id = 'whatsapp-media';

-- Drop overly permissive public SELECT policy that allows anyone to read note-media
DROP POLICY IF EXISTS "note_media_select_public" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for note media" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for whatsapp media" ON storage.objects;

-- Keep existing owner-scoped policies intact (these still work for authenticated users):
-- - "Users can read their own note media" (SELECT for note-media, folder = user_id)
-- - "Users can read their own whatsapp media" (SELECT for whatsapp-media, folder = user_id)
-- - "Couple members can read shared note media" (SELECT for shared notes)
-- - "note_media_insert_clerk" (INSERT for note-media)
-- - "note_media_delete_clerk" (DELETE for note-media)
-- - "note_media_update_clerk" (UPDATE for note-media)
-- - "Users can upload their own media" (INSERT fallback)
-- - "Users can delete their own media" (DELETE fallback)
-- - "Authenticated users can upload whatsapp media" (INSERT for whatsapp-media)
-- - "Service role can manage whatsapp media" (ALL for service role)