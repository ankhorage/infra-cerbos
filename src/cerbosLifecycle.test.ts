import type { InfraExecutionContext } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createInfraAdapter } from './index.js';

it('contributes one deterministic runtime-neutral Cerbos workload', async () => {
  const adapter = createInfraAdapter();
  const context = createContext();

  expect((await adapter.validateAsync(context)).ok).toBe(true);
  const workloads = await adapter.desiredWorkloadsAsync(context);
  expect(workloads.ok).toBe(true);
  if (!workloads.ok) return;
  expect(workloads.value).toEqual([
    {
      id: 'cerbos',
      artifact: { kind: 'image', image: 'ghcr.io/cerbos/cerbos:0.40.0' },
      args: ['server', '--config=/config/config.yaml'],
      ports: { http: { port: 3592 }, grpc: { port: 3593 } },
      files: {
        '/config/config.yaml': {
          kind: 'literal',
          value:
            'server:\n  httpListenAddr: ":3592"\n  grpcListenAddr: ":3593"\nstorage:\n  driver: "disk"\n  disk:\n    directory: /policies\n',
        },
        '/policies/a.yaml': { kind: 'literal', value: 'policy-a' },
        '/policies/z.yaml': { kind: 'literal', value: 'policy-z' },
      },
      health: {
        kind: 'command',
        command: ['/cerbos', 'healthcheck', '--config=/config/config.yaml'],
      },
      exposure: 'internal',
      replicas: 1,
    },
  ]);
  expect(JSON.stringify(workloads.value)).not.toContain('Deployment');
  expect(JSON.stringify(workloads.value)).not.toContain('docker-compose');
});

it('tracks a logical owner and exposes only the non-secret in-network endpoint', async () => {
  const adapter = createInfraAdapter();
  const context = createContext();
  const initial = await adapter.planAsync(context);
  expect(initial.ok && initial.value[0]?.operation).toBe('create');

  const reconciled = await adapter.reconcileAsync(context, []);
  expect(reconciled.ok).toBe(true);
  if (!reconciled.ok) return;
  expect(reconciled.value.outputs).toEqual([
    {
      owner: {
        projectId: 'sample',
        environment: 'local',
        adapter: 'cerbos',
        resourceId: 'service',
      },
      name: 'http',
      visibility: 'public',
      value: 'http://cerbos:3592',
      environmentVariable: 'CERBOS_URL',
    },
  ]);

  const convergedContext: InfraExecutionContext = {
    ...context,
    previous: {
      schemaVersion: 1,
      projectId: 'sample',
      environment: 'local',
      targets: [],
      resources: reconciled.value.resources,
      outputs: reconciled.value.outputs,
      artifacts: [],
    },
  };
  const converged = await adapter.planAsync(convergedContext);
  expect(converged.ok && converged.value[0]?.operation).toBe('noop');
  const status = await adapter.statusAsync(convergedContext);
  expect(status.ok && status.value[0]?.state).toBe('ready');
});

it('requires exact confirmation and rejects invocation without Cerbos selection', async () => {
  const adapter = createInfraAdapter();
  const context = createContext();
  const rejected = await adapter.destroyAsync(context, {
    projectId: 'sample',
    environment: 'local',
    confirmation: { projectId: 'wrong', environment: 'local' },
    persistence: { policy: 'retain' },
  });
  expect(rejected.ok).toBe(false);
  const destroyed = await adapter.destroyAsync(context, createDestroyRequest());
  expect(destroyed.ok && destroyed.value.resources).toEqual([]);

  const unselected: InfraExecutionContext = {
    ...context,
    desired: { deployment: context.desired.deployment },
  };
  expect((await adapter.validateAsync(unselected)).ok).toBe(false);
});

function createContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      authz: {
        provider: 'cerbos',
        kind: 'ABAC',
        policies: { 'z.yaml': 'policy-z', 'a.yaml': 'policy-a' },
      },
    },
    credentials: {
      findAsync: () => Promise.resolve({ ok: true, value: null, diagnostics: [] }),
      resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
      persistAsync: () => Promise.resolve({ ok: true, value: null, diagnostics: [] }),
    },
    secrets: { resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }) },
  };
}

function createDestroyRequest() {
  return {
    projectId: 'sample',
    environment: 'local' as const,
    confirmation: { projectId: 'sample', environment: 'local' as const },
    persistence: { policy: 'retain' as const },
  };
}
