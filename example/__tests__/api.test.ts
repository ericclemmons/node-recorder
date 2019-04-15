import { resolve } from "path";
import * as request from "supertest";

const { polydev } = require("polydev");

const app = polydev({
  routes: resolve(__dirname, "../routes")
});

const getUserToken = (username?: string) =>
  request(app)
    .get("/oauth/token")
    .query({ username });

describe("/oauth/token", () => {
  it("should return a 400", () => {
    return getUserToken().expect(400, "Missing ?username");
  });

  describe("with ?username", () => {
    it("should return an access token", () => {
      return getUserToken("test@example.com").expect(200);
    });
  });
});

describe("/api", () => {
  describe("without an access_token", () => {
    it("should return a 403", () => {
      return request(app)
        .get("/api")
        .expect(403, "Forbidden");
    });
  });

  describe("with an access_token", () => {
    let access_token: string;

    beforeAll(async () => {
      const res = await getUserToken("test@example.com");

      access_token = res.body.access_token;
    });

    it("should work with ?access_token", () => {
      return request(app)
        .get("/api")
        .query({ access_token })
        .expect(200);
    });

    it("should work with Authorization header", () => {
      return request(app)
        .get("/api")
        .set("Authorization", `Bearer ${access_token}`)
        .expect(200, { authenticated: true, username: "test@example.com" });
    });
  });
});
