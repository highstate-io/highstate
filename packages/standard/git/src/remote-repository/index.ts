import { git } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { MaterializedRepository } from "../shared"

const { args, inputs, outputs } = forUnit(git.remoteRepository)

const rawEndpoint = args.url ?? (await toPromise(inputs.endpoint))
if (!rawEndpoint) {
  throw new Error("Either 'url' or 'endpoint' must be provided.")
}

await using materializedRepo = await MaterializedRepository.clone(rawEndpoint)

export default outputs({
  folder: await materializedRepo.pack({ includeGit: args.includeGit }),
})
