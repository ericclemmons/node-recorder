import { ObjectType, Field } from "typegql";

interface RateLimitOptions {
  limit: number;
  remaining: number;
}

@ObjectType()
export class RateLimit {
  @Field()
  limit: number;

  @Field()
  remaining: number;

  constructor(options: RateLimitOptions) {
    this.limit = options.limit;
    this.remaining = options.remaining;
  }
}
