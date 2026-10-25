/**
 * The one place the 3D thinking stage (and three.js with it) is loaded, as its own chunk. Kept in a
 * module of its own so tests can replace it: Jest's Babel setup does not transform dynamic `import()`.
 */
export const loadThinkingStage = () => import(/* webpackChunkName: "assistant-thinking" */ './thinkingStage')
