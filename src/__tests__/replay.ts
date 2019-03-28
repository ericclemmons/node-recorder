import { recorder } from "back-to-the-fixture";
import fetch from "node-fetch";

recorder.replay();

describe("record", () => {
  it("should record", async () => {
    const res = await fetch("https://randomuser.me/api");
    const person = await res.json();

    expect(person).toMatchSnapshot();
  });
});
