# Documentation Style Guide

This guide establishes writing standards for Highstate documentation to ensure consistency and clarity.

## Tone and Voice

- Write in a conversational, approachable style
  - **Do:** "Alright, let's build something real - a blog application component"
  - **Do not:** "This section will demonstrate the implementation of a sample component"
- Include personality and light humor when it aids understanding
  - **Do:** "So... we are proud to introduce the concept of component"
- Explain complex concepts with simple analogies and relatable examples
  - **Do:** "Components are more like templates, blueprints, or classes in programming"
  - **Do not:** "Components represent abstracted infrastructure patterns utilizing standardized interfaces"
- Focus on practical implementation over theoretical benefits
  - **Do:** "Here's how to add arguments to make your blog configurable"
  - **Do not:** "Configurable components provide enhanced flexibility and maintainability"
- Engage readers with questions and direct involvement
  - **Do:** "But what the component actually is? What do we mean by `common.existing-server.v1`?"
  - **Do not:** "The following section will examine component definitions in detail"

## Grammar and Usage

- Address readers directly using "you"
  - **Do:** "You can create instances of components on a project canvas"
  - **Do not:** "Users may create instances on the project canvas"
- Use "we" when referring to the Highstate team
  - **Do:** "We try to keep these components small and focused"
  - **Do not:** "The development team maintains component modularity"
- Use contractions and informal language appropriately
  - **Do:** "We'll start simple and add features as we go"
- Write in present tense for current functionality
  - **Do:** "Highstate uses Pulumi as its IaC engine"
  - **Do not:** "Highstate has adopted Pulumi as its IaC engine"
- Use future tense only for planned features with clear timelines
  - **Do:** "We are planning to add a way to share entities between projects"
  - **Do not:** "Enhanced sharing capabilities will be available soon"
- Prefer active voice over passive voice
  - **Do:** "Components define a set of inputs and outputs"
  - **Do not:** "A set of inputs and outputs are defined by components"

## Document Structure

- Use engaging introduction titles that involve the reader
  - **Do:** "Explaining complex things simply", "Your First Component"
  - **Do not:** "Introduction", "Overview", "Getting Started"
- Help readers orient themselves before diving deep
  - **Do:** "If you haven't read the [concepts page](/concepts) yet, go there first! Here's a quick refresher:"
  - **Do not:** Jump directly into complex topics without context
- Keep paragraphs short (1-3 sentences)
  - **Do:** "In Highstate the component can be anything from a single server to a complex application stack.
    Depending on your needs, you can create components that are as simple or as complex as you want."
  - **Do not:** Dense paragraphs with 5+ sentences covering multiple concepts
- Build understanding progressively, one concept per section
  - **Do:** Introduce components, then instances, then entities in separate sections
  - **Do not:** Explain multiple unrelated concepts in the same section
- Show examples before explaining theory
  - **Do:** Show code snippet, then explain what it demonstrates
  - **Do not:** Explain theory first, then provide examples
- Use questions to transition between topics
  - **Do:** "But what the component actually is? What do we mean by `common.existing-server.v1`?"
  - **Do not:** Abrupt topic changes without transitions
- Cross-reference related concepts with links
  - **Do:** "Remember [entities from the concepts page](/concepts#entities)?"
  - **Do not:** Mention concepts without linking to their definitions
- Guide readers to related documentation or next steps
  - **Do:** "Ready to build your own components? Here's where to go:"
  - **Do not:** End documentation without clear progression paths
- Format markdown with one sentence per line for maintainer readability
  - **Do:** Write each sentence on its own line, keeping lines under 120 characters
  - **Do not:** Write long paragraphs as single lines or exceed the character limit

## Content Standards

- Avoid repetitive information within the same document
  - **Do:** "Remember [entities from the concepts page](/concepts#entities)?" (reference previous content)
  - **Do not:** Restate the same entity definition multiple times
- Use direct technical descriptions, not marketing language
  - **Do:** "A component that creates infrastructure resources"
  - **Do not:** "Secure, efficient, and compliant infrastructure management"
- Explain "why" with concise facts
  - **Do:** "We use TypeScript to define components. Why? Because you get type safety and IntelliSense"
  - **Do not:** "TypeScript provides numerous advantages including enhanced developer experience through
    comprehensive type checking and intelligent code completion capabilities"
- Include complete, functional code examples
  - **Do:** Show full working TypeScript component definitions
  - **Do not:** Show partial code snippets that won't compile
- Write content as authoritative reference material
  - **Do:** "Arguments are for configuration, not secrets!"
  - **Do not:** "Based on our analysis, we recommend avoiding secrets in arguments"

## List Formatting

### Standard Lists

Use this format for regular lists:

- Capitalize the first letter of each list item.
- No punctuation at the end of items (unless they are complete sentences).
- Use periods only for sentence-style lists.

**Examples:**

Simple list (fragments):

- Real-time collaboration
- Auto-save functionality
- Multi-language support
- Cloud synchronization

Sentence list:

- Components are reusable infrastructure patterns.
- Instances represent specific deployments of components.
- Entities define the data flowing between components.
- Projects contain and isolate groups of instances.

### Definition Lists

For term/definition pairs, use this format:

- **Bold term:** Regular description text
- No punctuation after the colon
- Capitalize first letter of description

**Example:**

- **Component:** A reusable, self-contained unit of infrastructure
- **Instance:** A specific deployment of a component with its own configuration
- **Entity:** Structured data that flows between components

## Interactive Elements

When using framework-specific features:

- Use snippet previews that demonstrate real functionality
  - **Do:** Show actual component instances that readers can interact with
  - **Do not:** Include non-working or placeholder examples
- Create self-contained interactive examples
  - **Do:** Examples that work without additional setup or dependencies
  - **Do not:** Examples requiring external configuration or services
- Provide clear navigation paths with card components
  - **Do:** "Learn how to create atomic building blocks that manage infrastructure resources"
  - **Do not:** Vague descriptions like "Learn more about units"
- Use callout blocks for essential information only
  - **Do:** Use tip blocks for critical concept definitions like "A component is a reusable, self-contained unit"
  - **Do not:** Overuse callouts for general information that belongs in regular text

## AI-Assisted Writing

We're transparent about using AI for documentation, but the output must feel human-written.
AI commonly "leaks" conversational context into the actual content.
The biggest problem is when AI mixes its response to the user with the documentation itself.

- Write direct information, not commentary about the document
  - **Do:** "Arguments are for configuration, not secrets!"
  - **Do not:** "This guide explains how arguments should be used for configuration rather than secrets"
- Avoid conversational phrases meant for the AI operator
  - **Do:** State facts directly
  - **Do not:** "Based on our analysis" or "as we discussed earlier"

The goal is documentation that reads naturally, as if written by someone who understands the technology.
AI should generate content that stands alone as useful information, not as a report about creating it.
