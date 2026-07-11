// Ambient declaration so `import("./x.json")` type-checks without
// `resolveJsonModule` (which would infer a huge literal type for the 5000-entry
// Tabler dataset and slow tsc). Vite handles the actual JSON loading at runtime.
declare module "*.json" {
  const value: unknown;
  export default value;
}
