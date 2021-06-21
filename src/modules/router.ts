import { object, validate, ValidationError } from '@typeofweb/schema';
import Express from 'express';

import { isSealed, seal, unseal } from '../utils/encryptCookies';
import { HttpError, isStatusError, tryCatch } from '../utils/errors';
import { deepMerge } from '../utils/merge';
import { calculateSpecificity } from '../utils/routeSpecificity';
import { generateRequestId } from '../utils/uniqueId';

import { HttpStatusCode } from './httpStatusCodes';

import type { Json, MaybeAsync } from '../utils/types';
import type { TypeOfWebRequestMeta } from './augment';
import type { HttpMethod } from './httpStatusCodes';
import type { TypeOfWebPluginInternal } from './plugins';
import type { AppOptions, TypeOfWebRequest, TypeOfWebRequestToolkit, TypeOfWebRoute, TypeOfWebServer } from './shared';
import type { SchemaRecord, TypeOfRecord } from './validation';
import type { SomeSchema, TypeOf } from '@typeofweb/schema';

export const initRouter = ({
  routes,
  appOptions,
  server,
  plugins,
}: {
  readonly routes: readonly TypeOfWebRoute[];
  readonly appOptions: AppOptions;
  readonly server: TypeOfWebServer;
  readonly plugins: ReadonlyArray<TypeOfWebPluginInternal<string>>;
}) => {
  const router = Express.Router({
    strict: appOptions.router.strictTrailingSlash,
  });

  routes
    .slice()
    // sort lexicographically
    .sort((a, b) => {
      const aFirst = -1;
      const bFirst = 1;

      if (a.path === b.path) {
        return 0;
      }

      const aSpecificity = calculateSpecificity(a.path);
      const bSpecificity = calculateSpecificity(b.path);
      if (aSpecificity !== bSpecificity) {
        return aSpecificity > bSpecificity ? bFirst : aFirst;
      }

      return a.path > b.path ? bFirst : aFirst;
    })
    .forEach((route) => {
      router[route.method](route.path, finalErrorGuard(routeToExpressHandler({ route, server, appOptions, plugins })));
    });

  router.use(errorMiddleware(server));
  return router;
};

export const validateRoute = (route: TypeOfWebRoute): boolean => {
  const segments = route.path.split('/');

  const eachRouteSegmentHasAtMostOneParam = segments.every((segment) => (segment.match(/:/g) ?? []).length <= 1);
  if (!eachRouteSegmentHasAtMostOneParam) {
    throw new Error(`RouteValidationError: Each path segment can contain at most one param.`);
  }

  const routeDoesntHaveRegexes = segments.every((segment) => !segment.endsWith(')'));
  if (!routeDoesntHaveRegexes) {
    throw new Error(`RouteValidationError: Don't use regular expressions in routes. Use validators instead.`);
  }

  return true;
};

export const errorMiddleware =
  (server: TypeOfWebServer) =>
  (err: unknown, _req: Express.Request, res: Express.Response, next: Express.NextFunction) => {
    server.events.emit(':error', err);

    if (res.headersSent) {
      next(err);
      return;
    }

    if (!err) {
      return res.status(0).end();
    }

    if (err instanceof ValidationError) {
      return res.status(400).json({ name: err.name, message: err.message, body: err.details });
    }

    if (err instanceof HttpError) {
      return res.status(err.statusCode).json({ name: err.name, message: err.message, body: err.body });
    }

    if (isStatusError(err)) {
      return res.status(err.statusCode).json({ name: HttpStatusCode[err.statusCode], body: err });
    }

    // @todo if (DEBUG)
    return res.status(500).json(err);
  };

type AsyncHandler = (
  req: Express.Request,
  res: Express.Response<any, ExpressResponseLocals>,
  next: Express.NextFunction,
) => Promise<ReturnType<Express.Handler>> | ReturnType<Express.Handler>;

const finalErrorGuard = (h: AsyncHandler): AsyncHandler => {
  return async (req, res, next) => {
    try {
      await h(req, res, next);
    } catch (err) {
      next(err);
    }
  };
};

export const routeToExpressHandler = <
  Path extends string,
  ParamsKeys extends ParseRouteParams<Path>,
  Params extends SchemaRecord<ParamsKeys>,
  Query extends SchemaRecord<string>,
  Payload extends SomeSchema<Json>,
  Response extends SomeSchema<Json>,
>({
  plugins,
  route,
  server,
  appOptions,
}: {
  readonly plugins: ReadonlyArray<TypeOfWebPluginInternal<string>>;
  readonly route: {
    readonly path: Path;
    readonly method: HttpMethod;
    readonly validation: {
      readonly params?: Params;
      readonly query?: Query;
      readonly payload?: Payload;
      readonly response?: Response;
    };
    handler(
      request: TypeOfWebRequest<Path, TypeOfRecord<Params>, TypeOfRecord<Query>, TypeOf<Payload>>,
      toolkit: TypeOfWebRequestToolkit,
    ): MaybeAsync<TypeOf<Response>>;
  };
  readonly server: TypeOfWebServer;
  readonly appOptions: AppOptions;
}): AsyncHandler => {
  return async (req, res, next) => {
    // doing this early to make timestamp more reliable
    const requestId = generateRequestId();

    const params = tryCatch(() =>
      route.validation.params ? validate(object(route.validation.params)())(req.params) : req.params,
    );
    if (params._t === 'left') {
      return next(new HttpError(HttpStatusCode.BadRequest, HttpStatusCode[HttpStatusCode.BadRequest], params.value));
    }

    const query = tryCatch(() =>
      route.validation.query ? validate(object(route.validation.query)())(req.query) : req.query,
    );
    if (query._t === 'left') {
      return next(new HttpError(HttpStatusCode.BadRequest, HttpStatusCode[HttpStatusCode.BadRequest], query.value));
    }

    const payload = tryCatch(() =>
      route.validation.payload ? validate(route.validation.payload)(req.body) : req.body,
    );
    if (payload._t === 'left') {
      return next(new HttpError(HttpStatusCode.BadRequest, HttpStatusCode[HttpStatusCode.BadRequest], payload.value));
    }

    const cookies: Record<string, string> = Object.fromEntries(
      await Promise.all(
        Object.entries(req.cookies).map(async ([name, value]) => {
          if (typeof value === 'string' && isSealed(value)) {
            try {
              return [name, await unseal({ sealed: value, secret: appOptions.cookies.secret })];
            } catch {}
          }
          return [name, value];
        }),
      ),
    );

    const request: TypeOfWebRequest<Path, TypeOfRecord<Params>, TypeOfRecord<Query>, TypeOf<Payload>> = {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- these types are validated
      params: params.value as TypeOfRecord<Params>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- these types are validated
      query: query.value as TypeOfRecord<Query>,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- these types are validated
      payload: payload.value as TypeOf<Payload>,

      server,
      plugins: [],
      path: route.path,
      _rawReq: req,
      _rawRes: res,

      id: requestId,

      cookies,
    };

    await plugins.reduce(async (acc, plugin) => {
      if (!plugin?.value || typeof plugin?.value.request !== 'function') {
        return acc;
      }

      await acc;

      // @ts-expect-error
      const requestMetadata = await plugin.value.request(request);
      if (requestMetadata) {
        // @ts-expect-error
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- ok
        request.plugins[plugin.name as keyof TypeOfWebRequestMeta] = requestMetadata;
      }
    }, Promise.resolve());

    server.events.emit(':request', request);

    const toolkit = createRequestToolkitFor({ req, res, appOptions });
    const originalResult = await route.handler(request, toolkit);

    const result = tryCatch(() =>
      route.validation.response ? validate(route.validation.response)(originalResult) : originalResult,
    );

    if (result._t === 'left') {
      const err = result.value;
      if (err instanceof ValidationError) {
        // @todo don't send stacktrace on production
        return next(new HttpError(HttpStatusCode.InternalServerError, err.message, err.details));
      }
      return next(
        new HttpError(
          HttpStatusCode.InternalServerError,
          HttpStatusCode[HttpStatusCode.InternalServerError],
          result.value,
        ),
      );
    }

    if (res.headersSent) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- response is always Json or null
    server.events.emit(':response', result.value as Json | null);

    const fallbackStatusCode =
      result.value === null || result.value === undefined ? HttpStatusCode.NoContent : HttpStatusCode.OK;
    const statusCode = res.locals[CUSTOM_STATUS_CODE] ?? fallbackStatusCode;

    if (result.value === null) {
      res.status(statusCode).end();
      return;
    } else if (result.value === undefined) {
      console.warn(
        'Handler returned `undefined` which usually means you forgot to `await` something. If you want an empty response, return `null` instead.',
      );
      res.status(statusCode).end();
      return;
    } else {
      res.status(statusCode).json(result.value);
      return;
    }
  };
};

export const CUSTOM_STATUS_CODE = Symbol('CUSTOM_STATUS_CODE');
export interface ExpressResponseLocals {
  /* eslint-disable functional/prefer-readonly-type -- these are writable */
  [key: string]: any;
  [CUSTOM_STATUS_CODE]?: HttpStatusCode;
  /* eslint-enable functional/prefer-readonly-type */
}

function createRequestToolkitFor({
  appOptions,
  res,
}: {
  readonly req: Express.Request;
  readonly res: Express.Response<any, ExpressResponseLocals>;
  readonly appOptions: AppOptions;
}): TypeOfWebRequestToolkit {
  const toolkit: TypeOfWebRequestToolkit = {
    async setCookie(name, value, options = {}) {
      const { encrypted, secret, ...cookieOptions } = deepMerge(options, appOptions.cookies);

      if (encrypted && secret.length !== 32) {
        throw new Error('`options.cookies.secret` must be exactly 32 characters long.');
      }

      const cookieValue = encrypted ? await seal({ value, secret }) : value;
      res.cookie(name, cookieValue, { ...cookieOptions, signed: false });
    },
    removeCookie(name, options = {}) {
      const cookieOptions = deepMerge(options, appOptions.cookies);
      res.clearCookie(name, cookieOptions);
    },
    setStatus(statusCode: HttpStatusCode) {
      res.locals[CUSTOM_STATUS_CODE] = statusCode;
    },
  };

  return toolkit;
}

export type ParseRouteParams<Path> = string extends Path
  ? string
  : Path extends `${string}/:${infer Param}/${infer Rest}`
  ? Param | ParseRouteParams<`/${Rest}`>
  : Path extends `${string}:${infer LastParam}`
  ? LastParam
  : never;
