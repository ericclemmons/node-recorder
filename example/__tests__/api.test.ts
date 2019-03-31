import { resolve } from "path";
// @ts-ignore
import { polydev } from "polydev";
import * as request from "supertest";

const app = polydev({
  routes: resolve(__dirname, "../routes")
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
      const res = await request(app).get("/oauth/token");

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
        .expect(200, { authenticated: true });
    });
  });
});
