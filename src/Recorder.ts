import * as cosmiconfig from "cosmiconfig";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { cloneDeep } from "lodash";
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

interface Normalizer {
  (request: RequestFixture, response?: ResponseFixture): void;
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
  body: string;
  href: string;
  method: Methods;
  headers: http.IncomingHttpHeaders;
}

interface ResponseFixture {
  body: object | string;
  statusCode: number;
  headers: http.IncomingHttpHeaders;
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
  normalizers: Normalizer[] = [
    function removeRedudantHostHeader(request) {
      // TODO This is redundant with `href`, so why should we keep it?
      delete request.headers.host;
    },

    function ignoreSuperAgent(request) {
      // TODO Move this into an array with custom normalizers
      const userAgent = request.headers["user-agent"];

      if (userAgent && userAgent.startsWith("node-superagent")) {
        const url = new URL(request.href);

        url.set("port", undefined);

        request.href = url.href;
      }
    }
  ];

  constructor() {
    this.loadConfig();

    if (!nock.isActive()) {
      this.setupNock();
      this.patchNock();
    }
  }

  configure = (config: Config) => {
    if (config.fixturesPath) {
      this.fixturesPath = config.fixturesPath;
    }

    if (config.normalizers) {
      config.normalizers.forEach((normalizer) => {
        this.normalizers.push(normalizer);
      });
    }
  };

  getFixture = (interceptedRequest: InterceptedRequest): Fixture => {
    const { request } = this.normalize(interceptedRequest) as Fixture;
    const fixturePath = this.getFixturePath(request);

    return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  };

  getFixturePath(request: RequestFixture): string {
    const { href } = request;
    const { hostname, pathname } = URL(request.href);

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

    const url = new URL("");

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
            resolve(json);
          } catch (error) {
            resolve(unzipped);
          }

          resolve(unzipped);
        } else {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
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

    const fixture = cloneDeep({
      request: { method, href, headers, body },
      response
    });

    this.normalizers.forEach((normalizer) => {
      normalizer(fixture.request, fixture.response);
    });

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
      // TODO Better messaging we're recording
      console.error(error);
    }

    return this.rerecordRequest(request);
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
    const fixture = this.normalize(request, response) as Fixture;

    process.nextTick(() => this.saveFixture(fixture));

    const { statusCode, body, headers } = fixture.response;

    respond(null, [statusCode, body, headers]);
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

    log("Saving fixture %o", fixturePath);

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
