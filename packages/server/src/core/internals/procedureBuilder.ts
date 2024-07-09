import { getTRPCErrorFromUnknown, TRPCError } from '../../error/TRPCError';
import type { MaybePromise, Simplify } from '../../types';
import type {
  MiddlewareBuilder,
  MiddlewareFunction,
  MiddlewareResult,
} from '../middleware';
import { createInputMiddleware, createOutputMiddleware } from '../middleware';
import type { inferParser, Parser } from '../parser';
import type {
  AnyMutationProcedure,
  AnyProcedure,
  AnyQueryProcedure,
  AnySubscriptionProcedure,
  Procedure, ProcedureInputOutput,
  ProcedureParams,
} from '../procedure';
import type { ProcedureType } from '../types';
import type { AnyRootConfig } from './config';
import { getParseFn } from './getParseFn';
import { mergeWithoutOverrides } from './mergeWithoutOverrides';
import type {
  DefaultValue,
  Overwrite,
  OverwriteKnown,
  ResolveOptions,
  UnsetMarker,
} from './utils';
import { middlewareMarker } from './utils';


type CreateProcedureReturnInput<
  TPrev extends ProcedureParams,
  TNext extends ProcedureParams,
> =
  TPrev['_inputOutputs'] extends readonly [infer TPrevInputOutput extends ProcedureInputOutput] ?
    TNext['_inputOutputs'] extends readonly [infer TNextInputOutput extends ProcedureInputOutput] ?
      ProcedureBuilder<{
        _config: TPrev['_config'];
        _meta: TPrev['_meta'];
        _ctx_out: Overwrite<TPrev['_ctx_out'], TNext['_ctx_out']>;
        _inputOutputs: [{
          inputIn: TPrevInputOutput['inputIn'];
          inputOut: UnsetMarker extends TNextInputOutput['inputOut'] ? TPrevInputOutput['inputOut'] : Overwrite<TPrevInputOutput['inputOut'], TNextInputOutput['inputOut']>;
          outputIn: DefaultValue<TNextInputOutput['outputIn'], TPrevInputOutput['outputIn']>;
          outputOut: DefaultValue<TNextInputOutput['outputOut'], TNextInputOutput['outputOut']>;
        }];
      }> :
    never :
  never
;

/**
 * @internal
 */
export interface BuildProcedure<
  TType extends ProcedureType,
  TParams extends ProcedureParams,
  TOutput,
> extends Procedure<
    TType,
    UnsetMarker extends TParams['_inputOutputs'][number]['outputOut']
      ? OverwriteKnown<
          TParams,
          {
            _output_in: TOutput;
            _output_out: TOutput;
          }
        >
      : TParams
  > {}

type OverwriteIfDefined<TType, TWith> = UnsetMarker extends TType
  ? TWith
  : Simplify<TType & TWith>;

type ErrorMessage<TMessage extends string> = TMessage;

export type ProcedureBuilderDef<TParams extends ProcedureParams> = {
  inputOutputs: {
    input?: Parser;
    output?: Parser;
  }[];
  meta?: TParams['_meta'];
  resolver?: ProcedureBuilderResolver;
  middlewares: ProcedureBuilderMiddleware[];
  mutation?: boolean;
  query?: boolean;
  subscription?: boolean;
};

export type AnyProcedureBuilderDef = ProcedureBuilderDef<any>;

export interface ProcedureBuilder<TParams extends ProcedureParams> {
  /**
   * Add an input parser to the procedure.
   */
  input<$Parser extends Parser>(
    schema: TParams['_inputOutputs'][0]['inputOut'] extends UnsetMarker
      ? $Parser
      : inferParser<$Parser>['out'] extends Record<string, unknown> | undefined
      ? TParams['_inputOutputs'][0]['inputOut'] extends Record<string, unknown> | undefined
        ? undefined extends inferParser<$Parser>['out'] // if current is optional the previous must be too
          ? undefined extends TParams['_inputOutputs'][0]['inputOut']
            ? $Parser
            : ErrorMessage<'Cannot chain an optional parser to a required parser'>
          : $Parser
        : ErrorMessage<'All input parsers did not resolve to an object'>
      : ErrorMessage<'All input parsers did not resolve to an object'>,
  ): ProcedureBuilder<{
    _config: TParams['_config'];
    _meta: TParams['_meta'];
    _ctx_out: TParams['_ctx_out'];
    _inputOutputs: [{
      inputIn: OverwriteIfDefined<
        TParams['_inputOutputs'][0]['inputIn'],
        inferParser<$Parser>['in']
      >;
      inputOut: OverwriteIfDefined<
        TParams['_inputOutputs'][0]['inputOut'],
        inferParser<$Parser>['out']
      >;
      outputIn: TParams['_inputOutputs'][0]['outputIn'],
      outputOut: TParams['_inputOutputs'][0]['outputOut'],
    }];
  }>;
  /**
   * Add an output parser to the procedure.
   */
  output<$Parser extends Parser>(
    schema: $Parser,
  ): ProcedureBuilder<{
    _config: TParams['_config'];
    _meta: TParams['_meta'];
    _ctx_out: TParams['_ctx_out'];
    _inputOutputs: [{
      inputIn: TParams['_inputOutputs'][0]['inputIn'];
      inputOut: TParams['_inputOutputs'][0]['inputOut'];
      outputIn: inferParser<$Parser>['in'];
      outputOut: inferParser<$Parser>['out'];
    }]
  }>;

  inputOutput<$InputParser extends Parser, $OutputParser extends Parser>(
    inputSchema: $InputParser,
    outputSchema: $OutputParser
  ): ProcedureBuilder<{
    _config: TParams['_config'];
    _meta: TParams['_meta'];
    _ctx_out: TParams['_ctx_out'];
    _inputOutputs: [{
      inputIn: inferParser<$InputParser>['in'];
      inputOut: inferParser<$InputParser>['out'];
      outputIn: inferParser<$OutputParser>['in'];
      outputOut: inferParser<$OutputParser>['out'];
    }];
  }>;

  /**
   * Add a meta data to the procedure.
   */
  meta(meta: TParams['_meta']): ProcedureBuilder<TParams>;
  /**
   * Add a middleware to the procedure.
   */
  use<$Params extends ProcedureParams>(
    fn:
      | MiddlewareBuilder<TParams, $Params>
      | MiddlewareFunction<TParams, $Params>,
  ): CreateProcedureReturnInput<TParams, $Params>;
  /**
   * Extend the procedure with another procedure.
   * @warning The TypeScript inference fails when chaining concatenated procedures.
   */
  unstable_concat<$ProcedureBuilder extends AnyProcedureBuilder>(
    proc: $ProcedureBuilder,
  ): $ProcedureBuilder extends ProcedureBuilder<infer $TParams>
    ? CreateProcedureReturnInput<TParams, $TParams>
    : never;
  /**
   * Query procedure
   */
  query<$Output>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<DefaultValue<TParams['_inputOutputs'][number]['outputIn'], $Output>>,
  ): BuildProcedure<'query', TParams, $Output>;

  /**
   * Mutation procedure
   */
  mutation<$Output>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<DefaultValue<TParams['_inputOutputs'][number]['outputIn'], $Output>>,
  ): BuildProcedure<'mutation', TParams, $Output>;

  /**
   * Mutation procedure
   */
  subscription<$Output>(
    resolver: (
      opts: ResolveOptions<TParams>,
    ) => MaybePromise<DefaultValue<TParams['_inputOutputs'][number]['outputIn'], $Output>>,
  ): BuildProcedure<'subscription', TParams, $Output>;
  /**
   * @internal
   */
  _def: ProcedureBuilderDef<TParams>;
}

type AnyProcedureBuilder = ProcedureBuilder<any>;

export type ProcedureBuilderMiddleware = MiddlewareFunction<any, any>;

export type ProcedureBuilderResolver = (
  opts: ResolveOptions<any>,
) => Promise<unknown>;

function createNewBuilder(
  def1: AnyProcedureBuilderDef,
  def2: Partial<AnyProcedureBuilderDef>,
) {
  const { middlewares = [], inputOutputs, meta, ...rest } = def2;

  // TODO: maybe have a fn here to warn about calls
  return createBuilder({
    ...mergeWithoutOverrides(def1, rest),
    inputOutputs: [...def1.inputOutputs, ...(inputOutputs ?? [])],
    middlewares: [...def1.middlewares, ...middlewares],
    meta: def1.meta && meta ? { ...def1.meta, ...meta } : meta ?? def1.meta,
  });
}

export function createBuilder<TConfig extends AnyRootConfig>(
  initDef: Partial<AnyProcedureBuilderDef> = {},
): ProcedureBuilder<{
  _config: TConfig;
  _ctx_out: TConfig['$types']['ctx'];
  _inputOutputs: [{
    inputIn: UnsetMarker;
    inputOut: UnsetMarker;
    outputIn: UnsetMarker;
    outputOut: UnsetMarker;
  }];
  _meta: TConfig['$types']['meta'];
}> {
  const _def: AnyProcedureBuilderDef = {
    inputOutputs: [],
    middlewares: [],
    ...initDef,
  };

  return {
    _def,
    input(input) {
      const parser = getParseFn(input);
      return createNewBuilder(_def, {
        inputOutputs: [{ input }],
        middlewares: [createInputMiddleware(parser)],
      }) as AnyProcedureBuilder;
    },
    output(output: Parser) {
      const parseOutput = getParseFn(output);
      return createNewBuilder(_def, {
        inputOutputs: [{
          input: _def.inputOutputs[0]?.input,
          output
        }],
        middlewares: [createOutputMiddleware(parseOutput)],
      }) as AnyProcedureBuilder;
    },
    inputOutput(input, output) {
      const parser = getParseFn(input);
      return createNewBuilder(_def, {
        inputOutputs: [..._def.inputOutputs, { input, output }],
        middlewares: [createInputMiddleware(parser)],
      }) as AnyProcedureBuilder;
    },
    meta(meta) {
      return createNewBuilder(_def, {
        meta: meta as Record<string, unknown>,
      }) as AnyProcedureBuilder;
    },
    /**
     * @deprecated
     * This functionality is deprecated and will be removed in the next major version.
     */
    unstable_concat(builder) {
      return createNewBuilder(_def, builder._def) as any;
    },
    use(middlewareBuilderOrFn) {
      // Distinguish between a middleware builder and a middleware function
      const middlewares =
        '_middlewares' in middlewareBuilderOrFn
          ? middlewareBuilderOrFn._middlewares
          : [middlewareBuilderOrFn];

      return createNewBuilder(_def, {
        middlewares: middlewares as ProcedureBuilderMiddleware[],
      }) as never;
    },
    query(resolver) {
      return createResolver(
        { ..._def, query: true },
        resolver,
      ) as AnyQueryProcedure;
    },
    mutation(resolver) {
      return createResolver(
        { ..._def, mutation: true },
        resolver,
      ) as AnyMutationProcedure;
    },
    subscription(resolver) {
      return createResolver(
        { ..._def, subscription: true },
        resolver,
      ) as AnySubscriptionProcedure;
    },
  };
}

function createResolver(
  _def: AnyProcedureBuilderDef,
  resolver: (opts: ResolveOptions<any>) => MaybePromise<any>,
) {
  const finalBuilder = createNewBuilder(_def, {
    resolver,
    middlewares: [
      async function resolveMiddleware(opts) {
        const data = await resolver(opts);
        return {
          marker: middlewareMarker,
          ok: true,
          data,
          ctx: opts.ctx,
        } as const;
      },
    ],
  });

  return createProcedureCaller(finalBuilder._def);
}

/**
 * @internal
 */
export interface ProcedureCallOptions {
  ctx: unknown;
  rawInput: unknown;
  input?: unknown;
  path: string;
  type: ProcedureType;
}

const codeblock = `
This is a client-only function.
If you want to call this function on the server, see https://trpc.io/docs/server/server-side-calls
`.trim();

function createProcedureCaller(_def: AnyProcedureBuilderDef): AnyProcedure {
  const procedure = async function resolve(opts: ProcedureCallOptions) {
    // is direct server-side call
    if (!opts || !('rawInput' in opts)) {
      throw new Error(codeblock);
    }

    // run the middlewares recursively with the resolver as the last one
    const callRecursive = async (
      callOpts: {
        ctx: any;
        index: number;
        input?: unknown;
        rawInput?: unknown;
      } = {
        index: 0,
        ctx: opts.ctx,
      },
    ): Promise<MiddlewareResult<any>> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const middleware = _def.middlewares[callOpts.index]!;
        const result = await middleware({
          ctx: callOpts.ctx,
          type: opts.type,
          path: opts.path,
          rawInput: callOpts.rawInput ?? opts.rawInput,
          meta: _def.meta,
          input: callOpts.input,
          next(_nextOpts?: any) {
            const nextOpts = _nextOpts as
              | {
                  ctx?: Record<string, unknown>;
                  input?: unknown;
                  rawInput?: unknown;
                }
              | undefined;

            return callRecursive({
              index: callOpts.index + 1,
              ctx:
                nextOpts && 'ctx' in nextOpts
                  ? { ...callOpts.ctx, ...nextOpts.ctx }
                  : callOpts.ctx,
              input:
                nextOpts && 'input' in nextOpts
                  ? nextOpts.input
                  : callOpts.input,
              rawInput:
                nextOpts && 'rawInput' in nextOpts
                  ? nextOpts.rawInput
                  : callOpts.rawInput,
            });
          },
        });
        return result;
      } catch (cause) {
        return {
          ok: false,
          error: getTRPCErrorFromUnknown(cause),
          marker: middlewareMarker,
        };
      }
    };

    // there's always at least one "next" since we wrap this.resolver in a middleware
    const result = await callRecursive();

    if (!result) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'No result from middlewares - did you forget to `return next()`?',
      });
    }
    if (!result.ok) {
      // re-throw original error
      throw result.error;
    }
    return result.data;
  };
  procedure._def = _def;
  procedure.meta = _def.meta;

  return procedure as AnyProcedure;
}
