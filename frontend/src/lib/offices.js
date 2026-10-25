// Company offices (branches) from the signed-in profile. Module-level and live
// so existing option lists can stay as constants via liveList()/liveMap().
let offices = [];

export function setTenantOffices(list) { offices = Array.isArray(list) ? list : []; }
export const getOffices = () => offices;
export const officeName = (code) => offices.find((o) => o.code === code)?.name || code || "";

// Array-like view recomputed on every access (map, find, length, spread…).
export function liveList(build) {
  return new Proxy([], {
    get(_, prop) {
      const arr = build();
      const v = arr[prop];
      return typeof v === "function" ? v.bind(arr) : v;
    },
    has(_, prop) { return prop in build(); },
    ownKeys() { return Reflect.ownKeys(build()); },
    getOwnPropertyDescriptor(_, prop) { return Object.getOwnPropertyDescriptor(build(), prop); },
  });
}

// Object view { code: label } (plus fixed extras) recomputed on access.
export function liveMap(extras = {}, label = (o) => o.name) {
  const build = () => ({ ...Object.fromEntries(offices.map((o) => [o.code, label(o)])), ...extras });
  return new Proxy({}, {
    get(_, prop) { return build()[prop]; },
    has(_, prop) { return prop in build(); },
    ownKeys() { return Reflect.ownKeys(build()); },
    getOwnPropertyDescriptor(_, prop) { return { ...Object.getOwnPropertyDescriptor(build(), prop), configurable: true }; },
  });
}

export const officeOptions = (pre = [], post = []) =>
  liveList(() => [...pre, ...offices.map((o) => ({ value: o.code, label: o.name })), ...post]);
