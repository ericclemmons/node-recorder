import fetch from "node-fetch";
import { ObjectType, Field } from "typegql";

import { RateLimit } from "./RateLimit";

@ObjectType()
export class GitHub {
  @Field({ type: RateLimit })
  async rateLimit() {
    const res = await fetch("https://api.github.com/rate_limit");
    const { rate } = await res.json();

    return new RateLimit(rate);
  }
}
