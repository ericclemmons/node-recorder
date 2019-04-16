import { resolve } from "path";
import * as request from "supertest";

const { polydev } = require("polydev");

const app = polydev({
  routes: resolve(__dirname, "../routes")
});

describe("/login", () => {
  it("should set a cookie", async () => {
    return request
      .agent(app)
      .get("/login")
      .expect((res) => expect(res.get("Set-Cookie")).toHaveLength(1))
      .expect(302, "Found. Redirecting to /");
  });
});

describe("/logout", () => {
  it("should remove a cookie", async () => {
    const agent = request.agent(app);

    await agent.get("/login");

    return agent
      .get("/logout")
      .expect(
        "set-cookie",
        "node-recorder-example=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
      )
      .expect(302, "Found. Redirecting to /");
  });
});

describe("/graphql", () => {
  it("should return a 403", async () => {
    return request(app)
      .post("/graphql")
      .expect(403);
  });

  describe("with a cookie", () => {
    it("should return a 200", async () => {
      const agent = request.agent(app);

      await agent.get("/login");

      return agent
        .post("/graphql")
        .send({
          query: `{
            github {
              rateLimit {
                limit
                remaining
              }
            }
          }`
        })
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchInlineSnapshot(
            {},
            `
            Object {
              "data": Object {
                "github": Object {
                  "rateLimit": Object {
                    "limit": 60,
                    "remaining": 57,
                  },
                },
              },
            }
          `
          );
        });
    });
  });
});
