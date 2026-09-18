import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('請先設定GOOGLE_CLIENT_ID與GOOGLE_CLIENT_SECRET環境變數。');
  process.exit(1);
}

const port = Number(process.env.GOOGLE_OAUTH_LOCAL_PORT) || 53682;
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const state = crypto.randomBytes(18).toString('base64url');
const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive',
  access_type: 'offline',
  prompt: 'consent',
  state
});

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
console.log('\n請用OpenTABs資料夾擁有者的Google帳號開啟：\n');
console.log(authUrl);
console.log(`\n等待Google回傳到 ${redirectUri} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('Invalid state');
    server.close();
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing authorization code');
    server.close();
    return;
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || `HTTP ${tokenResponse.status}`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('OpenGuitarTAB Drive授權完成，可以關閉此視窗。');
    console.log('授權完成。請把以下值只存到Vercel Environment Variables：\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token || '(未取得refresh token，請撤銷舊授權後再執行一次)'}`);
  } catch (error) {
    console.error('Token交換失敗：', error.message);
    res.writeHead(500).end('Token exchange failed');
  } finally {
    server.close();
  }
});

server.listen(port, '127.0.0.1');
