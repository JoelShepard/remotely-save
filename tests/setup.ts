if (typeof globalThis.self === "undefined") {
  (globalThis as any).self = globalThis;
}
if (typeof (globalThis as any).addEventListener === "undefined") {
  (globalThis as any).addEventListener = () => {};
  (globalThis as any).removeEventListener = () => {};
  (globalThis as any).postMessage = () => {};
}
