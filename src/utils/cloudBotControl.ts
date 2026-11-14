import { api_base } from '@/external/bot-skeleton';

const BACKEND_URL = 'https://railway.app';

function getActiveDerivSession(): { loginid: string | null; token: string | null } {
  // 1. Check Deriv's active WebSocket API instance directly (most reliable)
  const activeLoginId =
    (api_base as any)?.account_info?.loginid ||
    localStorage.getItem('active_loginid') ||
    sessionStorage.getItem('active_loginid');

  const directToken = (api_base as any)?.token;
  if (activeLoginId && directToken) {
    return { loginid: activeLoginId, token: directToken };
  }

  // 2. Check client.accounts in localStorage and sessionStorage
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const accountsRaw = storage.getItem('client.accounts');
      if (accountsRaw) {
        const accounts = JSON.parse(accountsRaw);
        const id = activeLoginId || Object.keys(accounts)[0];
        if (id && accounts[id]?.token) {
          return { loginid: id, token: accounts[id].token };
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 3. Fallback: scan storage keys for Deriv OAuth tokens (e.g., auth_info / access_token)
  for (const storage of [localStorage, sessionStorage]) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      const val = storage.getItem(key) || '';
      if (val.includes('access_token') || val.includes('a1-')) {
        try {
          const parsed = JSON.parse(val);
          const token = parsed?.access_token || parsed?.token;
          if (token) {
            return { loginid: activeLoginId || 'DERIV_USER', token };
          }
        } catch {
          if (val.startsWith('a1-')) {
            return { loginid: activeLoginId || 'DERIV_USER', token: val };
          }
        }
      }
    }
  }

  return { loginid: activeLoginId, token: null };
}

export async function startCloudBot() {
  try {
    const { loginid, token } = getActiveDerivSession();

    if (!loginid || !token) {
      alert('Could not detect active Deriv session token. Please refresh the page or re-login.');
      return;
    }

    // Compile the exact Blockly workspace blocks into JavaScript
    const Blockly = (window as any).Blockly;
    const workspace = Blockly?.derivWorkspace || Blockly?.getMainWorkspace?.();

    if (!workspace) {
      alert('Please open the Bot Builder tab first so your strategy loads.');
      return;
    }

    const compiledCode = Blockly.JavaScript.workspaceToCode(workspace);

    if (!compiledCode || compiledCode.trim() === '') {
      alert('Your workspace is empty. Load or build a strategy first.');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/bot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid, token, code: compiledCode }),
    });

    const data = await resJson(response);
    if (response.ok) {
      alert(`Success: ${data.status} for account ${loginid}. You can now close your browser.`);
    } else {
      alert(`Error: ${data.error || 'Failed to start cloud bot'}`);
    }
  } catch (err: any) {
    alert(`Connection error: ${err.message}`);
  }
}

export async function stopCloudBot() {
  try {
    const { loginid } = getActiveDerivSession();
    if (!loginid) {
      alert('No active Deriv account found.');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid }),
    });

    const data = await resJson(response);
    alert(data.status || 'Cloud bot stopped.');
  } catch (err: any) {
    alert(`Connection error: ${err.message}`);
  }
}

async function resJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `HTTP ${response.status}` };
  }
}
