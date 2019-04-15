import * as express from "express";
import * as graphql from "express-graphql";

import { schema } from "../../schema";
import session from "../session";

export default express()
  .use(session)
  .use(
    graphql((req, res) => {
      return {
        graphiql: true,
        pretty: true,
        schema
      };
    })
  );
