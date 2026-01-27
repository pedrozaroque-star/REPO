# TypeScript Safety Standards

## 1. Function Signature Integrity
**Rule:** When modifying a function call to include new arguments, usually for boolean flags (e.g., `refresh(true)`), you **MUST** verify and update the function definition signature first.

**Why:** TypeScript builds will fail in production even if local development seems to work, because strict mode does not allow passing arguments to functions defined with zero parameters.

**Example - DON'T:**
```typescript
// Definition
const refresh = () => { ... }

// Usage (Build Error)
refresh(true)
```

**Example - DO:**
```typescript
// Definition (Updated First)
const refresh = (force?: boolean) => { ... }

// Usage
refresh(true)
```

## 2. No Implicit Assumptions
**Rule:** Never assume an optional argument exists. Always read the component or function source code before modifying the invocation arguments.
