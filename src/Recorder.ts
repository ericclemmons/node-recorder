import * as boxen from "boxen";
import * as cosmiconfig from "cosmiconfig";
import * as fs from "fs";
import * as http from "http";
import * as mkdirp from "mkdirp";
import * as nock from "nock";
import * as path from "path";
import * as zlib from "zlib";
import * as URL from "url-parse";

import { log } from "./log";
import { Mode } from "./Mode";

const fnv1a = require("@sindresorhus/fnv1a");
const chalk = require("chalk");

// Cannot use `Symbol` here, since it's referentially different
// between the dist/ & src/ versions.
const IS_STUBBED = "IS_STUBBED";
const REQUEST_ARGUMENTS = new WeakMap();

interface Config {
  mode?: Mode;
  fixturesPath?: string;
  normalizers?: Normalizer[];
}

interface Identifier {
  (request: NormalizedRequest, response?: ResponseFixture):
    | undefined
    | string
    | [string, string];
}

interface NormalizedRequest extends RequestFixture {
  url: URL;
}

// TODO Use { request, response, url } to avoid mudying the request
interface Normalizer {
  (request: NormalizedRequest, response?: ResponseFixture): void;
}

enum Methods {
  DELETE = "DELETE",
  GET = "GET",
  HEAD = "HEAD",
  MERGE = "MERGE",
  OPTIONS = "OPTIONS",
  PATCH = "PATCH",
  POST = "POST",
  PUT = "PUT"
}

// A more relaxed version of http.ReuestOptions
interface RequestOptions extends http.RequestOptions {
  href?: string;
  proto?: string;
}

interface RequestFixture {
  method: Methods;
  href: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface ResponseFixture {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: object | string;
}

interface Fixture {
  request: RequestFixture;
  response: ResponseFixture;
}

interface InterceptedRequest {
  body: string;
  headers: http.IncomingHttpHeaders;
  method: Methods;
  options: RequestOptions;
  req: http.ClientRequest;
  respond: nock.ReplyCallback;
}

const explorer = cosmiconfig("recorder", {
  searchPlaces: ["recorder.config.js"]
});

// ! nock overrides http methods upon require. Restore to normal before starting.
nock.restore();

export class Recorder {
  ClientRequest = http.ClientRequest;

  // TODO Move this to `config`
  fixturesPath = path.resolve(process.cwd(), "__fixtures__");
  mode?: Mode;
  identifier?: Identifier;
  identities = new Map();
  normalizers: Normalizer[] = [];

  constructor() {
    // @ts-ignore
    if (this.ClientRequest[IS_STUBBED]) {
      log(
        "back-to-the-fixture has already stubbed nock, so there are multiple versions running!"
      );

      return;
    }

    const result = explorer.searchSync();

    if (result && result.config) {
      this.configure(result.config as Config);
    }

    if (!this.mode) {
      const {
        CI,
        // Default to REPLAY in CI, RECORD otherwise
        RECORDER_MODE = CI ? Mode.REPLAY : Mode.RECORD
      } = process.env;

      this.configure({ mode: RECORDER_MODE as Mode });
    }

    if (process.env.RECORDER_ACTIVE) {
      log("back-to-the-fixture already active");
      return;
    }

    this.setupNock();
    this.patchNock();

    process.env.RECORDER_ACTIVE = "true";
  }

  configure = (config: Config) => {
    const changedMode = "mode" in config && config.mode !== this.mode;

    Object.assign(this, config);

    if (changedMode) {
      const modeEnum = this.getModeEnum();

      const message = [
        chalk.keyword("orange").underline("back-to-the-fixture"),
        ": ",
        chalk.keyword("yellow").inverse(` ${modeEnum} `)
      ].join("");

      console.log(
        boxen(message, {
          align: "center",
          borderStyle: boxen.BorderStyle.Round,
          dimBorder: true,
          margin: 1,
          padding: 1
        })
      );
    }
  };

  getFixture = (interceptedRequest: InterceptedRequest): Fixture => {
    const { request } = this.normalize(interceptedRequest) as Fixture;
    const fixturePath = this.getFixturePath(request);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

    return fixture;
  };

  getFixturePath(request: RequestFixture): string {
    const { href } = request;
    const url = new URL(href, true);
    const { hostname, pathname } = url;

    if (!hostname) {
      throw new Error(
        `Cannot parse hostname from fixture's "href": ${JSON.stringify(href)}`
      );
    }

    if (!pathname) {
      throw new Error(
        `Cannot parse pathname from fixture's "href": ${JSON.stringify(href)}`
      );
    }

    const hash = fnv1a(JSON.stringify(request));
    const identity = this.identify(request);
    const filename = identity ? `${hash}-${identity}` : hash;

    const fixturePath = path.join(
      this.fixturesPath,
      hostname,
      pathname,
      `${filename}.json`
    );

    return fixturePath;
  }

  getHrefFromOptions(options: RequestOptions) {
    if (options.href) {
      return options.href;
    }

    const protocol = options.protocol || `${options.proto}:` || "http:";
    const host = options.hostname || options.host || "localhost";
    const { path, port } = options;

    const url = new URL("", true);

    url.set("protocol", protocol);
    url.set("host", host);
    url.set("pathname", path);

    if (
      port &&
      !host.includes(":") &&
      (port !== 80 || protocol !== "http:") &&
      (port !== 443 || protocol !== "https:")
    ) {
      url.set("port", port);
    }

    return url.href;
  }

  getModeEnum() {
    return Object.keys(Mode).find(
      (key) => Mode[key as keyof typeof Mode] === this.mode
    );
  }

  handleRequest = (interceptedRequest: InterceptedRequest) => {
    const { mode } = this;

    switch (mode) {
      case Mode.IGNORE:
        return this.ignoreRequest(interceptedRequest);

      case Mode.RECORD:
        return this.recordRequest(interceptedRequest);

      case Mode.RERECORD:
        return this.rerecordRequest(interceptedRequest);

      case Mode.REPLAY:
        return this.replayRequest(interceptedRequest);

      default:
        throw new Error(`Mode.${mode} is not supported`);
    }
  };

  handleResponse = (
    interceptedRequest: InterceptedRequest,
    fixture: Fixture
  ) => {
    const { respond } = interceptedRequest;
    const { request, response } = fixture;
    const { body, headers, statusCode } = response;

    this.identify(request, response);

    respond(null, [statusCode, body, headers]);
  };

  identify(request: RequestFixture, response?: ResponseFixture) {
    if (!this.identifier) {
      return;
    }

    const { href } = request;
    const url = new URL(href, true);

    const result = this.identifier(
      {
        ...request,
        url
      },
      response
    );

    if (!result) {
      return;
    }

    log(`Custom identifier returned %O for %O`, result, { request, response });

    if (Array.isArray(result)) {
      const [identity, token] = result;

      if (!token) {
        throw new Error(`Custom identifier returned ${JSON.stringify(result)}`);
      }

      this.identities.set(token, identity);

      return identity;
    }

    if (typeof result === "string") {
      const identity = this.identities.get(result);

      if (!identity) {
        log("No identities associated with %O", result);
        return;
      }

      return identity;
    }

    throw new Error(
      'identifier() should return ["identity", "token"] or "token"'
    );
  }

  ignore() {
    this.configure({ mode: Mode.IGNORE });
  }

  async ignoreRequest(interceptedRequest: InterceptedRequest) {
    const { respond } = interceptedRequest;
    const { body, headers, statusCode } = await this.makeRequest(
      interceptedRequest
    );

    respond(null, [statusCode, body, headers]);
  }

  async makeRequest(
    interceptedRequest: InterceptedRequest
  ): Promise<ResponseFixture> {
    const { body, headers, method, options } = interceptedRequest;

    const request = new this.ClientRequest({
      ...options,
      method,
      headers
    });

    const responsePromise = new Promise((resolve, reject) => {
      request.once("response", resolve);
      request.once("error", reject);
      request.once("timeout", reject);
    });

    request.write(body);
    request.end();

    const response = (await responsePromise) as http.IncomingMessage;
    const responseBody = await new Promise((resolve, reject) => {
      const chunks: any[] = [];

      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        const { headers } = response;

        // GitHub sends compressed, chunked payloads
        if (
          headers["content-encoding"] === "gzip" &&
          headers["transfer-encoding"] === "chunked"
        ) {
          const decoded = Buffer.concat(chunks);
          const unzipped = zlib.gunzipSync(decoded).toString("utf8");

          // TODO Is this the correct thing to do?
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];

          try {
            const json = JSON.parse(unzipped);

            // TODO Is this safe to assume?
            headers["content-encoding"] = "application/json";
            return resolve(json);
          } catch (error) {
            return resolve(unzipped);
          }

          return resolve(unzipped);
        }

        const body = Buffer.concat(chunks).toString("utf8");

        // Simple services oftent send "application/json; charset=utf-8"
        if (
          headers["content-type"] &&
          headers["content-type"].startsWith("application/json")
        ) {
          try {
            return resolve(JSON.parse(body));
          } catch (error) {
            console.warn(error);
          }
        }

        return resolve(body);
      });

      response.once("error", reject);
    });

    return {
      statusCode: response.statusCode as number,
      headers: response.headers,
      body: responseBody
    };
  }

  normalize(
    interceptedRequest: InterceptedRequest,
    response?: ResponseFixture
  ) {
    // Poor-man's clone for immutability
    const request = JSON.parse(JSON.stringify(interceptedRequest));
    const { body, headers, method, options } = request;
    const href = this.getHrefFromOptions(options);
    const url = new URL(href, true);

    // fThis is redundant with `href`, so why should we keep it?
    delete request.headers.host;

    // Remove ephemeral ports from superagent testing
    if (
      headers["user-agent"] &&
      headers["user-agent"].startsWith("node-superagent")
    ) {
      url.set("port", undefined);
    }

    const fixture = {
      request: { method, href, headers, body, url },
      response
    };

    this.normalizers.forEach((normalizer) => {
      normalizer(fixture.request, fixture.response);
    });

    // Update href to match url object
    fixture.request.href = fixture.request.url.toString();

    // Don't save parsed url
    delete fixture.request.url;

    return fixture;
  }

  record() {
    this.configure({ mode: Mode.RECORD });
  }

  async recordRequest(request: InterceptedRequest) {
    const { respond } = request;

    try {
      // TODO hasFixture
      const fixture = this.getFixture(request);
      const { statusCode, body, headers } = fixture.response;
      log("Replaying fixture %o", fixture.request.href);

      return respond(null, [statusCode, body, headers]);
    } catch (error) {
      return this.rerecordRequest(request);
    }
  }

  replay() {
    this.configure({ mode: Mode.REPLAY });
  }

  async replayRequest(interceptedRequest: InterceptedRequest) {
    const { req } = interceptedRequest;

    try {
      const fixture = await this.getFixture(interceptedRequest);

      return this.handleResponse(interceptedRequest, fixture);
    } catch (error) {
      req.emit("error", error);
    }
  }

  rerecord() {
    this.configure({ mode: Mode.RERECORD });
  }

  async rerecordRequest(request: InterceptedRequest) {
    const { respond } = request;
    const response = await this.makeRequest(request);
    const { statusCode, body, headers } = response;

    // Respond with *real* response for recording, not fixture.
    respond(null, [statusCode, body, headers]);

    const fixture = this.normalize(request, response) as Fixture;
    process.nextTick(() => this.saveFixture(fixture));
  }

  patchNock() {
    // This is Nock's `OverriddenClientRequest`
    const { ClientRequest } = http;

    // @ts-ignore
    http.ClientRequest = function recordClientRequest(
      url: string | URL | http.ClientRequestArgs,
      cb?: (res: http.IncomingMessage) => void
    ) {
      const req = new ClientRequest(url, cb);

      REQUEST_ARGUMENTS.set(req, [url, cb]);

      return req;
    };

    // We need a way to tell that we've already overridden nock.
    // @ts-ignore
    http.ClientRequest[IS_STUBBED] = true;
  }

  saveFixture(fixture: Fixture) {
    const fixturePath = this.getFixturePath(fixture.request);
    const serialized = JSON.stringify(fixture, null, 2);

    log("Recording fixture %o", fixturePath);

    mkdirp.sync(path.dirname(fixturePath));
    fs.writeFileSync(fixturePath, serialized);
  }

  setupNock() {
    nock.restore();
    nock.cleanAll();

    const interceptor = nock(/.*/).persist();
    const recorder = this;

    Object.keys(Methods).forEach((m) => {
      interceptor
        .intercept(/.*/, m)
        .reply(async function reply(uri, body, respond) {
          // @ts-ignore
          const { method, req } = this as any;
          const { headers } = req;
          const [options] = REQUEST_ARGUMENTS.get(req);

          const interceptedRequest: InterceptedRequest = {
            body,
            headers,
            method,
            options,
            req,
            respond: respond as nock.ReplyCallback
          };

          recorder.handleRequest(interceptedRequest);
        });
    });

    nock.activate();
  }
}
