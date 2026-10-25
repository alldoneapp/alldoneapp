/**
 * The one place the rage-mode arena (the raid, and three.js with it) is loaded, as its own chunk.
 * Kept in a module of its own so tests can replace it: Jest's Babel setup does not transform
 * dynamic `import()`.
 */
export const loadRageArena = () => import(/* webpackChunkName: "rage-mode" */ './raidArena')
