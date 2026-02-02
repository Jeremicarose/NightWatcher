/**
 * GitHub App Authentication
 *
 * Creates installation tokens for GitHub App authentication.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GitHubAppAuth');

// Cache installation tokens (they're valid for 1 hour)
const tokenCache: Map<number, { token: string; expiresAt: Date }> = new Map();

/**
 * Check if GitHub App is configured.
 */
export function isAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY_PATH);
}

/**
 * Get private key from file or environment.
 */
function getPrivateKey(): string {
  const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  const keyContent = process.env.GITHUB_PRIVATE_KEY;

  if (keyContent) {
    return keyContent.replace(/\\n/g, '\n');
  }

  if (keyPath && fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf-8');
  }

  throw new Error('GitHub App private key not found. Set GITHUB_PRIVATE_KEY_PATH or GITHUB_PRIVATE_KEY');
}

/**
 * Get the installation ID for a repository.
 */
async function getInstallationId(owner: string, repo: string): Promise<number> {
  const appId = parseInt(process.env.GITHUB_APP_ID || '', 10);
  const privateKey = getPrivateKey();

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });

  try {
    const { data: installation } = await appOctokit.apps.getRepoInstallation({
      owner,
      repo,
    });
    return installation.id;
  } catch (error) {
    logger.error('Failed to get installation ID', { owner, repo, error });
    throw new Error(`GitHub App is not installed on ${owner}/${repo}`);
  }
}

/**
 * Get an authenticated Octokit client using GitHub App installation token.
 */
export async function getAppOctokit(repoFullName: string): Promise<Octokit> {
  const [owner, repo] = repoFullName.split('/');

  if (!isAppConfigured()) {
    // Fall back to personal access token
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('Neither GitHub App nor GITHUB_TOKEN is configured');
    }
    logger.debug('Using personal access token (GitHub App not configured)');
    return new Octokit({ auth: token });
  }

  const appId = parseInt(process.env.GITHUB_APP_ID || '', 10);
  const privateKey = getPrivateKey();

  // Get installation ID
  const installationId = await getInstallationId(owner, repo);

  // Check cache
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > new Date()) {
    logger.debug('Using cached installation token', { installationId });
    return new Octokit({ auth: cached.token });
  }

  // Create new installation token
  logger.debug('Creating new installation token', { installationId });

  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });

  // Get the installation access token
  const auth = await appOctokit.auth({
    type: 'installation',
    installationId,
  }) as { token: string; expiresAt: string };

  // Cache it
  tokenCache.set(installationId, {
    token: auth.token,
    expiresAt: new Date(auth.expiresAt),
  });

  logger.info('Got installation token', { installationId, expiresAt: auth.expiresAt });

  return new Octokit({ auth: auth.token });
}
