-- Ensure the trigger for adding creator as member exists and is working
-- First check if the trigger exists and recreate it if needed

-- Drop and recreate the trigger to ensure it's working
DROP TRIGGER IF EXISTS add_clerk_creator_as_member_trigger ON clerk_couples;

CREATE TRIGGER add_clerk_creator_as_member_trigger
    AFTER INSERT ON clerk_couples
    FOR EACH ROW
    EXECUTE FUNCTION add_clerk_creator_as_member();