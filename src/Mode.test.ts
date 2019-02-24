import { Mode } from "back-to-the-fixture";

describe("Mode", () => {
  it("should export available modes", () => {
    expect(Mode).toEqual({ LIVE: "live", RECORD: "record", REPLAY: "replay" });
  });
});
