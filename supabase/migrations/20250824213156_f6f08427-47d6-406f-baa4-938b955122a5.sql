-- Ensure trigger exists for automatically adding creator as member
DROP TRIGGER IF EXISTS on_clerk_couple_created ON clerk_couples;

CREATE TRIGGER on_clerk_couple_created
  AFTER INSERT ON clerk_couples
  FOR EACH ROW EXECUTE FUNCTION add_clerk_creator_as_member();

-- Test the get_clerk_user_id function
SELECT get_clerk_user_id() as current_user_from_jwt;