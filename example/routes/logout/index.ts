import * as express from "express";

import session from "../session";

export default express()
  .use(session)
  .use((req: express.Request, res: express.Response, next) => {
    res.clearCookie("node-recorder-example");
    res.redirect("/");
  });
