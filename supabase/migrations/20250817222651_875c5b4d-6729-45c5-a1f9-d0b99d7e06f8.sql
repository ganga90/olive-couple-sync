-- Create edge function to send invite emails
CREATE OR REPLACE FUNCTION public.send_invite_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  invite_url text;
BEGIN
  -- Only process new invites with pending status
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    -- Construct invite URL
    invite_url := 'https://lovable.dev/projects/olive-couple-shared-brain/accept-invite?token=' || NEW.token;
    
    -- Here we would normally call an edge function to send the email
    -- For now, we'll just log the invite URL
    RAISE NOTICE 'Invite URL for %: %', NEW.invited_email, invite_url;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for sending invite emails
DROP TRIGGER IF EXISTS send_invite_email_trigger ON public.invites;
CREATE TRIGGER send_invite_email_trigger
  AFTER INSERT OR UPDATE ON public.invites
  FOR EACH ROW
  EXECUTE FUNCTION public.send_invite_email();