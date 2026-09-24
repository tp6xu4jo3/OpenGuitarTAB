import { LocalTestDataSource } from './local-test-data-source.js';
import { ServerDataSource } from './server-data-source.js';

const GITHUB_PAGES_HOST = /(^|\.)github\.io$/i;

export function isGitHubPagesTest(hostname = '') {
  return GITHUB_PAGES_HOST.test(String(hostname));
}

export function createDataSource(runtime = {}) {
  const hostname = runtime.hostname ?? globalThis.location?.hostname ?? '';
  if (isGitHubPagesTest(hostname)) return new LocalTestDataSource(runtime);
  return new ServerDataSource(runtime);
}

export const dataSource = createDataSource();
