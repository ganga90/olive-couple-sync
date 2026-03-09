export type SpaceMember = {
  member_id: string;
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  profile_display_name: string | null;
  joined_at: string;
};
