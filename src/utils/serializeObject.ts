import { isObject } from '@typeofweb/utils';

import type { Json, JsonObject } from '@typeofweb/utils';

export const stableJsonStringify = (arg: Json): string => {
  return JSON.stringify(isObject(arg) ? sortObjProperties(arg) : arg);
};

const sortObjProperties = <T extends JsonObject>(arg: T): T => {
  return Object.fromEntries(
    Object.entries(arg)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, val]) => (isObject(val) ? [key, sortObjProperties(val)] : [key, val])),
  );
};
