import { Octokit } from '@octokit/rest';
import fs from 'fs';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GitHubClient');

let octokitInstance: Octokit | null = null;

export function getOctokit(installationId?: number): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
  const token = process.env.GITHUB_TOKEN; // For development/testing

  // Use personal token if available (simpler for dev)
  if (token) {
    logger.debug('Using personal access token');
    return new Octokit({ auth: token });
  }

  // Use GitHub App authentication (requires @octokit/auth-app)
  if (appId && privateKeyPath && installationId) {
    logger.info('GitHub App auth configured but not implemented yet');
    // TODO: Implement GitHub App auth for production
  }

  // Fallback to unauthenticated (limited rate)
  logger.warn('No GitHub authentication configured - using unauthenticated client');
  if (!octokitInstance) {
    octokitInstance = new Octokit();
  }
  return octokitInstance;
}

export function parseRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
}
