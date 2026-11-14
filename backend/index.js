require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const vm = require('vm');

const app = express();
app.use(cors({ origin: 'https://netlify.app' }));
app.use(express.json({ limit: '2mb' }));

// Stores active bots mapped by user loginid (e.g., 'CR123456' or 'VRTC123456')
const activeSessions = new Map();

const DERIV_WS_URL = `wss://://derivws.com{process.env.DERIV_APP_ID}`;

class UserBotRunner {
  constructor(loginid, token, compiledCode) {
    this.loginid = loginid;
    this.token = token;
    this.compiledCode = compiledCode;
    this.ws = null;
    this.isRunning = false;
    this.pingInterval = null;
    this.lastTick = null;
    this.tickHistory = [];
    this.lastContractResult = null;
    this.logs = [];
  }

  log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    console.log(`[${this.loginid}] ${msg}`);
    this.logs.push(entry);
    if (this.logs.length > 50) this.logs.shift();
  }

  sendWS(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.ws = new WebSocket(DERIV_WS_URL);

    this.ws.on('open', () => {
      this.log('Connected to Deriv WebSocket');
      this.sendWS({ authorize: this.token });

      this.pingInterval = setInterval(() => {
        this.sendWS({ ping: 1 });
      }, 30000);
    });

    this.ws.on('message', (raw) => {
      const data = JSON.parse(raw);

      if (data.error) {
        this.log(`API Error: ${data.error.message}`);
        return;
      }

      if (data.msg_type === 'authorize') {
        this.log(`Authorized ${data.authorize.loginid} (Balance: ${data.authorize.balance})`);
        this.executeUserBlocklyCode();
      }

      if (data.msg_type === 'tick') {
        this.lastTick = data.tick;
        this.tickHistory.push(data.tick.quote);
        if (this.tickHistory.length > 100) this.tickHistory.shift();
        if (this.onTickCallback) this.onTickCallback(data.tick);
      }

      if (data.msg_type === 'proposal') {
        this.sendWS({
          buy: data.proposal.id,
          price: data.proposal.ask_price,
        });
      }

      if (data.msg_type === 'buy') {
        this.log(`Contract purchased: ${data.buy.contract_id}`);
        this.sendWS({
          proposal_open_contract: 1,
          contract_id: data.buy.contract_id,
          subscribe: 1,
        });
      }

      if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract.is_sold) {
        this.lastContractResult = data.proposal_open_contract;
        const profit = Number(this.lastContractResult.profit);
        this.log(`Contract closed | Result: ${profit >= 0 ? 'WIN' : 'LOSS'} ($${profit})`);
        if (this.onContractClosedCallback) {
          this.onContractClosedCallback(this.lastContractResult);
        }
      }
    });

    this.ws.on('close', () => {
      clearInterval(this.pingInterval);
      if (this.isRunning) {
        this.log('Connection dropped. Reconnecting in 5s...');
        setTimeout(() => this.start(), 5000);
      }
    });
  }

  executeUserBlocklyCode() {
    // Bridge Deriv Bot Blockly runtime functions into Node.js sandbox
    const sandbox = {
      console: { log: (m) => this.log(String(m)) },
      setTimeout,
      clearTimeout,
      Math,
      Number,
      String,
      Array,
      JSON,
      Bot: {
        init: (account, options) => {
          this.tradeOptions = options;
          this.sendWS({ ticks: options.symbol, subscribe: 1 });
        },
        start: (tradeOptions) => {
          this.tradeOptions = tradeOptions;
          this.sendWS({ ticks: tradeOptions.symbol, subscribe: 1 });
        },
        purchase: (contractType) => {
          if (!this.isRunning || !this.tradeOptions) return;
          this.sendWS({
            proposal: 1,
            amount: Number(this.tradeOptions.amount),
            basis: this.tradeOptions.basis || 'stake',
            contract_type: contractType,
            currency: this.tradeOptions.currency || 'USD',
            duration: Number(this.tradeOptions.duration),
            duration_unit: this.tradeOptions.duration_unit,
            symbol: this.tradeOptions.symbol,
            ...(this.tradeOptions.barrier !== undefined && {
              barrier: String(this.tradeOptions.barrier),
            }),
          });
        },
        getLastTick: () => (this.lastTick ? this.lastTick.quote : 0),
        getLastDigit: () =>
          this.lastTick ? Number(String(this.lastTick.quote).slice(-1)) : 0,
        getTicks: () => this.tickHistory,
        isResultWin: () =>
          this.lastContractResult ? Number(this.lastContractResult.profit) > 0 : false,
        readDetails: (index) => {
          if (!this.lastContractResult) return 0;
          const map = {
            4: Number(this.lastContractResult.profit),
            10: this.lastContractResult.status,
          };
          return map[index] ?? 0;
        },
        watch: (stage, callback) => {
          if (stage === 'before') this.onTickCallback = callback;
          if (stage === 'after') this.onContractClosedCallback = callback;
        },
      },
    };

    try {
      vm.createContext(sandbox);
      vm.runInContext(this.compiledCode, sandbox, { timeout: 5000 });
      this.log('User Blockly strategy loaded and running.');
    } catch (err) {
      this.log(`Strategy execution error: ${err.message}`);
    }
  }

  stop() {
    this.isRunning = false;
    clearInterval(this.pingInterval);
    if (this.ws) this.ws.close();
    this.log('Bot stopped by user.');
  }
}

// Start a specific user's Blockly bot
app.post('/api/bot/start', (req, res) => {
  const { loginid, token, code } = req.body;

  if (!loginid || !token || !code) {
    return res.status(400).json({ error: 'Missing loginid, token, or compiled Blockly code.' });
  }

  // Stop existing session for this user if already running
  if (activeSessions.has(loginid)) {
    activeSessions.get(loginid).stop();
  }

  const runner = new UserBotRunner(loginid, token, code);
  activeSessions.set(loginid, runner);
  runner.start();

  res.json({ status: 'Cloud bot started', loginid });
});

// Stop a specific user's bot
app.post('/api/bot/stop', (req, res) => {
  const { loginid } = req.body;
  const runner = activeSessions.get(loginid);

  if (runner) {
    runner.stop();
    activeSessions.delete(loginid);
  }

  res.json({ status: 'Cloud bot stopped', loginid });
});

// Check status & live logs for a specific user
app.get('/api/bot/status/:loginid', (req, res) => {
  const runner = activeSessions.get(req.params.loginid);
  if (!runner) {
    return res.json({ running: false, logs: [] });
  }
  res.json({ running: runner.isRunning, logs: runner.logs });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Multi-user Deriv Bot Server listening on port ${PORT}`));
