import { Provider } from "@opencode/schema/provider"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, ProviderNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Provider.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.get", "/api/provider/:providerID", {
      params: { providerID: Provider.ID },
      query: LocationQuery,
      success: Location.response(Provider.Info),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "provider.get",
          summary: "Get provider",
          description: "Retrieve a single AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .add(
    // SiCode: ask the endpoint the user configured what it serves, instead of making them type model
    // ids from memory. Nothing here reads the Location, so it answers before a project is open.
    HttpApiEndpoint.post("provider.models", "/api/provider/models", {
      payload: Schema.Struct({
        baseURL: Schema.String,
        apiKey: Schema.optional(Schema.String),
        headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
      }),
      success: Schema.Struct({
        models: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.optional(Schema.String),
          }),
        ),
      }).annotate({ identifier: "ProviderModelProbe" }),
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.models",
        summary: "List a provider's models",
        description:
          "Query an OpenAI-compatible endpoint's model list with the credentials being configured, so a custom provider can offer its models for selection.",
      }),
    ),
  )
  .add(
    // SiCode: verify a configured endpoint before saving it — with a model, one one-token turn; without
    // one, the model listing is all that can be checked. Nothing here reads the Location either.
    HttpApiEndpoint.post("provider.test", "/api/provider/test", {
      payload: Schema.Struct({
        baseURL: Schema.String,
        apiKey: Schema.optional(Schema.String),
        headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
        model: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({
        mode: Schema.Literals(["chat", "models"]),
      }).annotate({ identifier: "ProviderProbeResult" }),
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.test",
        summary: "Test a provider endpoint",
        description:
          "Check that an OpenAI-compatible endpoint accepts the configured credentials. With a model id it sends one minimal turn; without one it only verifies the model listing.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "provider",
      description: "Experimental provider routes.",
    }),
  )
