// Entry point for the SVG previews. chalk/ink decide color support the moment
// they're evaluated, so FORCE_COLOR must be set before anything that
// transitively imports ink loads; the dynamic import defeats ESM hoisting.
// Run with: npm run previews
process.env.FORCE_COLOR = "3";
await import("./render-previews-impl.js");

export {};
