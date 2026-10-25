/**
 * The one place the coin/cash overlay (and three.js with it) is loaded, as its own chunk. Kept in a
 * module of its own so tests can replace it: Jest's Babel setup does not transform dynamic `import()`.
 */
export const loadGoldCoinsOverlay = () => import(/* webpackChunkName: "gold-coins" */ './goldCoinsOverlay')
