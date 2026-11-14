import { api_base, DBot } from '@/external/bot-skeleton';
import { javascriptGenerator } from 'blockly/javascript';

const BACKEND_URL = 'https://railway.app';

function getActiveDerivSession(): { loginid: string | null; token: string | null } {
  const activeLoginId =
    (api_base as any)?.account_info?.loginid ||
    localStorage.getItem('active_loginid') ||
    sessionStorage.getItem('active_loginid');

  const directToken = (api_base as any)?.token;
  if (activeLoginId && directToken) {
    return { loginid: activeLoginId, token: directToken };
  }

  for (const storage of [localStorage, sessionStorage]) {
    try {
      const accountsRaw = storage.getItem('client.accounts');
      if (accountsRaw) {
        const accounts = JSON.parse(accountsRaw);
        const id = activeLoginId || Object.keys(accounts);
        if (id && accounts[id]?.token) {
          return { loginid: id, token: accounts[id].token };
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

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

function compileActiveWorkspaceCode(): string {
  const Blockly = (window as any).Blockly;
  const workspace = Blockly?.derivWorkspace || Blockly?.getMainWorkspace?.();

  if (!workspace) {
    throw new Error('Please tap the "Bot Builder" tab first so your strategy workspace loads.');
  }

  // 1. Try Deriv's native DBot code generator first
  if (typeof (DBot as any)?.generateCode === 'function') {
    const code = (DBot as any).generateCode();
    if (code && code.trim()) return code;
  }

  // 2. Try Blockly v10+ javascriptGenerator
  if (typeof javascriptGenerator?.workspaceToCode === 'function') {
    const code = javascriptGenerator.workspaceToCode(workspace);
    if (code && code.trim()) return code;
  }

  // 3. Fallback to legacy Blockly.JavaScript if attached on window
  if (typeof Blockly?.JavaScript?.workspaceToCode === 'function') {
    const code = Blockly.JavaScript.workspaceToCode(workspace);
    if (code && code.trim()) return code;
  }

  throw new Error('Could not compile blocks. Make sure you have a strategy loaded in Bot Builder.');
}

export async function startCloudBot() {
  try {
    const { loginid, token } = getActiveDerivSession();

    if (!loginid || !token) {
      alert('Could not detect active Deriv session token. Please refresh the page or re-login.');
      return;
    }

    const compiledCode = compileActiveWorkspaceCode();

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
    alert(`Error: ${err.message}`);
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
