import { Request } from "express";
import { Context, Query, SchemaRoot } from "typegql";

import { GitHub } from "./GitHub";

@SchemaRoot()
export class API {
  @Query()
  github(): GitHub {
    return new GitHub();
  }

  @Query()
  ip(@Context req: Request): string {
    return req.ip;
  }
}
