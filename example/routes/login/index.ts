import * as express from "express";
import session from "../session";

export default express()
  .use(session)
  .use((req: express.Request, res: express.Response, next) => {
    const session = req.session as any;

    session.authenticated = true;
    res.redirect("/");
  });
