-- Debug JWT claims to understand Clerk token structure
SELECT debug_clerk_jwt() as jwt_raw;
SELECT debug_clerk_user_id_fixed() as extracted_user_id;