# AutoAI Bot — Iframe Integration Guide

## Overview

The AutoAI Bot scanner is designed to be embedded as an `<iframe>` inside any host website. It communicates with the parent page via the `postMessage` API, allowing the host site to:

- Pass a Deriv API token securely
- Load bot configurations (XML or JSON)
- Start and stop automated trading
- Poll real-time status (profit, loss count, balance, errors)

This document covers everything a developer needs to integrate the iframe seamlessly.

---

## 1. Embedding the Iframe

```html
<iframe
  id="autoai-bot"
  src="https://your-deployed-url.app/"
  style="width: 100%; height: 600px; border: none;"
  allow="clipboard-write"
></iframe>
```

### URL Parameters

| Parameter | Type   | Description                          |
| --------- | ------ | ------------------------------------ |
| `token`   | string | Deriv API token (trade scope only)   |

Example:

```
https://your-deployed-url.app/?token=YOUR_DERIV_API_TOKEN
```

When a `token` URL parameter is present, the iframe automatically sets it on load — no `postMessage` needed.

---

## 2. PostMessage API

All communication uses `window.postMessage`. The iframe listens for **inbound** messages from the parent and sends **outbound** messages back.

### 2.1 Inbound Messages (Parent → Iframe)

#### Set Token

Pass a Deriv API token to the iframe. Use a token with **trade scope only** — never include withdrawal scope.

```js
iframe.contentWindow.postMessage({
  type: 'setToken',
  token: 'YOUR_DERIV_API_TOKEN'
}, '*');
```

#### Load Bot

Load a bot configuration. Can pass either a raw XML string (Deriv bot format) or a partial config object, or both.

```js
// From XML string
iframe.contentWindow.postMessage({
  type: 'loadBot',
  xml: '<xml>...</xml>'
}, '*');

// From config object
iframe.contentWindow.postMessage({
  type: 'loadBot',
  config: {
    stake: 1,
    martingale: 2,
    takeProfit: 10,
    stopLoss: 5,
    symbol: 'R_100',
    contractType: 'DIGITOVER',
    prediction: 5,
    strategyLabel: 'Over 5',
    fallbackChain: [
      { contractType: 'DIGITEVEN', strategyLabel: 'Even' },
      { contractType: 'CALL', strategyLabel: 'Rise' }
    ],
    lossThreshold: 2
  }
}, '*');

// Both XML + config overrides
iframe.contentWindow.postMessage({
  type: 'loadBot',
  xml: '<xml>...</xml>',
  config: { stake: 2, takeProfit: 20 }
}, '*');
```

**BotConfig fields:**

| Field            | Type     | Required | Description                              |
| ---------------- | -------- | -------- | ---------------------------------------- |
| `stake`          | number   | No       | Initial stake amount (default: 1)        |
| `martingale`     | number   | No       | Martingale multiplier (default: 2)       |
| `takeProfit`     | number   | No       | Take profit target (default: 10)         |
| `stopLoss`       | number   | No       | Stop loss in consecutive losses (default: 5) |
| `symbol`         | string   | No       | Deriv symbol ID (e.g. `R_100`)           |
| `contractType`   | string   | No       | Deriv contract type (e.g. `DIGITOVER`)   |
| `prediction`     | number   | No       | Target digit for digit contracts         |
| `strategyLabel`  | string   | No       | Human-readable strategy name             |
| `fallbackChain`  | array    | No       | Fallback strategies for recovery mode     |
| `lossThreshold`  | number   | No       | Losses before switching to fallback      |

#### Run Bot

Start automated trading with the currently loaded configuration.

```js
iframe.contentWindow.postMessage({ type: 'runBot' }, '*');
```

> **Note:** A token must be set before running. If no token is set, the Run button is disabled and `runBot` will be ignored.

#### Stop Bot

Stop the currently running bot.

```js
iframe.contentWindow.postMessage({ type: 'stopBot' }, '*');
```

#### Get Status

Request the current status snapshot from the iframe.

```js
iframe.contentWindow.postMessage({ type: 'getStatus' }, '*');
```

The iframe responds with an outbound `status` message (see below).

### 2.2 Outbound Messages (Iframe → Parent)

Listen for these messages in the parent page:

```js
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'status':       // Full status snapshot
    case 'loaded':        // Bot config loaded
    case 'started':       // Bot started running
    case 'stopped':       // Bot stopped
    case 'error':         // Error occurred
    case 'tradeComplete': // A trade settled
      console.log(msg);
      break;
  }
});
```

**Status payload:**

```typescript
type IframeStatus = {
  status: string;        // 'idle' | 'authorizing' | 'proposing' | 'buying' | 'monitoring' | 'settled' | 'stopped'
  totalProfit: number;   // Cumulative profit/loss
  lossCount: number;      // Current consecutive loss count
  tradeCount: number;     // Total trades in this session
  balance: number | null; // Account balance
  currency: string | null;// Account currency
  error: string | null;   // Last error message
  loadedBot: string | null;// Name of loaded bot
};
```

**Trade complete payload:**

```typescript
type TradeComplete = {
  type: 'tradeComplete';
  result: { won: boolean; profit: number };
};
```

---

## 3. Complete Integration Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Trading Site</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #0a0a0f; color: #fff; }
    .toolbar { padding: 12px; display: flex; gap: 8px; }
    .toolbar button {
      padding: 8px 16px; border-radius: 8px; border: none;
      font-weight: 700; cursor: pointer; font-size: 12px;
    }
    .btn-load { background: #059669; color: #fff; }
    .btn-run  { background: #D61A8C; color: #fff; }
    .btn-stop { background: #ef4444; color: #fff; }
    #status { padding: 8px 12px; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn-load" onclick="loadBot()">Load Bot</button>
    <button class="btn-run"  onclick="runBot()">Run</button>
    <button class="btn-stop" onclick="stopBot()">Stop</button>
  </div>
  <div id="status">Idle</div>

  <iframe
    id="bot"
    src="https://your-deployed-url.app/?token=YOUR_TOKEN"
    style="width: 100%; height: 580px; border: none;"
  ></iframe>

  <script>
    const iframe = document.getElementById('bot');

    // Listen for messages from iframe
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg?.type) return;

      if (msg.type === 'status') {
        const s = msg.status;
        document.getElementById('status').textContent =
          `${s.status} | Profit: $${s.totalProfit.toFixed(2)} | Trades: ${s.tradeCount} | Balance: ${s.balance ?? '—'}`;
      }
      if (msg.type === 'started')  console.log('Bot started');
      if (msg.type === 'stopped')  console.log('Bot stopped');
      if (msg.type === 'error')    console.error('Bot error:', msg.message);
      if (msg.type === 'tradeComplete') {
        console.log(`Trade ${msg.result.won ? 'WON' : 'LOST'}: ${msg.result.profit}`);
      }
    });

    function loadBot() {
      iframe.contentWindow.postMessage({
        type: 'loadBot',
        config: {
          stake: 1,
          martingale: 2,
          takeProfit: 10,
          stopLoss: 5,
          symbol: 'R_100',
          contractType: 'DIGITOVER',
          prediction: 5,
          strategyLabel: 'Over 5'
        }
      }, '*');
    }

    function runBot()  { iframe.contentWindow.postMessage({ type: 'runBot'  }, '*'); }
    function stopBot() { iframe.contentWindow.postMessage({ type: 'stopBot' }, '*'); }

    // Poll status every 2 seconds
    setInterval(() => {
      iframe.contentWindow.postMessage({ type: 'getStatus' }, '*');
    }, 2000);
  </script>
</body>
</html>
```

---

## 4. In-Iframe UI Controls

The iframe has its own UI controls that work independently of the postMessage API:

### Load Button

- Opens a file picker to select a `.xml` bot file
- Parses the XML and extracts symbol, contract type, stake, martingale, take profit, stop loss
- Updates the scanner UI with the parsed values
- Shows a green indicator with the loaded bot name

### Run Button

- Starts automated trading using the current scanner configuration
- Requires a token to be set (via URL param or postMessage)
- While running, the Run button changes to a red **Stop** button
- The bot cycles through trades automatically, applying martingale and the fallback recovery chain

### Tab Bar

Three compact icon-based tabs:

| Tab      | Icon       | Purpose                                    |
| -------- | ---------- | ------------------------------------------ |
| Scan     | Radar      | Signal scanner with market analysis        |
| Monitor  | LineChart  | Multi-market live monitor                  |
| Journal  | BookOpen   | Trade history with stats (Supabase-backed) |

---

## 5. Fallback Recovery Chain

When enabled in the scanner's recovery panel, the bot automatically switches trade types after consecutive losses:

1. **Primary strategy** — the initially selected trade type
2. **Fallback 1** — switches after N losses (configurable threshold)
3. **Fallback 2** — switches after another N losses
4. **Fallback 3** — switches after another N losses

When any trade wins, the bot resets to the primary strategy.

All trades — including recovery trades — are logged to the Supabase `trade_journals` table with the `recovery_mode` flag and `recovery_step` number.

---

## 6. Trade Journal (Supabase)

Every trade executed by the bot is persisted to the `trade_journals` table:

| Column           | Type      | Description                           |
| ---------------- | --------- | ------------------------------------- |
| `id`             | uuid      | Primary key                           |
| `session_id`     | text      | Unique session identifier             |
| `symbol`         | text      | Deriv symbol traded                   |
| `contract_type`  | text      | Contract type (e.g. `DIGITOVER`)      |
| `strategy_label` | text      | Human-readable strategy name          |
| `prediction`     | int4     | Target digit (nullable)               |
| `stake`          | float8    | Stake amount                          |
| `payout`         | float8    | Profit/loss for this trade            |
| `won`            | bool      | Whether the trade won                 |
| `entry_spot`     | text      | Entry spot value                      |
| `exit_spot`      | text      | Exit spot value                       |
| `recovery_mode`  | bool      | Whether this was a recovery trade     |
| `recovery_step`  | int4     | Which fallback step (0 = primary)     |
| `balance_after`  | float8    | Account balance after trade           |
| `created_at`     | timestamp | Auto-set on insert                    |

The Journal tab displays this data with summary stats (win rate, total profit, streaks) and filtering by wins, losses, or recovery trades.

---

## 7. Security Notes

- **API tokens** are stored in memory only and never persisted to disk or sent to any third-party server
- Use Deriv API tokens with **trade scope only** — never include withdrawal scope
- The iframe communicates via `postMessage('*')` — for production, replace `'*'` with your exact origin for security
- All trade execution happens directly between the user's browser and Deriv's WebSocket API — no intermediary server processes trades

---

## 8. Deriv Contract Types Reference

| Contract Type   | Description              |
| --------------- | ------------------------ |
| `CALL`          | Rise (price up)          |
| `PUT`           | Fall (price down)        |
| `DIGITOVER`     | Last digit over N        |
| `DIGITUNDER`    | Last digit under N       |
| `DIGITEVEN`     | Last digit even          |
| `DIGITODD`      | Last digit odd            |
| `DIGITMATCH`    | Last digit matches N     |
| `DIGITDIFF`     | Last digit differs from N|
| `DIGITOVER`     | Last digit over N        |

---

## 9. Troubleshooting

| Issue                    | Solution                                              |
| ------------------------ | ----------------------------------------------------- |
| Run button disabled      | No token set — pass via URL param or `setToken` msg  |
| No trades in journal     | Bot hasn't run yet — trades appear after execution    |
| "Authorization failed"  | Token is invalid or lacks trade scope                 |
| "Buy failed"             | Insufficient balance or market closed                 |
| Iframe not responding   | Ensure iframe is loaded before sending messages       |
| XML load fails          | Ensure file is valid Deriv bot XML format             |
