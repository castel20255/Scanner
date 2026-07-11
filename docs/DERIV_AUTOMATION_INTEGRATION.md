# Deriv Automation Integration — Scanner to Live Trading

Reference: https://developers.deriv.com/docs/automation/

## Current State

The scanner connects to Deriv's WebSocket (`wss://ws.derivws.com/websockets/v3?app_id=<app_id>`) via `src/hooks/useDerivWS.ts` for **read-only** tick streaming. No authorization, no trading.

When the user clicks **Load Bot**, `handleLoadBot` in `src/components/Scanner.tsx` generates a Blockly XML file (via `generateBotXML`) and downloads it. The user must manually import this XML into Deriv Bot to run the strategy.

## Goal

Enable **in-app automated trading**: one click from a detected signal to live trade execution, with martingale, take-profit, stop-loss, and recovery mode handled in JavaScript — no XML export or manual import.

## Deriv API Trading Flow

All communication happens over the same WebSocket already used for ticks. The sequence:

### 1. Authorize

```json
{ "authorize": "<user_api_token>" }
```

Response includes `balance`, `currency`, `loginid`. The token is a standard Deriv API token (user creates it in their Deriv account settings). Store it in memory only — do NOT persist to localStorage or any database.

### 2. Proposal (price quote)

```json
{
  "proposal": 1,
  "amount": 10,
  "basis": "stake",
  "contract_type": "DIGITOVER",
  "currency": "USD",
  "duration": 1,
  "duration_unit": "t",
  "symbol": "R_100",
  "prediction": 2
}
```

Response: `{ proposal: { id: "<uuid>", ask_price: 10.0, spot: "..." } }`

Contract types map to the scanner's signal types:

| Signal Direction | contract_type   | prediction field |
|-----------------|-----------------|-----------------|
| OVER X          | DIGITOVER       | X               |
| UNDER X         | DIGITUNDER      | X               |
| EVEN            | DIGITEVEN       | —               |
| ODD             | DIGITODD        | —               |
| MATCHES X       | DIGITMATCH      | X               |
| DIFFERS X       | DIGITDIFF       | X               |
| RISE            | CALL            | —               |
| FALL            | PUT             | —               |

### 3. Buy

```json
{ "buy": "<proposal_id>", "price": <ask_price> }
```

Response: `{ buy: { contract_id, longcode, balance_after, ... } }`

### 4. Monitor (subscribe to contract status)

```json
{ "proposal_open_contract": 1, "contract_id": "<contract_id>", "subscribe": 1 }
```

Streamed updates include `{ is_sold, status, profit, entry_spot, exit_spot }`. When `is_sold === 1`, the trade is settled — check `profit` for win/loss.

### 5. Loop logic (replaces XML bot blocks)

After each settled contract:

```
if total_profit >= take_profit → STOP (TP hit)
else if loss_count >= stop_loss → STOP (SL hit)
else if win → reset stake to initial, reset loss_count to 0, trade again
else if loss → stake *= martingale, loss_count += 1, trade again
```

Recovery mode: if `loss_count >= rec_loss_threshold`, switch `contract_type` to `recAltType` and continue.

## Implementation Plan

### New files

- `src/hooks/useDerivTrade.ts` — Trading hook wrapping authorize/proposal/buy/monitor over the existing WebSocket connection.
- `src/components/ApiTokenModal.tsx` — Modal for entering Deriv API token. Token stored in memory only (React state / ref). Never persisted.

### Changes to existing files

- `src/hooks/useDerivWS.ts` — Expose a `send` method and message handler registry so the trade hook can send `authorize`, `proposal`, `buy`, and subscribe to `proposal_open_contract` on the same socket.
- `src/components/Scanner.tsx` — Replace `handleLoadBot` with `handleAutoTrade`:
  - If no token → open `ApiTokenModal`
  - If token → call `useDerivTrade.startTrade(signal)` which runs the full authorize → proposal → buy → monitor → loop cycle
  - Add live trade status panel (current contract, P&L, win/loss streak, martingale step)

### useDerivTrade hook shape

```typescript
interface TradeConfig {
  stake: number;
  martingale: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
  contractType: string;
  prediction?: number;
  recovery?: {
    lossThreshold: number;
    altContractType: string;
  };
}

interface TradeState {
  status: 'idle' | 'authorizing' | 'proposing' | 'buying' | 'monitoring' | 'settled' | 'stopped';
  contractId: string | null;
  currentStake: number;
  totalProfit: number;
  lossCount: number;
  tradeHistory: TradeResult[];
  error: string | null;
}

interface TradeResult {
  contractId: string;
  profit: number;
  won: boolean;
  entrySpot: string;
  exitSpot: string;
  timestamp: number;
}
```

### Security considerations

- API token is a **trading-scoped credential**. Store in memory only. Clear on page unload.
- Recommend users create a token with **trade scope only** (no withdrawal scope).
- All WebSocket communication stays client-side — no token touches any server or database.
- Consider adding a confirmation dialog before the first real-money trade.

### UI additions

- **API Token button** in scanner header (lock icon) → opens token modal
- **Live Trade Panel** (replaces or sits beside the signal list when trading is active):
  - Current status badge (Authorizing / Buying / Monitoring / Settled)
  - Running P&L vs Take Profit target
  - Loss streak vs Stop Loss limit
  - Martingale step indicator
  - Pause / Stop buttons
  - Trade history log (last 10 trades)

## Migration path from current XML export

The existing `generateBotXML` function and "Load Bot" / "Load & Run" buttons should remain as a fallback. The new auto-trade flow is additive:

1. User scans → signals appear
2. User selects a signal
3. User clicks **Auto Trade** (new button, alongside existing Load Bot)
4. If no API token → prompt for token
5. Trading loop starts, live panel replaces signal list
6. User can stop at any time

The XML export stays useful for users who prefer Deriv Bot's visual editor or want to run trades on a separate device.
