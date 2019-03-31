import { createCipher } from "crypto";
import { Request, Response } from "express";

export default (req: Request, res: Response) => {
  const payload = JSON.stringify({ authenticated: true });

  const cipher = createCipher("aes256", "password");
  const access_token = cipher
    .update(payload, "utf8", "hex")
    .concat(cipher.final("hex"));

  res.json({ access_token });
};
