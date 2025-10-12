# TypeScript Code Style Guide

This guide captures Highstate's standards for writing clear, consistent, and maintainable TypeScript code.

## Type Definitions

Use `type` for data structures and `interface` for behavioral contracts.

**GOOD:**

```typescript
export type NamespaceArgs = {
  cluster: Input<k8s.Cluster>
  privileged?: boolean
}

interface ArtifactBackend {
  store(projectId: string, hash: string): Promise<void>
  exists(projectId: string, hash: string): Promise<boolean>
}
```

## Constructor Parameter Injection

Inject dependencies through the constructor and mark them `private readonly`.

**GOOD:**

```typescript
class ArtifactService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly artifactBackend: ArtifactBackend,
    private readonly lockManager: LockManager,
    private readonly logger: Logger,
  ) {}
}
```

## Null Coalescing and Default Values

Prefer modern operators like `??` and optional chaining for defaults.

**GOOD:**

```typescript
const value = input ?? defaultValue
const config = options?.config ?? {}
```

**BAD:**

```typescript
const value = input || defaultValue // incorrect for falsy values like 0 or ""
const config = (options && options.config) || {} // too verbose
```

## Async and Await

Favor `async` and `await` over promise chains for readability.
Always await promises even when returning, do not "passthrough" unawaited promises.

**Examples:**

**GOOD:**

```typescript
async function processData(): Promise<Result> {
  const data = await fetchData()
  const transformed = await transformData(data)

  return await saveData(transformed)
}
```

**BAD:**

```typescript
function processData(): Promise<Result> {
  return fetchData()
    .then(data => transformData(data))
    .then(transformed => saveData(transformed))
}
```

**BAD:**

```typescript
function processData(): Promise<Result> {
  return someAsyncOperation() // missing await
}
```

## Early Returns

Use early exits to reduce nesting and clarify control flow.
The main logic should be at the base indentation level,
while guards and error checks should have their own blocks above.

**GOOD:**

```typescript
async function updateUsage(projectId: string, usage: ArtifactUsage): Promise<void> {
  if (artifactIds.length === 0 || usages.length === 0) {
    return
  }

  const artifact = artifacts[artifactId]
  if (!artifact) {
    this.logger.warn({ projectId }, `artifact "%s" not found`, artifactId)
    return
  }

  await this.doWork(projectId, artifact, usage)
}
```

**BAD:**

```typescript
async function updateUsage(projectId: string, usage: ArtifactUsage): Promise<void> {
  // where the main logic?
  if (artifactIds.length > 0 && usages.length > 0) {
    const artifact = artifacts[artifactId]
    if (artifact) {
      // oh, it's here, not very clear
      await this.doWork(projectId, artifact, usage)
    } else {
      this.logger.warn({ projectId }, `artifact "%s" not found`, artifactId)
    }
  }
}
```

## Function Documentation

- Document public methods with full JSDoc sentences and parameter descriptions.
- Place each sentence on its own line.
- Split the description to multiple paragraphs if needed.
- Params must be documented with `@param` tags without "-" and shoult also be complete sentences.
- Private methods typically do not need JSDoc unless they implement complex logic.

**GOOD:**

```typescript
/**
 * Updates the worker registrations for the given project and instance.
 *
 * It creates new registrations for each unit worker, updates existing ones,
 * and deletes registrations that are no longer present.
 *
 * @param projectId The ID of the project.
 * @param instanceId The ID of the instance.
 * @param unitWorkers The list of unit workers to register.
 * @returns A new mapping of unit worker names to their registration IDs.
 */
async updateUnitRegistrations(
  projectId: string,
  instanceId: string,
  unitWorkers: UnitWorker[],
): Promise<Record<string, string>> {
  // implementation
}
```

**BAD:**

```typescript
/**
 * Updates worker registrations
 * @param projectId - project id
 * @param instanceId - instance id
 * @returns mapping
 */
async updateUnitRegistrations(projectId: string, instanceId: string): Promise<Record<string, string>> {
  // implementation
}
```

## Type Safety and Generics

Lean on TypeScript's type system and constrain generics.
Do not even think about using `any`.

Note: `any` is allowed for complex cases with exclicit `/** biome-ignore-all lint/suspicious/noExplicitAny: explanation */` or `// biome-ignore lint/suspicious/noExplicitAny: explanation` comments.

**GOOD:**

```typescript
function getOrCreate<T>(cache: Map<string, T>, key: string, factory: (key: string) => T): T {
  return cache.get(key) ?? cache.set(key, factory(key)).get(key)!
}
```

**BAD:**

```typescript
function getOrCreate(cache: any, key: string, factory: Function): any {
  return cache.get(key) || cache.set(key, factory(key)).get(key)
}
```

## Method Chaining and Fluent APIs

Format fluent chains for clarity and force splits with `//` when needed.
Biome (and Prettier) will try to keep lines under 100 characters,
but it is not consistent enough for our liking.
When a line exceeds 100 characters, break after each call in the chain.

**GOOD:**

```typescript
const filtered = items
  .filter(item => item.isValid)
  .map(item => this.transform(item))
  .sort((a, b) => a.name.localeCompare(b.name))

// forces formatter to break after each argument
this.stateUnlockService.registerUnlockTask(
  //
  "process-lost-operations",
  projectId => this.processLostOperations(projectId),
)

// no need for "//" here, line is under 100 chars and breaks naturally
this.someLongService.registerImportantHandler(
  "very-long-task-name-that-makes-the-line-exceed-100-characters",
  projectId => this.processLostOperations(projectId),
)
```

**BAD:**

```typescript
const filtered = items.filter(item => item.isValid).map(item => this.transform(item))

// without forced breaks, formatter might keep everything on one line
// looks terrible, isn't it?
this.stateUnlockService.registerUnlockTask("process-lost-operations", projectId =>
  this.processLostOperations(projectId),
)

this.someLongService.registerImportantHandler(
  //
  "very-long-task-name-that-makes-the-line-exceed-100-characters",
  projectId => this.processLostOperations(projectId),
)
```

## Error Handling

- Catch and rethrow with context while preserving the original cause.
- Use `cause` to wrap errors instead of embedding messages.
- Keep errors capitalized without punctuation and surround identifiers with double quotes.

**GOOD:**

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  throw new Error(`Failed to process operation "${operationId}"`, { cause: error })
}
```

**BAD:**

```typescript
try {
  await operation()
} catch (error) {
  throw new Error(`Failed to update instance ${instanceId}: ${error.message}.`)
}
```

## Logging

We use `pino` for structured logging.

- Log messages must be lowercase without punctuation.
- Surround identifiers with double quotes and pass structured context first.
- Pass variables as parameters instead of embedding them in the message.
- Do not overuse context object, only include relevant data.
- Use `createProjectLogger` instead of passing `projectId` manually.
- Pass errors via the `error` key in the context object.

**GOOD:**

```typescript
const logger = createProjectLogger(this.logger, projectId)

logger.info(
  `updating worker registration "%s" for unit worker "%s" (params changed)`,
  registration.id,
  unitWorker.name,
)

logger.error({ error }, `failed to process operation "%s"`, operationId)
```

**BAD:**

```typescript
this.logger.error({ err, projectId }, `Failed to process operation for project ${projectId}.`)
```

## Inline Comments

Use inline comments only to explain non-obvious code.
Avoid comments that state the obvious or repeat what the code does.

Inline comments should be fragments written in lowercase without punctuation.
They may start with numbering to help break down complex logic.

Inline comments may also be a blocks of full sentences if they explain a complex algorithm or reasoning.
But single sentences must be fragments as per above.

**GOOD:**

```typescript
// calculate affected instances in multiple phases
// 1. extend requested ids with dependencies
for (const instanceId of this.operation.requestedInstanceIds) {
  if (this.operation.type === "update") {
    // Here we traverse the instance dependencies recursively,
    // because an update to one instance may require updates to its dependencies.
    // Some other smart explanation why we do this.
    // Just an example, this one is obvious enough to not need comments.
    await traverse(instanceId)
  }

  this.instanceIdsToUpdate.add(instanceId)
}

// 2. extend ids with children of affected composites
const compositeInstanceQueue = Array.from(this.instanceIdsToUpdate)
while (compositeInstanceQueue.length > 0) {
  const childId = compositeInstanceQueue.pop()!
  /// omited for brevity
}
```

**BAD:**

```typescript
// Calculate affected instances in multiple phases.
// 1. Extend requested IDs with dependencies.
for (const instanceId of this.operation.requestedInstanceIds) {
  // Check if operation type is update
  if (this.operation.type === "update") {
    // Traverse the instance
    await traverse(instanceId)
  }
  // Add instance ID to update set
  this.instanceIdsToUpdate.add(instanceId)
}
```

## Line Breaks and Visual Spacing

- Group related operations and add breathing room between distinct blocks.
- Leave blank lines after guard clauses, between loops, and around multiline calls.
- Do not clump statements together or over-space compact structures.

**GOOD:**

```typescript
const state = this.stateMap.get(instanceKey)
if (!state) {
  return
}

const dependentIds = this.dependentStateIdMap.get(instanceKey) ?? []

for (const dependentId of dependentIds) {
  traverse(dependentId)
  this.instanceIdsToDestroy.add(dependentId)
}

if (!data.isValid) {
  throw new Error(`Invalid data for processing`)
}

this.process(data)

await this.instanceStateService.updateStateSecretNames(
  project.id,
  newInstanceId,
  oldDescriptors.map(descriptor => descriptor.secretName),
  [],
  true,
)

await this.instanceStateService.updateStateSecretNames(
  project.id,
  oldInstanceId,
  [],
  oldDescriptors.map(descriptor => descriptor.secretName),
  true,
)

// no spacing is fine here
const config = {
  inputs: {
    remoteL3Endpoints: {
      entity: l3EndpointEntity,
      multiple: true,
      required: false,
    },
    remoteL4Endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
      required: false,
    },
  },
  outputs: {
    repo: repositoryEntity,
  },
}
```

**BAD:**

```typescript
// just look at this mess
const state = this.stateMap.get(instanceKey)
if (!state) {
  return
}
const dependentIds = this.dependentStateIdMap.get(instanceKey) ?? []
for (const dependentId of dependentIds) {
  traverse(dependentId)
  this.instanceIdsToDestroy.add(dependentId)
}
if (!data.isValid) {
  throw new Error("Invalid data.")
}
this.process(data)
await this.instanceStateService.updateStateSecretNames(
  project.id,
  newInstanceId,
  oldDescriptors.map(descriptor => descriptor.secretName),
  [],
  true,
)
await this.instanceStateService.updateStateSecretNames(
  project.id,
  oldInstanceId,
  [],
  oldDescriptors.map(descriptor => descriptor.secretName),
  true,
)
```
