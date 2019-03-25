import * as http from "http";
import * as https from "https";
import { isObjectLike } from "lodash";
import * as nock from "nock";
import * as semver from "semver";
import * as URL from "url";

import { parseRequestArguments } from "./parseRequestArguments";
import { getUrlFromOptions } from "./getUrlFromOptions";

const REQUEST_ARGUMENTS = new WeakMap();
const debug = require("debug")("back-to-the-fixture");

nock.restore();

const isContentEncoded = require("./isContentEncoded");

export class Recorder {
  NativeClientRequest = http.ClientRequest;

  constructor() {
    this.setupNock();
    this.patchOverriddenMethods();
  }

  getBodyFromChunks(chunks: string[], headers: any) {
    // If content-encoding is set in the header then the body/content
    // should not be concatenated. Instead, the chunks should
    // be preserved as-is so that each chunk can be mocked individually
    if (isContentEncoded(headers)) {
      const hexChunks = chunks.map(chunk => {
        if (!Buffer.isBuffer(chunk)) {
          if (typeof chunk === "string") {
            throw new Error(
              "content-encoded responses must all be binary buffers"
            );
          }

          // @ts-ignore
          chunk = Buffer.from(chunk);
        }

        // @ts-ignore
        return chunk.toString("hex");
      });

      return JSON.stringify(hexChunks);
    }

    const buffer = mergeChunks(chunks);

    // The merged buffer can be one of two things:
    //  1. A binary buffer which then has to be recorded as a hex string.
    //  2. A string buffer.
    return buffer.toString(isBinaryBuffer(buffer) ? "hex" : "utf8");
  }

  getChunksFromBody(body: string, headers: any) {
    if (!body) {
      return [];
    }

    if (Buffer.isBuffer(body)) {
      return [body];
    }

    // If content-encoding is set in the header then the body/content
    // is as an array of hex strings
    if (isContentEncoded(headers)) {
      const hexChunks = JSON.parse(body);

      return hexChunks.map((chunk: string) => Buffer.from(chunk, "hex"));
    }

    const buffer = Buffer.from(body) as any;

    // The body can be one of two things:
    //  1. A hex string which then means its binary data.
    //  2. A utf8 string which means a regular string.
    return [Buffer.from(buffer, isBinaryBuffer(buffer) ? "hex" : "utf8")];
  }

  async handleRequest(pollyRequest: any) {
    const { body, headers, method, url } = pollyRequest;
    const { respond } = pollyRequest.requestArguments;

    debug("handleRequest %O", { method, url, headers, body });

    // TODO If replaying, find existing fixture & replay it
    // TODO If no fixture or recording, record it.

    const response = await this.passthroughRequest(pollyRequest);

    try {
      respond(null, [response.statusCode, response.body, response.headers]);
    } catch (error) {
      respond(error);

      throw error;
    }
  }

  async passthroughRequest(pollyRequest: any) {
    const { parsedArguments } = pollyRequest.requestArguments;
    const { method, headers, body } = pollyRequest;
    const { options } = parsedArguments;

    const request = new this.NativeClientRequest({
      ...options,
      method,
      headers: { ...headers },
      ...URL.parse(pollyRequest.url)
    });

    const chunks = this.getChunksFromBody(body, headers);

    const responsePromise = new Promise((resolve, reject) => {
      request.once("response", resolve);
      request.once("error", reject);
      request.once("timeout", reject);
    });

    // Write the request body
    chunks.forEach(chunk => request.write(chunk));
    request.end();

    const response = await responsePromise;
    const responseBody = await new Promise((resolve, reject) => {
      const chunks = [];

      response.on("data", chunk => chunks.push(chunk));
      response.once("end", () =>
        resolve(this.getBodyFromChunks(chunks, response.headers))
      );
      response.once("error", reject);
    });

    return {
      headers: response.headers,
      statusCode: response.statusCode,
      body: responseBody
    };
  }

  patchOverriddenMethods() {
    const modules = { http, https };
    const { ClientRequest } = http;

    // Patch the already overridden ClientRequest class so we can get
    // access to the original arguments and use them when creating the
    // passthrough request.
    // @ts-ignore
    http.ClientRequest = function _ClientRequest() {
      // @ts-ignore
      const req = new ClientRequest(...arguments);

      REQUEST_ARGUMENTS.set(req, [...arguments]);

      return req;
    };

    // Patch http.request, http.get, https.request, and https.get
    // to support new Node.js 10.9 signature `http.request(url[, options][, callback])`
    // (https://github.com/nock/nock/issues/1227).
    //
    // This patch is also needed to set some default values which nock doesn't
    // properly set.
    Object.keys(modules).forEach(moduleName => {
      // @ts-ignore
      const module = modules[moduleName];
      const { request, get, globalAgent } = module;
      const parseArgs = function() {
        // @ts-ignore
        const args = parseRequestArguments(...arguments);

        if (moduleName === "https") {
          args.options = {
            ...{ port: 443, protocol: "https:", _defaultAgent: globalAgent },
            ...args.options
          };
        } else {
          args.options = {
            ...{ port: 80, protocol: "http:" },
            ...args.options
          };
        }

        return args;
      };

      module.request = function _request() {
        // @ts-ignore
        const { options, callback } = parseArgs(...arguments);

        return request(options, callback);
      };

      if (semver.satisfies(process.version, ">=8")) {
        module.get = function _get() {
          // @ts-ignore
          const { options, callback } = parseArgs(...arguments);

          return get(options, callback);
        };
      }
    });
  }

  setupNock() {
    const adapter = this;

    // Make sure there aren't any other interceptors defined
    nock.cleanAll();

    // Create our interceptor that will match all hosts
    const interceptor = nock(/.*/).persist();

    [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "PATCH",
      "MERGE",
      "HEAD",
      "OPTIONS"
    ].forEach(m => {
      // Add an intercept for each supported HTTP method that will match all paths
      interceptor.intercept(/.*/, m).reply(function(_, body, respond) {
        // @ts-ignore
        const { req, method } = this;
        const { headers } = req;
        // @ts-ignore
        const parsedArguments = parseRequestArguments(
          ...REQUEST_ARGUMENTS.get(req)
        );
        const url = getUrlFromOptions(parsedArguments.options);

        // body will always be a string unless the content-type is application/json
        // in which nock will then parse into an object. We have our own way of
        // dealing with json content to convert it back to a string.
        if (body && typeof body !== "string") {
          body = JSON.stringify(body);
        }

        adapter
          .handleRequest({
            url,
            method,
            headers,
            body,
            requestArguments: { req, body, respond, parsedArguments }
          })
          .catch(e => {
            // This allows the consumer to handle the error gracefully
            req.emit("error", e);
          });
      });
    });

    // Activate nock so it can start to intercept all outgoing requests
    nock.activate();
  }
}
