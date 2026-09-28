# Mermaid Preview Rendering Fixture

> **Fixture only:** use this document to visually validate Mermaid diagram rendering in the preview. Switch between the Light, Dark, and Auto themes, and between split and inline views. Each diagram should render in every pane.

This paragraph has a deliberate typo so analysis has something to sugest next to the diagrams.

## Flowchart

```mermaid
flowchart LR
  A[Open a draft] --> B{Run analysis?}
  B -->|Yes| C[Review suggestions]
  B -->|No| D[Keep writing]
  C --> E((Apply))
  D --> A
```

## Flowchart with subgraphs and styles

```mermaid
flowchart TB
  subgraph Editor
    source[Markdown source] --> webview[Review webview]
  end
  subgraph CLI[Local AI CLI]
    claude[Claude] & codex[Codex] & copilot[Copilot]
  end
  webview -. analyze .-> CLI
  CLI == suggestions ==> webview
  classDef accent fill:#fde68a,stroke:#b45309,color:#1f2937
  class webview accent
```

## Sequence diagram

```mermaid
sequenceDiagram
  autonumber
  actor Writer
  participant Ext as sharp-pen
  participant AI as AI CLI
  Writer->>Ext: Analyze
  activate Ext
  Ext->>AI: Prompt with draft
  AI-->>Ext: Level 1 and Level 2 suggestions
  deactivate Ext
  Note over Writer,Ext: Accept, reject, or pick an alternative
  alt Accepted
    Writer->>Ext: Apply
  else Rejected
    Writer->>Ext: Reset
  end
```

## Class diagram

```mermaid
classDiagram
  class Suggestion {
    +string id
    +int start
    +int end
    +string[] options
    +accept(index) void
  }
  class Review {
    +Suggestion[] level1
    +Suggestion[] level2
    +apply() string
  }
  Review "1" *-- "many" Suggestion
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> Empty
  Empty --> Analyzing: Analyze
  Analyzing --> Ready: Suggestions received
  Analyzing --> Error: CLI failed
  Ready --> Modified: Source edited
  Modified --> Analyzing: Re-analyze
  Ready --> Applied: Apply
  Applied --> [*]
```

## Entity relationship diagram

```mermaid
erDiagram
  DOCUMENT ||--o{ REVIEW : has
  REVIEW ||--|{ SUGGESTION : contains
  SUGGESTION {
    string id
    int start
    int end
  }
```

## Gantt chart

```mermaid
gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Preview
  Mermaid rendering   :done,    m1, 2026-09-21, 5d
  Fixture document    :active,  m2, after m1, 2d
  section Release
  Marketplace publish :         m3, after m2, 1d
```

## Pie chart

```mermaid
pie title Suggestions by level
  "Level 1" : 42
  "Level 2" : 17
```

## Git graph

```mermaid
gitGraph
  commit id: "0.1.0"
  commit id: "0.1.1"
  branch feat/mermaid-preview
  checkout feat/mermaid-preview
  commit id: "mermaid"
  commit id: "fixture"
  checkout main
  merge feat/mermaid-preview
```

## Mindmap

```mermaid
mindmap
  root((sharp-pen))
    Preview
      Markdown
      Mermaid
      Themes
    Review
      Level 1
      Level 2
    Clients
      Claude
      Codex
      Copilot
```

## Timeline

```mermaid
timeline
  title sharp-pen milestones
  Skill : Claude review skill
  Extension : VS Code extension 0.1.0 : Marketplace screenshots 0.1.1
  Preview : Mermaid diagrams
```

## User journey

```mermaid
journey
  title Reviewing a draft
  section Write
    Draft the text: 4: Writer
  section Review
    Run analysis: 3: Writer, AI
    Pick suggestions: 5: Writer
```

## Quadrant chart

```mermaid
quadrantChart
  title Suggestion triage
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Plan
  quadrant-2 Do now
  quadrant-3 Skip
  quadrant-4 Maybe
  Typo fix: [0.1, 0.8]
  Restructure section: [0.8, 0.9]
  Swap synonym: [0.2, 0.2]
```

## XY chart

```mermaid
xychart-beta
  title "Suggestions per document"
  x-axis [draft1, draft2, draft3, draft4]
  y-axis "Suggestions" 0 --> 30
  bar [12, 25, 8, 17]
  line [12, 25, 8, 17]
```

## Long labels and special characters

```mermaid
flowchart LR
  A["Quotes: &quot;double&quot; and 'single'"] --> B["Ampersand & angle <brackets>"]
  B --> C["Unicode: åäö, emoji ✍️, math ∑"]
  C --> D["A deliberately long label that should wrap across several lines instead of overflowing the node"]
```

## Mermaid fence with metadata

The info string carries extra metadata after the language; it should still render.

```mermaid title="with metadata"
flowchart LR
  meta[Fence metadata] --> ok[Still renders]
```

## Uppercase language tag

```Mermaid
flowchart LR
  upper[MERMAID tag] --> same[Same renderer]
```

## Invalid diagram (expected fallback)

This block should show the "could not be rendered" message and its source.

```mermaid
flowchart LR
  A --> 
  this is not valid mermaid ((
```

## Empty mermaid fence (expected plain block)

```mermaid
```

## Non-mermaid code for comparison

```javascript
const diagram = "flowchart LR; A-->B";
console.log(diagram);
```

```text
flowchart LR
  A --> B
```

The text block above has diagram syntax but no mermaid tag, so it must stay as code.
