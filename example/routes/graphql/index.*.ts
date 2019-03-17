import { recorder } from "back-to-the-fixture";
import * as express from "express";
import * as graphql from "express-graphql";

import { schema } from "../../schema";
import session from "../session";

export default express()
  .use(session)
  .use(
    graphql((req, res) => {
      const { mode } = req.query;

      recorder.configure({ mode });

      return {
        graphiql: true,
        pretty: true,
        schema
      };
    })
  );
