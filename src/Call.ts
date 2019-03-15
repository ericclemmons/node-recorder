import { Fixture } from "./Fixture";

export interface Call extends Fixture {
  rawHeaders: string[];
}
