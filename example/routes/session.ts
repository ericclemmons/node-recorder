import * as express from "express";
import * as session from "express-session";

export default express()
  .use(
    session({
      name: "back-to-the-fixture-example",
      resave: false,
      saveUninitialized: false,
      secret: "secret"
    })
  )
  .use((req, res, next) => {
    const cookie = req.get("cookie") || "";

    if (
      !cookie.includes("back-to-the-fixture-example") &&
      req.path !== "/login"
    ) {
      return res.status(403).send(`<a href="/login">Login</a>`);
    }

    next();
  });
