require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
app.use(cors({ origin: 'https://netlify.app' }));
app.use(express.json());

let ws = null;
let isRunning = false;
let pingInterval = null;

const DERIV_WS_URL = `wss://://derivws.com{process.env.DERIV_APP_ID}`;
const API_TOKEN = process.env.DERIV_API_TOKEN;

function startBot(strategyConfig) {
  if (isRunning) return;
  isRunning = true;

  ws = new WebSocket(DERIV_WS_URL);

  ws.on('open', () => {
    console.log('Connected to Deriv WebSocket');
    ws.send(JSON.stringify({ authorize: API_TOKEN }));

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    const response = JSON.parse(data);

    if (response.msg_type === 'authorize') {
      console.log('Authorized account:', response.authorize.loginid);
      ws.send(JSON.stringify({ ticks: strategyConfig.symbol || 'R_100', subscribe: 1 }));
    }

    if (response.msg_type === 'tick' && isRunning) {
      // YOUR TRADING LOGIC GOES HERE
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (isRunning) {
      console.log('Connection lost. Reconnecting in 5s...');
      setTimeout(() => startBot(strategyConfig), 5000);
    }
  });
}

function stopBot() {
  isRunning = false;
  clearInterval(pingInterval);
  if (ws) ws.close();
}

app.post('/api/start', (req, res) => {
  startBot(req.body);
  res.json({ status: 'Bot started on Railway' });
});

app.post('/api/stop', (req, res) => {
  stopBot();
  res.json({ status: 'Bot stopped' });
});

app.get('/api/status', (req, res) => {
  res.json({ running: isRunning });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
