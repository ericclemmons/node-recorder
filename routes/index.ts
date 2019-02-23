import * as graphql from "express-graphql";

import { schema } from "./schema";

export default graphql({
  graphiql: true,
  pretty: true,
  schema
});
