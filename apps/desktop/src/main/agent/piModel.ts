import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { importReviewModel, importReviewStream, type ImportCredentials } from "../conversion/model";

export type PiProviderStream = NonNullable<Parameters<ModelRuntime["registerProvider"]>[1]["streamSimple"]>;

/** A Pi model runtime that only knows the person's chosen model, reached through ChalkLee's
 * own transport (proxy, vendor thinking switches, time limits). Pi owns everything else. */
export async function createPiModelRuntime(credentials: ImportCredentials, options: { signal?: AbortSignal; streamFn?: PiProviderStream } = {}): Promise<{ modelRuntime: ModelRuntime; model: Model<Api> }> {
  options.signal?.throwIfAborted();
  const [{ InMemoryCredentialStore }, { ModelRuntime }, streamFn] = await Promise.all([
    import("@earendil-works/pi-ai"), import("@earendil-works/pi-coding-agent"), options.streamFn ?? importReviewStream(credentials)
  ]);
  options.signal?.throwIfAborted();
  const model = importReviewModel(credentials);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, signal: options.signal });
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl, api: model.api, apiKey: credentials.apiKey, models: [model],
    streamSimple: streamFn
  });
  return { modelRuntime, model };
}
