const BACKEND_URL = 'https://railway.app';

export async function startCloudBot() {
  try {
    // 1. Get active user's Deriv loginid and OAuth token from localStorage
    const loginid = localStorage.getItem('active_loginid');
    const accountsRaw = localStorage.getItem('client.accounts');
    const accounts = accountsRaw ? JSON.parse(accountsRaw) : {};
    const token = loginid ? accounts[loginid]?.token : null;

    if (!loginid || !token) {
      alert('Please log in to your Deriv account first.');
      return;
    }

    // 2. Compile the exact Blockly workspace blocks into JavaScript
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

    // 3. Send to Railway backend to execute 24/7
    const response = await fetch(`${BACKEND_URL}/api/bot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid, token, code: compiledCode }),
    });

    const data = await response.json();
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
    const loginid = localStorage.getItem('active_loginid');
    if (!loginid) {
      alert('No active Deriv account found.');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid }),
    });

    const data = await response.json();
    alert(data.status || 'Cloud bot stopped.');
  } catch (err: any) {
    alert(`Connection error: ${err.message}`);
  }
}
