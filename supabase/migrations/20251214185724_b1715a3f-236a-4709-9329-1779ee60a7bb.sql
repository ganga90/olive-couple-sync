-- Make whatsapp-media bucket public so images can be accessed by Gemini Vision API
UPDATE storage.buckets 
SET public = true 
WHERE id = 'whatsapp-media';

-- Also make note-media bucket public for consistency
UPDATE storage.buckets 
SET public = true 
WHERE id = 'note-media';