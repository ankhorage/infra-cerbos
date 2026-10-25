import { createInfraAdapter, infraAdapterDescriptor } from '@ankhorage/infra-cerbos';

const adapter = createInfraAdapter();

console.log(infraAdapterDescriptor.id, adapter.descriptor.package);
