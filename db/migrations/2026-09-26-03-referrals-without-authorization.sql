-- A referral can now be approved from the Fax Inbox before the payer has
-- authorized anything (e.g. a hospital discharge referral): the
-- authorization number and authorized hours may be empty until the
-- authorization arrives. Existing rows keep their values; nothing is
-- rewritten. Intake still requires authorized hours (clients.auth_hours).
-- Rollback (only while no referral has them empty):
--   ALTER TABLE referrals ALTER COLUMN auth_number SET NOT NULL;
--   ALTER TABLE referrals ALTER COLUMN auth_hours SET NOT NULL;
ALTER TABLE referrals ALTER COLUMN auth_number DROP NOT NULL;
ALTER TABLE referrals ALTER COLUMN auth_hours DROP NOT NULL;
