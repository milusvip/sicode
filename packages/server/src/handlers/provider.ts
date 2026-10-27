import { Provider } from "@opencode/core/provider"
import { probeModels } from "@opencode/core/provider-probe"
import { InvalidRequestError, ProviderNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const providers = yield* Provider.Service
          return yield* response(providers.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const providers = yield* Provider.Service
          const provider = yield* providers.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
      .handle(
        "provider.models",
        Effect.fn("server.provider.models")(function* (ctx) {
          const models = yield* probeModels({
            baseURL: ctx.payload.baseURL,
            apiKey: ctx.payload.apiKey,
            headers: ctx.payload.headers ? { ...ctx.payload.headers } : undefined,
          }).pipe(
            Effect.mapError(
              (error) => new InvalidRequestError({ message: error.message }),
            ),
          )
          return { models }
        }),
      )
  }),
)
