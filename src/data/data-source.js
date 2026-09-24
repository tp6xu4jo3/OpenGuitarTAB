import { LocalTestDataSource } from './local-test-data-source.js';
import { DATA_SOURCE_TARGET } from './runtime-target.js';
import { ServerDataSource } from './server-data-source.js';

const DATA_SOURCE_TARGETS = new Set(['server', 'local-test']);

export function createDataSource(runtime = {}) {
  const target = runtime.target ?? DATA_SOURCE_TARGET;
  if (!DATA_SOURCE_TARGETS.has(target)) throw new Error(`INVALID_DATA_SOURCE_TARGET:${target}`);
  const options = { ...runtime };
  delete options.target;
  return target === 'local-test'
    ? new LocalTestDataSource(options)
    : new ServerDataSource(options);
}

export const dataSource = createDataSource();
