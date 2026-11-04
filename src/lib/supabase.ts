import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Null until both settings exist, so a fresh deployment shows setup steps instead of crashing.
export const supabase = url && key ? createClient(url, key) : null;
