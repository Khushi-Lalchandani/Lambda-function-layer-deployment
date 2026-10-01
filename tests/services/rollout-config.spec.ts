import { afterEach, describe, expect, it, vi } from 'vitest';
import { logRolloutStatus, rolloutModeLabel } from '../../services/rollout-config';

describe('rollout-config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('labels rollout modes', () => {
    expect(rolloutModeLabel(true)).toBe('ACTIVE');
    expect(rolloutModeLabel(false)).toBe('SHADOW');
  });

  it('logs production rollout defaults', () => {
    const lines: string[] = [];
    const logger = { log: (line: string) => lines.push(line) };

    logRolloutStatus(logger);

    expect(lines).toContain('[RAG_ROLLOUT]');
    expect(lines).toContain('QUERY_REWRITE: ACTIVE');
    expect(lines).toContain('DECOMPOSITION: ACTIVE');
    expect(lines).toContain('PLANNER: SHADOW');
    expect(lines).toContain('EXECUTION_GRAPH: ACTIVE');
    expect(lines).toContain('LEGACY_ROUTING: DISABLED');
    expect(lines).toContain('LEGACY_SHADOW: DISABLED');
  });

  it('respects env overrides for rollout flags', () => {
    vi.stubEnv('ENABLE_QUERY_REWRITE', 'false');
    vi.stubEnv('ENABLE_QUERY_DECOMPOSITION', 'false');
    vi.stubEnv('ENABLE_PLANNER', 'true');
    vi.stubEnv('ENABLE_EXECUTION_GRAPH', 'true');

    const lines: string[] = [];
    logRolloutStatus({ log: (line: string) => lines.push(line) });

    expect(lines).toContain('QUERY_REWRITE: SHADOW');
    expect(lines).toContain('DECOMPOSITION: SHADOW');
    expect(lines).toContain('PLANNER: ACTIVE');
    expect(lines).toContain('EXECUTION_GRAPH: ACTIVE');
    expect(lines).toContain('LEGACY_ROUTING: DISABLED');
    expect(lines).toContain('LEGACY_SHADOW: DISABLED');
  });

  it('logs legacy rollback configuration', () => {
    vi.stubEnv('ENABLE_PLANNER', 'true');
    vi.stubEnv('ENABLE_PLANNER_SHADOW', 'false');
    vi.stubEnv('USE_LEGACY_ROUTING', 'true');
    vi.stubEnv('ENABLE_EXECUTION_GRAPH', 'false');
    vi.stubEnv('ENABLE_EXECUTION_GRAPH_SHADOW', 'true');

    const lines: string[] = [];
    logRolloutStatus({ log: (line: string) => lines.push(line) });

    expect(lines).toContain('PLANNER: ACTIVE');
    expect(lines).toContain('EXECUTION_GRAPH: SHADOW');
    expect(lines).toContain('LEGACY_ROUTING: ACTIVE');
    expect(lines).toContain('LEGACY_SHADOW: DISABLED');
  });

  it('logs legacy shadow when explicitly enabled for rollback validation', () => {
    vi.stubEnv('ENABLE_PLANNER', 'true');
    vi.stubEnv('ENABLE_PLANNER_SHADOW', 'false');
    vi.stubEnv('ENABLE_EXECUTION_GRAPH', 'true');
    vi.stubEnv('ENABLE_EXECUTION_GRAPH_SHADOW', 'false');
    vi.stubEnv('USE_LEGACY_ROUTING', 'false');
    vi.stubEnv('ENABLE_LEGACY_SHADOW', 'true');

    const lines: string[] = [];
    logRolloutStatus({ log: (line: string) => lines.push(line) });

    expect(lines).toContain('PLANNER: ACTIVE');
    expect(lines).toContain('EXECUTION_GRAPH: ACTIVE');
    expect(lines).toContain('LEGACY_ROUTING: DISABLED');
    expect(lines).toContain('LEGACY_SHADOW: SHADOW');
  });
});
