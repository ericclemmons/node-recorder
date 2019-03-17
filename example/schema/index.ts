import "reflect-metadata";

import { compileSchema } from "typegql";

import { API } from "./API";

export const schema = compileSchema({ roots: [API] });
