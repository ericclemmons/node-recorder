import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as mkdirp from "mkdirp";
import * as nock from "nock";
import * as path from "path";
import * as zlib from "zlib";
import * as url from "url";

import { Mode } from "./Mode";

const fnv1a = require("@sindresorhus/fnv1a");

const REQUEST_ARGUMENTS = new WeakMap();

nock.restore();

enum Methods {
  GET = "GET",
  POST = "POST"
}

// A more relaxed version of http.ReuestOptions
interface Options {
  [key: string]: string;
}

interface RequestFixture {
  body: string;
  href: string;
  method: Methods;
  headers: http.IncomingHttpHeaders;
  // url: UrlWithParsedQuery;
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
  options: Options;
  req: http.ClientRequest;
  respond: nock.ReplyCallback;
}

export class Recorder {
  httpRequest = http.request;
  httpsRequest = https.request;
  mode: Mode = Mode.IGNORE;

  constructor() {
    this.setupNock();
    this.patchNock();
  }

  getFixture = (interceptedRequest: InterceptedRequest): Fixture => {
    const { request } = this.normalize(interceptedRequest);
    const fixturePath = this.getFixturePath(request);

    return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  };

  getFixturePath(request: RequestFixture): string {
    const { href } = request;
    const { hostname, pathname } = url.parse(request.href);

    if (!hostname) {
      console.error(request);
      throw new Error(
        `Cannot parse hostname from fixture's "href": ${JSON.stringify(href)}`
      );
    }

    if (!pathname) {
      console.error(request);
      throw new Error(
        `Cannot parse pathname from fixture's "href": ${JSON.stringify(href)}`
      );
    }

    const hash = fnv1a(JSON.stringify(request));
    const fixturePath = path.join(
      process.cwd(),
      "__fixtures__",
      hostname,
      pathname,
      `${hash}.json`
    );

    return fixturePath;
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
    const { href } = url.parse(options.href);

    // TODO Allow `recorder.configure` to customize this:
    // https://netflix.github.io/pollyjs/#/configuration?id=defaults
    return {
      request: { method, href: href as string, headers, body },
      response
    };
  }

  record() {
    this.mode = Mode.RECORD;
  }

  async recordRequest(request: InterceptedRequest) {
    const { respond } = request;

    try {
      const fixture = this.getFixture(request);
      const { statusCode, body, headers } = fixture.response;
      console.log("Replaying", fixture.request.href);

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

    this.saveFixture(fixture);

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

    console.log("Saving", fixturePath);
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
