#!/usr/bin/env node

/**
 * One-time OAuth helper for Monday.com.
 *
 * Usage: node scripts/monday-oauth.mjs <client_id> <client_secret>
 *
 * Starts a local HTTP server, opens the Monday.com authorization page,
 * exchanges the callback code for an access token, and prints it.
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";

const [clientId, clientSecret] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/monday-oauth.mjs <client_id> <client_secret>");
  process.exit(1);
}

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("Missing authorization code");
    return;
  }

  try {
    const tokenRes = await fetch("https://auth.monday.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();

    if (data.access_token) {
      console.log("\nMonday.com OAuth token obtained successfully.");
      console.log(`\nAdd this to data/auth/.env:\n\n  MONDAY_TOKEN=${data.access_token}\n`);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Done!</h1><p>Token printed in your terminal. You can close this tab.</p>");
    } else {
      console.error("\nToken exchange failed:", data);
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`<h1>Error</h1><pre>${JSON.stringify(data, null, 2)}</pre>`);
    }
  } catch (err) {
    console.error("\nToken exchange error:", err);
    res.writeHead(500);
    res.end("Token exchange failed");
  }

  server.close();
});

server.listen(PORT, () => {
  const authUrl = `https://auth.monday.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`\nOpening browser to authorize...\n`);

  // Open browser (macOS/Linux/Windows)
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${authUrl}"`);
});
