# Code Design

## Code Organization

1. Every function except `main.ts` should be pure. Pass any stateful information in parameters.

2. `misc.ts` should not depend on any other written code.

3. Each storage adapter should not depend on `syncEngine.ts`.

## File and Folder Representation

While writing sync codes, folders are always represented by a string ending with `/`.
