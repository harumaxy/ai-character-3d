// Bun resolves .yaml imports itself; this only tells tsc the module exists.
declare module "*.yaml" {
  const value: any;
  export default value;
}
