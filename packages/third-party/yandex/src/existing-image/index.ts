import { yandex } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import { getComputeImage } from "@highstate/yandex-sdk"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(yandex.existingImage)

const provider = await createProvider(inputs.connection)

const ycImage = await getComputeImage({ imageId: args.id }, { provider })

const image = makeEntityOutput({
  entity: yandex.imageEntity,
  identity: ycImage.id,
  meta: {
    title: ycImage.name,
  },
  value: {
    id: ycImage.id,
  },
})

export default outputs({
  image,
  $statusFields: {
    name: ycImage.name,
  },
})
