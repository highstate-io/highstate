import { yandex } from "@highstate/library"
import { forUnit } from "@highstate/pulumi"
import { getComputeImage } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(yandex.existingImage)

const provider = await createProvider(inputs.connection)

const image = await getComputeImage({ imageId: args.id }, { provider })

export default outputs({
  image: {
    id: image.id,
  },
  $statusFields: {
    name: image.name,
  },
})
