const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 設定 ==========
const TARGET = 'https://animeheven.shunichi-0314.workers.dev';
const TARGET_HOST = 'animeheven.shunichi-0314.workers.dev';
const PASSWORD = '9247';
const FIXED_TITLE = 'google';
// =========================

console.log('Starting server on port', PORT);

// パスワード認証
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Password Required"');
    return res.status(401).send('パスワードが必要です');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  const [, password] = credentials.split(':');

  if (password === PASSWORD) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Password Required"');
  return res.status(401).send('パスワードが違います');
});

// プロキシ
app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  selfHandleResponse: true,

  onProxyReq: (proxyReq) => {
    proxyReq.setHeader('Host', TARGET_HOST);
    proxyReq.removeHeader('referer');
    proxyReq.removeHeader('origin');
  },

  onProxyRes: (proxyRes, req, res) => {
    res.statusCode = proxyRes.statusCode;

    Object.keys(proxyRes.headers).forEach((key) => {
      const lower = key.toLowerCase();
      if (
        lower !== 'content-length' &&
        lower !== 'content-encoding' &&
        lower !== 'content-security-policy' &&
        lower !== 'x-frame-options'
      ) {
        res.setHeader(key, proxyRes.headers[key]);
      }
    });

    const chunks = [];
    proxyRes.on('data', (chunk) => chunks.push(chunk));

    proxyRes.on('end', () => {
      let buffer = Buffer.concat(chunks);
      const encoding = proxyRes.headers['content-encoding'];
      const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();

      // 圧縮解除
      try {
        if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
        else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
        else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
      } catch (err) {
        console.error('Decompress error:', err.message);
      }

      const shouldRewrite =
        contentType.includes('text/html') ||
        contentType.includes('text/css') ||
        contentType.includes('javascript') ||
        contentType.includes('application/json') ||
        contentType.includes('text/plain');

      if (shouldRewrite) {
        try {
          let text = buffer.toString('utf8');
          const host = req.headers.host;
          const protocol = req.headers['x-forwarded-proto'] || 'https';
          const currentOrigin = `${protocol}://${host}`;

          // WorkerのURL + 元サイトのURL を両方置換
          text = text
            .replaceAll(`https://${TARGET_HOST}`, currentOrigin)
            .replaceAll(`http://${TARGET_HOST}`, currentOrigin)
            .replaceAll(`//${TARGET_HOST}`, `//${host}`)
            .replaceAll(TARGET_HOST, host)
            .replaceAll('https://animeheaven.me', currentOrigin)
            .replaceAll('http://animeheaven.me', currentOrigin)
            .replaceAll('//animeheaven.me', `//${host}`)
            .replaceAll('animeheaven.me', host);

          // タイトルを「google」に固定
          text = text.replace(
            /<title[^>]*>[\s\S]*?<\/title>/i,
            `<title>${FIXED_TITLE}</title>`
          );

          // ファビコンをGoogleに変更
          text = text.replace(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*>/gi, '');
          text = text.replace(/<link[^>]*rel=["']apple-touch-icon["'][^>]*>/gi, '');
          text = text.replace(
            /<head[^>]*>/i,
            `$&
  <link rel="icon" href="https://www.google.com/favicon.ico" type="image/x-icon">
  <link rel="shortcut icon" href="https://www.google.com/favicon.ico" type="image/x-icon">`
          );

          buffer = Buffer.from(text, 'utf8');
        } catch (err) {
          console.error('Rewrite error:', err.message);
        }
      }

      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    });

    proxyRes.on('error', (err) => {
      console.error('Response stream error:', err.message);
      if (!res.headersSent) res.status(502).end('Bad Gateway');
    });
  },

  onError: (err, req, res) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(502).send('Bad Gateway');
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server successfully started on port ${PORT}`);
});
