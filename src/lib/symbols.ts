export const SYMBOLS = [
  // Volatility Indices
  { id: 'R_10', label: 'Volatility 10', short: 'V10', category: 'Volatility' },
  { id: '1HZ10V', label: 'Volatility 10 (1s)', short: 'V10s', category: 'Volatility' },
  { id: 'R_25', label: 'Volatility 25', short: 'V25', category: 'Volatility' },
  { id: '1HZ25V', label: 'Volatility 25 (1s)', short: 'V25s', category: 'Volatility' },
  { id: 'R_50', label: 'Volatility 50', short: 'V50', category: 'Volatility' },
  { id: '1HZ50V', label: 'Volatility 50 (1s)', short: 'V50s', category: 'Volatility' },
  { id: 'R_75', label: 'Volatility 75', short: 'V75', category: 'Volatility' },
  { id: '1HZ75V', label: 'Volatility 75 (1s)', short: 'V75s', category: 'Volatility' },
  { id: 'R_100', label: 'Volatility 100', short: 'V100', category: 'Volatility' },
  { id: '1HZ100V', label: 'Volatility 100 (1s)', short: 'V100s', category: 'Volatility' },
  // Crash/Boom
  { id: 'BOOM1000', label: 'Boom 1000', short: 'B1000', category: 'Crash/Boom' },
  { id: 'BOOM500', label: 'Boom 500', short: 'B500', category: 'Crash/Boom' },
  { id: 'BOOM300', label: 'Boom 300', short: 'B300', category: 'Crash/Boom' },
  { id: 'CRASH1000', label: 'Crash 1000', short: 'C1000', category: 'Crash/Boom' },
  { id: 'CRASH500', label: 'Crash 500', short: 'C500', category: 'Crash/Boom' },
  { id: 'CRASH300', label: 'Crash 300', short: 'C300', category: 'Crash/Boom' },
  // Jump Indices
  { id: 'JD10', label: 'Jump 10', short: 'J10', category: 'Jump' },
  { id: 'JD25', label: 'Jump 25', short: 'J25', category: 'Jump' },
  { id: 'JD50', label: 'Jump 50', short: 'J50', category: 'Jump' },
  { id: 'JD75', label: 'Jump 75', short: 'J75', category: 'Jump' },
  { id: 'JD100', label: 'Jump 100', short: 'J100', category: 'Jump' },
  // Bear/Bull
  { id: 'RDBEAR', label: 'Bear Market', short: 'BEAR', category: 'Bear/Bull' },
  { id: 'RDBULL', label: 'Bull Market', short: 'BULL', category: 'Bear/Bull' },
  // Range Break
  { id: 'STKR', label: 'Range 100', short: 'R100', category: 'Range' },
  { id: 'STKR200', label: 'Range 200', short: 'R200', category: 'Range' },
  // Step Indices
  { id: 'WLDSTP', label: 'Step', short: 'STEP', category: 'Step' },
] as const;

export type SymbolId = (typeof SYMBOLS)[number]['id'];
