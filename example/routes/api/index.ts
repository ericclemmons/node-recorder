import { createDecipher } from "crypto";
import * as express from "express";

function getAccessTokenFromHeader(authorization: string | undefined) {
  if (!authorization) {
    return null;
  }

  const [, token] = authorization.split(" ");

  return token;
}

const oauth = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const {
    access_token = getAccessTokenFromHeader(req.get("authorization"))
  } = req.query;

  if (!access_token) {
    return res.sendStatus(403);
  }

  const decipher = createDecipher("aes256", "password");
  const decrypted = decipher
    .update(access_token, "hex", "utf8")
    .concat(decipher.final("utf8"));

  Object.assign(res.locals, JSON.parse(decrypted));

  next();
};

export default express()
  .use(oauth)
  .use((req, res) => {
    res.json(res.locals);
  });
