// Dependency-free leaf module for workstream id constants. `WorkstreamHelper`
// imports the redux store, TasksHelper and the Firestore backends, so importing
// it just to read an id prefix pulls the whole app graph in. `WorkstreamHelper`
// re-exports both names, so existing import sites are unchanged.
export const WORKSTREAM_ID_PREFIX = 'ws@'
export const DEFAULT_WORKSTREAM_ID = 'ws@default'
