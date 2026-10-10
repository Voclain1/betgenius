/**
 * React's cache() exists only in the react-server build. Outside Next it has
 * to be a pass-through for any module that wraps a function in it at load
 * time. Import this for its side effect, BEFORE the module that needs it.
 * (check-sitemap-scoping.tsx does the same inline.)
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const react = require("react");
react.cache ??= (fn: unknown) => fn;
