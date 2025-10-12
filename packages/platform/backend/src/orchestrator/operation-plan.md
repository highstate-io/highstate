# Operation Phase Calculation Model

## Overview

This document describes the unified model for calculating execution phases in Highstate operations. It covers the distinction between **operations** (user requests) and **phases** (execution units), and how different operation types are assembled from combinations of phases.

## Core Concepts

### Operations vs Phases

**Operations** are high-level user requests that define what should happen:

- `update`: Deploy or update requested instances
- `destroy`: Remove requested instances
- `recreate`: Remove and then redeploy requested instances
- `preview`: Calculate what would change without executing
- `refresh`: Refresh state information

**Phases** are atomic execution units that perform specific actions:

- `update phase`: Deploys/updates a set of instances in dependency order (also used for preview mode)
- `refresh phase`: Refreshes state information for a set of instances in dependency order (similar to update phase but without actual deployment changes)
- `destroy phase`: Removes a set of instances in reverse dependency order

### Operation Assembly

Different operation types are assembled from phases as follows:

**Update Operation:**

- Single `update phase` containing instances to be updated
- Optional `destroy phase` for ghost cleanup (if composites are being updated)

**Destroy Operation:**

- Single `destroy phase` containing instances to be destroyed

**Recreate Operation:**

- First a `destroy phase` containing instances to be destroyed
- Then an `update phase` containing the same instances to be recreated

**Preview Operation:**
- Single `update phase` calculated using update phase rules but not executed
- **Restriction**: Only allowed for "edge" instances (instances that depend on others but no instances depend on them)

**Refresh Operation:**
- Single `refresh phase` calculated using update phase rules for state refresh
- **Key difference**: No destroy phase is created, even if ghost cleanup would normally occur

## Phase Calculation Inputs

- **Requested instances**: User explicitly asked to operate on these
- **Instance states**: Current deployment status, input hashes, error conditions, parent relationships
- **Dependency graph**: Which instances depend on which others (forward for updates, reverse for destroys)
- **Composite hierarchy**: Parent-child relationships between composites and their contents
- **Options**: Force flags, partial operation settings, and cascade controls

## Phase Calculation Outputs

- **Update phase**: List of instances that will be updated, with reasons
- **Destroy phase**: List of instances that will be destroyed, with reasons

## Shared Phase Concepts

### Composite Classification

**Note**: These classifications are determined dynamically during operation planning, not fixed properties of the composite in the project model.

**A composite is substantive (for this operation) if:**

- It was explicitly requested by the user, OR
- It has at least one child included due to external dependencies (dependencies from outside the composite)

**A composite is compositional (for this operation) if:**

- It's only included because the user directly requested one of its children

### Instance States

**Outdated instance**: A **unit instance** that needs updating due to:

- **Undeployed**: Doesn't exist yet
- **Failed**: Has error status
- **Changed**: Input hash mismatch (out-of-date)

**Important**: **Composite instances cannot be outdated**. Composites are containers that organize other instances but don't have deployable state themselves. They don't participate in change tracking via input hash comparisons.

**Deployed instance**: Instance that exists and can be operated on

**Ghost instances**: Virtual instances with status other than undeployed that no longer exist in the composite's evaluation

### Common Options

1. `allowPartialCompositeInstanceUpdate` / `allowPartialCompositeInstanceDestruction`:
   When disabled (which is default), all **outdated unit** children of **substantive** composites are included. Otherwise, only children explicitly requested or required by dependencies are included.

2. `forceUpdateDependencies`: Forces inclusion of all dependencies regardless of their state
3. `destroyDependentInstances`: Forces inclusion of all dependents (instances that depend on destroyed instances)
4. `forceUpdateChildren`: Forces all children of substantive composites regardless of state

## Shared Phase Rules

### Message Assignment

Since composite instances cannot be directly depended upon, message conflicts are rare. The first assigned message is kept and subsequent messages are ignored.

### Propagation Rules

- **Substantive composite inclusions** trigger further dependency resolution and parent propagation
- **Compositional composite inclusions** do NOT trigger further propagation (boundary isolation)

### Ghost Cleanup Rules

**Ghost instances are processed if:**

- They are children of **substantive composites** being operated on, OR
- They are explicitly requested for operation (which means deletion for ghosts)

## Update Phase Rules

**Used by**: Update, Preview, and Refresh operations

**An instance is included in the update phase if ANY of these apply:**

1. **Explicitly requested** by the user

2. **Required dependency** of an included instance that:
   - Is outdated (units only - composites are never outdated), OR
   - Force dependencies flag is enabled

3. **Child of substantive composite** that:
   - Is outdated (units only) and partial update is disabled, OR
   - Force children flag is enabled

4. **Parent composite** of any included instance (automatically included with appropriate classification)

**Composite Instance Inclusion:** Composites are included purely for organizational purposes - to maintain the parent-child hierarchy during operations. They are included according to **substantive** or **compositional** classification rules, not because they themselves have changed or are outdated.

**Preview Operation Restriction:** For preview operations, only "edge" instances are allowed as requested instances. Edge instances are those that depend on others but have no instances depending on them.

**Note:** The final list must respect the dependency graph topology (all dependencies appear before their dependents)

## Destroy Phase Rules

**An instance is included in the destroy phase if ANY of these apply:**

1. **Explicitly requested** by the user

2. **Dependent cascade** of an included instance that:
   - Depends on the included instance, AND
   - destroyDependentInstances flag is enabled

3. **Child of substantive composite** that is being destroyed

4. **Parent composite** of any included instance (automatically included with appropriate classification)

5. **Ghost cleanup** during update operations:
   - Virtual ghost instances that no longer exist in composite evaluations

**Note:** The final list must respect the reverse dependency graph topology (all dependents appear before their dependencies).

## Refresh Phase Rules

**Used by**: Refresh operations

**An instance is included in the refresh phase if ANY of these apply:**

1. **Explicitly requested** by the user

2. **Required dependency** of an included instance when:
   - Force dependencies flag is enabled

3. **Child of substantive composite** that:
   - Is outdated (units only) and partial update is disabled, OR
   - Force children flag is enabled

4. **Parent composite** of any included instance (automatically included with appropriate classification)

**Key Differences from Update Phase:**

- **No Automatic Dependency Inclusion**: Unlike update operations, refresh operations do NOT automatically include outdated dependencies unless `forceUpdateDependencies` is enabled
- **No Ghost Cleanup**: Unlike update operations, refresh operations do NOT create destroy phases for ghost cleanup, even when substantive composites have ghost children
- **Phase Type**: Creates a `refresh` phase type instead of `update` phase type
- **State-Only Operation**: Intended for refreshing state information without making actual deployment changes

**Note:** The final list must respect the dependency graph topology (all dependencies appear before their dependents), similar to update phase rules.

## Execution Guarantees

Both update and destroy phases ensure:

- **Dependency Consistency**: No broken dependency relationships during execution
- **Composite Integrity**: Parent-child relationships remain valid during processing
- **Boundary Isolation**: Compositional composites don't trigger unintended propagation
- **User Intent**: Explicit requests are always honored while respecting safety constraints

**Note**: Circular dependencies are expected to be eliminated by the caller before phase calculation.
