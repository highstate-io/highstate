import { join } from "node:path"
import {
  type ClientDuplexStream,
  credentials,
  Metadata,
  makeGenericClientConstructor,
} from "@grpc/grpc-js"
import protobuf from "protobufjs"

export type RuntimeMessage = Record<string, unknown>

/** Protocol-independent SDK consumers can use this bounded, backpressure-aware gRPC transport. */
export async function connectRuntimeAgent(options: {
  url: string
  token: string
  ca?: string
  protocolRoot: string
  vendorRoot: string
}): Promise<ClientDuplexStream<RuntimeMessage, RuntimeMessage>> {
  const root = new protobuf.Root()
  root.resolvePath = (_origin, target) =>
    target.startsWith("google/api/")
      ? join(options.vendorRoot, target)
      : join(options.protocolRoot, target)
  await root.load("io/highstate/runtime/v1/runtime.proto")
  root.resolveAll()
  const request = root.lookupType("io.highstate.runtime.v1.ConnectRequest")
  const response = root.lookupType("io.highstate.runtime.v1.ConnectResponse")
  const Client = makeGenericClientConstructor(
    {
      connect: {
        path: "/io.highstate.runtime.v1.RuntimeService/Connect",
        requestStream: true,
        responseStream: true,
        requestSerialize: value =>
          Buffer.from(request.encode(request.fromObject(convert(request, value, true))).finish()),
        requestDeserialize: bytes =>
          convert(
            request,
            request.toObject(request.decode(bytes), {
              longs: String,
              enums: String,
              bytes: String,
            }),
            false,
          ),
        responseSerialize: value =>
          Buffer.from(
            response.encode(response.fromObject(convert(response, value, true))).finish(),
          ),
        responseDeserialize: bytes =>
          convert(
            response,
            response.toObject(response.decode(bytes), {
              longs: String,
              enums: String,
              bytes: String,
            }),
            false,
          ),
      },
    },
    "RuntimeService",
  )
  const url = new URL(options.url)
  if (url.protocol !== "https:") throw new Error("Runtime agent requires TLS")
  const client = new Client(
    url.host,
    credentials.createSsl(options.ca ? Buffer.from(options.ca) : undefined),
    { "grpc.max_receive_message_length": 16 * 1024 * 1024 },
  )
  const metadata = new Metadata()
  metadata.set("authorization", `Bearer ${options.token}`)
  const stream = client.makeBidiStreamRequest(
    "/io.highstate.runtime.v1.RuntimeService/Connect",
    (value: RuntimeMessage) =>
      Buffer.from(request.encode(request.fromObject(convert(request, value, true))).finish()),
    bytes =>
      convert(
        response,
        response.toObject(response.decode(bytes), { longs: String, enums: String, bytes: String }),
        false,
      ),
    metadata,
  )
  stream.once("close", () => client.close())
  return stream
}

function valueToWire(value: unknown): object {
  if (value === null) return { nullValue: 0 }
  if (Array.isArray(value)) return { listValue: { values: value.map(valueToWire) } }
  if (typeof value === "object")
    return {
      structValue: {
        fields: Object.fromEntries(
          Object.entries(value as object).map(([key, value]) => [key, valueToWire(value)]),
        ),
      },
    }
  return { [`${typeof value}Value`]: value }
}
function valueFromWire(value: Record<string, unknown>): unknown {
  if ("nullValue" in value) return null
  if ("structValue" in value)
    return Object.fromEntries(
      Object.entries(
        (value.structValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {},
      ).map(([key, value]) => [key, valueFromWire(value)]),
    )
  if ("listValue" in value)
    return ((value.listValue as { values?: Record<string, unknown>[] }).values ?? []).map(
      valueFromWire,
    )
  return value.stringValue ?? value.numberValue ?? value.boolValue
}
function convert(type: protobuf.Type, input: RuntimeMessage, encode: boolean): RuntimeMessage {
  if (type.fullName === ".google.protobuf.Struct")
    return encode
      ? {
          fields: Object.fromEntries(
            Object.entries(input).map(([key, value]) => [key, valueToWire(value)]),
          ),
        }
      : (valueFromWire({ structValue: input }) as RuntimeMessage)
  if (type.fullName === ".google.protobuf.Value")
    return (encode ? valueToWire(input) : valueFromWire(input)) as RuntimeMessage
  const output: RuntimeMessage = { ...input }
  for (const field of type.fieldsArray) {
    const value = input[field.name]
    if (value == null || !(field.resolvedType instanceof protobuf.Type)) continue
    const nested = field.resolvedType
    output[field.name] = field.map
      ? Object.fromEntries(
          Object.entries(value as object).map(([key, value]) => [
            key,
            convert(nested, value as RuntimeMessage, encode),
          ]),
        )
      : field.repeated
        ? (value as RuntimeMessage[]).map(value => convert(nested, value, encode))
        : convert(nested, value as RuntimeMessage, encode)
  }
  return output
}

export async function writeRuntimeMessage(
  stream: ClientDuplexStream<RuntimeMessage, RuntimeMessage>,
  message: RuntimeMessage,
): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    stream.write(message, (error?: Error | null) => (error ? reject(error) : resolve())),
  )
}
