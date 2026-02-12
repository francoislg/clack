import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "./logger.js";

export interface GitHubAppCredentials {
  appId: string;
  installationId: string;
  privateKeyPath: string;
}

export interface InstallationTokenResult {
  token: string;
  permissions: Record<string, string>;
  expiresAt: Date;
}

interface CachedToken {
  token: string;
  permissions: Record<string, string>;
  expiresAt: Date;
}

let credentials: GitHubAppCredentials | null = null;
let cachedToken: CachedToken | null = null;
let octokitInstance: Octokit | null = null;

export function loadGitHubCredentials(): GitHubAppCredentials {
  const authPath = resolve(process.cwd(), "data", "auth", "github.json");

  if (!existsSync(authPath)) {
    throw new Error(
      `GitHub App auth file not found at ${authPath}.\n` +
      `Create a GitHub App and save credentials to data/auth/github.json.\n` +
      `See data/auth/github.example.json for the expected format.`
    );
  }

  const content = readFileSync(authPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`GitHub App auth file is not valid JSON: ${authPath}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("GitHub App auth file must be an object");
  }

  const auth = parsed as Record<string, unknown>;

  if (typeof auth.appId !== "string" || auth.appId.length === 0) {
    throw new Error("GitHub App auth 'appId' is required (numeric string)");
  }
  if (typeof auth.installationId !== "string" || auth.installationId.length === 0) {
    throw new Error("GitHub App auth 'installationId' is required (numeric string)");
  }

  const privateKeyPath = (auth.privateKeyPath as string) || "data/auth/github-app.pem";
  const resolvedKeyPath = resolve(process.cwd(), privateKeyPath);

  if (!existsSync(resolvedKeyPath)) {
    throw new Error(
      `GitHub App private key not found at ${resolvedKeyPath}.\n` +
      `Download the private key from your GitHub App settings page.`
    );
  }

  credentials = {
    appId: auth.appId as string,
    installationId: auth.installationId as string,
    privateKeyPath: resolvedKeyPath,
  };

  return credentials;
}

function getCredentials(): GitHubAppCredentials {
  if (!credentials) {
    throw new Error("GitHub credentials not loaded. Call loadGitHubCredentials() first.");
  }
  return credentials;
}

function getPrivateKey(): string {
  const creds = getCredentials();
  return readFileSync(creds.privateKeyPath, "utf-8");
}

export async function getInstallationToken(): Promise<InstallationTokenResult> {
  // Return cached token if still valid (with 5-minute buffer)
  if (cachedToken) {
    const bufferMs = 5 * 60 * 1000;
    if (cachedToken.expiresAt.getTime() - Date.now() > bufferMs) {
      return cachedToken;
    }
    logger.debug("GitHub App installation token approaching expiry, refreshing...");
  }

  const creds = getCredentials();
  const privateKey = getPrivateKey();

  const auth = createAppAuth({
    appId: creds.appId,
    privateKey,
    installationId: Number(creds.installationId),
  });

  const result = await auth({ type: "installation" });
  const permissions = (result as Record<string, unknown>).permissions as Record<string, string> ?? {};

  cachedToken = {
    token: result.token,
    permissions,
    expiresAt: new Date(result.expiresAt!),
  };

  logger.debug("Generated new GitHub App installation token");
  return cachedToken;
}

export async function getOctokit(): Promise<Octokit> {
  const { token } = await getInstallationToken();

  // Recreate Octokit with fresh token each time to avoid stale auth
  octokitInstance = new Octokit({ auth: token });
  return octokitInstance;
}

/**
 * Parse a repository URL into owner/repo.
 * Accepts: "owner/repo", "https://github.com/owner/repo.git", "https://github.com/owner/repo"
 */
export function parseRepoUrl(url: string): { owner: string; repo: string } {
  // Shorthand: owner/repo
  const shorthandMatch = url.match(/^([^/]+)\/([^/]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }

  // HTTPS URL
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new Error(
    `Cannot parse repository URL: ${url}\n` +
    `Use "owner/repo" shorthand or "https://github.com/owner/repo.git" format.`
  );
}

/**
 * Construct an authenticated HTTPS clone URL using a fresh installation token.
 */
export async function getAuthenticatedCloneUrl(repoUrl: string): Promise<string> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const { token } = await getInstallationToken();
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * Validate GitHub App credentials on startup by generating a test token
 * and fetching the installation info.
 */
export async function validateGitHubApp(): Promise<void> {
  const creds = getCredentials();
  const privateKey = getPrivateKey();

  // Use app-level JWT auth (not installation token) for the /app/installations endpoint
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.appId,
      privateKey,
    },
  });

  const { data: installation } = await appOctokit.apps.getInstallation({
    installation_id: Number(creds.installationId),
  });

  const accountName = installation.account && "login" in installation.account
    ? installation.account.login
    : "unknown";

  logger.info(
    `GitHub App authenticated — installation on "${accountName}" (ID: ${creds.installationId})`
  );
}
