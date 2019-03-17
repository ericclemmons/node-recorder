import * as express from "express";

import session from "./session";

export default express()
  .use(session)
  .use((req, res, next) => {
    res.send(`
      <a href="/logout">Logout</a>
      <br />
      <a href="/graphql">GraphQL</a>
    `);
  });
