import * as cosmiconfig from "cosmiconfig";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as mkdirp from "mkdirp";
import * as nock from "nock";
import * as path from "path";
import * as zlib from "zlib";
import * as URL from "url-parse";

import { log } from "./log";
import { Mode } from "./Mode";

const fnv1a = require("@sindresorhus/fnv1a");

const REQUEST_ARGUMENTS = new WeakMap();

nock.restore();

interface Config {
  fixturesPath: string;
  normalizers: Normalizer[];
}

interface NormalizedRequest extends RequestFixture {
  url: URL;
}

interface Normalizer {
  (request: NormalizedRequest, response?: ResponseFixture): void;
}

enum Methods {
  GET = "GET",
  POST = "POST"
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

const { RECORDER_MODE = Mode.RECORD } = process.env;

const explorer = cosmiconfig("recorder", {
  searchPlaces: ["recorder.config.js"]
});

export class Recorder {
  fixturesPath = path.resolve(process.cwd(), "__fixtures__");
  httpRequest = http.request;
  httpsRequest = https.request;
  mode: Mode = RECORDER_MODE as Mode;
  normalizers: Normalizer[] = [];

  constructor() {
    this.loadConfig();

    if (!nock.isActive()) {
      this.setupNock();
      this.patchNock();
    }
  }

  configure = (config: Config) => {
    Object.assign(this, config);
  };

  getFixture = (interceptedRequest: InterceptedRequest): Fixture => {
    const { request } = this.normalize(interceptedRequest) as Fixture;
    const fixturePath = this.getFixturePath(request);

    return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  };

  getFixturePath(request: RequestFixture): string {
    const { href } = request;
    const { hostname, pathname } = new URL(request.href, true);

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

    const fixturePath = path.join(
      this.fixturesPath,
      hostname,
      pathname,
      `${hash}.json`
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
    const { body, headers, statusCode } = fixture.response;

    respond(null, [statusCode, body, headers]);
  };

  ignore() {
    this.mode = Mode.IGNORE;
  }

  async ignoreRequest(interceptedRequest: InterceptedRequest) {
    const { respond } = interceptedRequest;
    const { body, headers, statusCode } = await this.makeRequest(
      interceptedRequest
    );

    respond(null, [statusCode, body, headers]);
  }

  loadConfig() {
    const result = explorer.searchSync();

    if (result && result.config) {
      this.configure(result.config as Config);
    }
  }

  async makeRequest(
    interceptedRequest: InterceptedRequest
  ): Promise<ResponseFixture> {
    const { body, headers, method, options } = interceptedRequest;

    const request = (options.proto === "https"
      ? this.httpsRequest
      : this.httpRequest)({
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

  normalize(request: InterceptedRequest, response?: ResponseFixture) {
    const { body, headers, method, options } = request;
    const href = this.getHrefFromOptions(options);

    // fThis is redundant with `href`, so why should we keep it?
    delete request.headers.host;

    const url = new URL(href, true);

    // Remove ephemeral ports from superagent testing
    if (
      headers["user-agent"] &&
      headers["user-agent"].startsWith("node-superagent")
    ) {
      url.set("port", undefined);
    }

    const fixture = {
      request: {
        // Poor-man's clone for immutability
        ...JSON.parse(JSON.stringify({ method, href, headers, body })),
        url
      },
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
    this.mode = Mode.RECORD;
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
    this.mode = Mode.REPLAY;
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
    this.mode = Mode.RERECORD;
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
  }

  saveFixture(fixture: Fixture) {
    const fixturePath = this.getFixturePath(fixture.request);
    const serialized = JSON.stringify(fixture, null, 2);

    log("Recording fixture %o", fixturePath);

    mkdirp.sync(path.dirname(fixturePath));
    fs.writeFileSync(fixturePath, serialized);
  }

  setupNock() {
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
