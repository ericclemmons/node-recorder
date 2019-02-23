![Back to the Fixture](./logo.jpg)

> Simple recording &amp; replaying of HTTP requests for predictable development &amp; testing.

## Example

Given a GraphQL server:

```js
import { Recorder } from "back-to-the-fixture";

export default graphql((req: Request, res: Response) => {
  // 👇Pull ?mode=record or ?mode=replay
  const { mode } = req.query;

  // 👇Create a recorder for this request
  new Recorder({ mode });

  return {
    graphiql: true,
    pretty: true,
    schema
  };
});
```

- **Record** network calls – <http://localhost:3000/?mode=record>
- **Replay** network calls - <http://localhost:3000/?mode=replay>

## Installation

```shell
yarn add --dev back-to-the-fixture
```
