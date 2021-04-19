// Common utils (main OR renderer)

export function noop<T extends any[]>(...args: T): void {
  return void args;
}

export * from "./app-version";
export * from "./autobind";
export * from "./base64";
export * from "./camelCase";
export * from "./cloneJson";
export * from "./delay";
export * from "./debouncePromise";
export * from "./defineGlobal";
export * from "./getRandId";
export * from "./splitArray";
export * from "./saveToAppFiles";
export * from "./singleton";
export * from "./openExternal";
export * from "./downloadFile";
export * from "./escapeRegExp";
export * from "./tar";
export * from "./type-narrowing";
export * from "./paths";
