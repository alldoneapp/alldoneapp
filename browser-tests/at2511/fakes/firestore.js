/**
 * Stands in for `utils/backends/firestore` — see `fakes/chatsComments.js`.
 *
 * Only `unwatch` is reached from this subtree, but the module is the app's Firebase entry point, so
 * replacing it also keeps the harness from initialising a real SDK it has no credentials for.
 */
export const unwatch = () => {}
export const getDb = () => {
    throw new Error('AT-2511 harness: the last-comment subtree must not reach Firestore')
}
