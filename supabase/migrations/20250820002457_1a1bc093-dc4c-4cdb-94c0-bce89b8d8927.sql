-- Fix invites table invited_by column type
ALTER TABLE invites ALTER COLUMN invited_by TYPE text;