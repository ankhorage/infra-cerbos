import type {
  InfraExecutionContext,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

const CERBOS_CONFIG = `server:
  httpListenAddr: ":3592"
  grpcListenAddr: ":3593"
storage:
  driver: "disk"
  disk:
    directory: /policies
`;

/** Project Cerbos config and policy intent into one runtime-neutral workload. */
export function createCerbosWorkload(context: InfraExecutionContext): InfraWorkloadSpec {
  const policies =
    context.desired.authz?.provider === 'cerbos' ? (context.desired.authz.policies ?? {}) : {};
  const policyFiles = Object.entries(policies)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Readonly<Record<string, InfraWorkloadValue>>>(
      (files, [path, content]) => ({
        ...files,
        [`/policies/${path}`]: { kind: 'literal', value: content },
      }),
      {},
    );
  return {
    id: 'cerbos',
    artifact: { kind: 'image', image: 'ghcr.io/cerbos/cerbos:0.40.0' },
    args: ['server', '--config=/config/config.yaml'],
    ports: { http: { port: 3592 }, grpc: { port: 3593 } },
    files: {
      '/config/config.yaml': { kind: 'literal', value: CERBOS_CONFIG },
      ...policyFiles,
    },
    health: {
      kind: 'command',
      command: ['/cerbos', 'healthcheck', '--config=/config/config.yaml'],
    },
    exposure: 'internal',
    replicas: 1,
  };
}
