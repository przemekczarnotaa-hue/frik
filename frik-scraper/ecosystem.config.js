// PM2 ecosystem config for frik-scraper
// Deploy to: /home/ubuntu/przemek/frik-scraper/
//
// ── Nginx reverse-proxy snippet (add to your site config) ─────────────────────
//
//   location /api/frik-scraper/ {
//       proxy_pass         http://127.0.0.1:3001/;
//       proxy_http_version 1.1;
//       proxy_set_header   Host              $host;
//       proxy_set_header   X-Real-IP         $remote_addr;
//       proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
//       proxy_set_header   X-Forwarded-Proto $scheme;
//       proxy_read_timeout 60s;
//   }
//
// After adding: sudo nginx -t && sudo nginx -s reload
// ──────────────────────────────────────────────────────────────────────────────
//
// ── First-time setup on the VPS ───────────────────────────────────────────────
//   cd /home/ubuntu/przemek/frik-scraper
//   npm install
//   npx playwright install chromium --with-deps
//   cp .env.example .env          # then edit: nano .env
//   pm2 start ecosystem.config.js
//   pm2 save
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name:       'frik-scraper',
      script:     'server.js',
      cwd:        '/home/ubuntu/przemek/frik-scraper',
      instances:  1,          // Playwright uses a lot of memory — keep at 1
      autorestart: true,
      watch:      false,
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production',
        PORT:     '3001',
        // API_KEY is read from .env file via dotenv
      },
    },
  ],
};
