import { Mode, Recorder } from "back-to-the-fixture";
import { readFileSync } from "fs";
import fetch from "node-fetch";

describe("Recorder", () => {
  describe("replay", () => {
    it("should return fixture", async () => {
      const recorder = new Recorder({ mode: Mode.REPLAY });

      const res = await fetch("https://api.github.com/rate_limit");
      const json = await res.json();

      // TODO Can this map the fetch call!?
      const call = {
        scope: "https://api.github.com:443",
        method: "GET",
        path: "/rate_limit",
        body: ""
      };

      const fixture = JSON.parse(
        readFileSync(recorder.getFixturePath(call), "utf8")
      );

      expect(json).toEqual(fixture.response);
    });
  });
});
