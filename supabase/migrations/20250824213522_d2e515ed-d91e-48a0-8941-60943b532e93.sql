-- Debug the JWT token structure to see what claims are available
SELECT 
  auth.jwt() as full_jwt,
  auth.jwt() ->> 'sub' as sub_claim,
  auth.jwt() ->> 'user_id' as user_id_claim,
  auth.jwt() ->> 'aud' as audience,
  auth.jwt() ->> 'iss' as issuer,
  current_setting('request.jwt.claims', true) as jwt_claims_setting;