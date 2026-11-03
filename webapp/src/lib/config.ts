// The Voice Notes Supabase project (Tokyo). Both values are public by design: the publishable key
// only reaches what row-level security allows, and every note goes through the sync function.
export const SUPABASE_URL = "https://tpadlhyraittxehfvshc.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-A-HowQg4wveAcixZbOklg_M1v36Xa9";
export const SYNC_URL = `${SUPABASE_URL}/functions/v1/sync`;
