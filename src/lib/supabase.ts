import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey);

export type TradeJournalRow = {
  id?: string;
  session_id: string;
  symbol: string;
  contract_type: string;
  strategy_label: string;
  prediction: number | null;
  stake: number;
  payout: number;
  won: boolean;
  entry_spot: string | null;
  exit_spot: string | null;
  recovery_mode: boolean;
  recovery_step: number;
  balance_after: number | null;
  created_at?: string;
};
