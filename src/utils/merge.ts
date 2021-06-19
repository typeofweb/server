/* eslint-disable @typescript-eslint/consistent-type-assertions -- :| */
export const deepMerge = <T extends object, O extends object>(overrides: T, defaults: O): T & O =>
  (Object.keys(defaults) as unknown as readonly (keyof O)[]).reduce(
    (overrides, key) => {
      const defaultValue = defaults[key];
      return {
        ...overrides,
        [key]:
          typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue
            ? deepMerge(overrides[key] ?? {}, defaultValue as unknown as object)
            : overrides[key] === undefined
            ? defaultValue
            : overrides[key],
      };
    },
    { ...overrides } as T & O,
  );
/* eslint-enable @typescript-eslint/consistent-type-assertions */
