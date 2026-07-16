const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "twitchflags.js");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createDocumentFixture() {
  const scripts = [];
  let onAppendScript = () => {};

  function createElement(tagName) {
    if (tagName === "script") {
      return { async: false, crossOrigin: "", onerror: null, onload: null, src: "" };
    }
    if (tagName === "span") {
      return {
        image: null,
        textContent: "",
        querySelector(selector) {
          return selector === "img" ? this.image : null;
        },
      };
    }
    throw new Error(`Unexpected element: ${tagName}`);
  }

  return {
    document: {
      createElement,
      head: {
        appendChild(script) {
          scripts.push(script);
          onAppendScript(script);
        },
      },
    },
    scripts,
    setOnAppendScript(callback) {
      onAppendScript = callback;
    },
  };
}

function installTwemoji(context) {
  context.twemoji = {
    parse(container) {
      container.image = {
        alt: container.textContent,
        outerHTML: `<img class="emoji" draggable="false" alt="${container.textContent}">`,
        remove() {},
      };
    },
  };
}

function loadLibrary({ fetch, now = 0, displayName = "United States", document } = {}) {
  const errors = [];
  const clock = { now };
  const DateForTest = class extends Date {
    static now() {
      return clock.now;
    }
  };
  class DisplayNamesForTest {
    constructor(locales, options) {
      assert.equal(locales, undefined);
      assert.equal(options.type, "region");
    }

    of(code) {
      assert.equal(code, "US");
      return displayName;
    }
  }
  const context = vm.createContext({
    console: { error: (...args) => errors.push(args) },
    Date: DateForTest,
    document,
    fetch,
    Intl: { DisplayNames: DisplayNamesForTest },
    Promise,
    queueMicrotask,
    setTimeout,
  });
  const source = fs.readFileSync(sourcePath, "utf8");
  vm.runInContext(source, context, { filename: sourcePath });
  return { api: context.TwitchFlagsJS, clock, context, errors };
}

test("returns ISO, Unicode, shortcode, and browser-localized flag text", async () => {
  const fetch = async () => jsonResponse(200, { twitchUserId: "18063875", flag: "US" });
  const { api } = loadLibrary({ fetch, displayName: "United States" });

  assert.equal(await api.GetFlagCode("18063875"), "US");
  assert.equal(await api.GetFlagEmoji(18063875), "🇺🇸");
  assert.equal(await api.GetFlagShortCode("18063875"), ":flag_us:");
  assert.equal(await api.GetFlagName("18063875"), "United States");
});

test("returns empty strings and logs invalid IDs without fetching", async () => {
  let fetchCount = 0;
  const { api, errors } = loadLibrary({
    fetch: async () => {
      fetchCount += 1;
    },
  });

  assert.equal(await api.GetFlagCode("not-an-id"), "");
  assert.equal(await api.GetFlagEmoji(-1), "");
  assert.equal(fetchCount, 0);
  assert.equal(errors.length, 2);
  assert.match(errors[0][0], /^\[TwitchFlagsJS\]/);
});

test("rejects malformed success payloads through the empty-result contract", async () => {
  const { api, errors } = loadLibrary({
    fetch: async () => jsonResponse(200, { twitchUserId: "different", flag: "usa" }),
  });

  assert.equal(await api.GetFlagCode("18063875"), "");
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].reason, "malformed_response");
});

test("returns an empty name when Intl.DisplayNames fails", async () => {
  const { api, context, errors } = loadLibrary({
    fetch: async () => jsonResponse(200, { twitchUserId: "18063875", flag: "US" }),
  });
  context.Intl.DisplayNames = class {
    constructor() {
      throw new Error("unsupported");
    }
  };

  assert.equal(await api.GetFlagName("18063875"), "");
  assert.equal(errors.at(-1)[1].operation, "GetFlagName");
});

test("shares one in-flight request and keeps successful results for the page lifetime", async () => {
  let resolveFetch;
  let fetchCount = 0;
  const pending = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const { api, clock } = loadLibrary({
    fetch: async () => {
      fetchCount += 1;
      return pending;
    },
  });

  const first = api.GetFlagCode("18063875");
  const second = api.GetFlagCode("18063875");
  resolveFetch(jsonResponse(200, { twitchUserId: "18063875", flag: "US" }));
  assert.deepEqual(await Promise.all([first, second]), ["US", "US"]);
  clock.now = Number.MAX_SAFE_INTEGER;
  assert.equal(await api.GetFlagCode("18063875"), "US");
  assert.equal(fetchCount, 1);
});

test("caches flag_not_set per user for one hour and refreshes at expiry", async () => {
  let fetchCount = 0;
  const { api, clock, errors } = loadLibrary({
    now: 1000,
    fetch: async () => {
      fetchCount += 1;
      return jsonResponse(404, { error: "flag_not_set" });
    },
  });

  assert.equal(await api.GetFlagCode("1"), "");
  clock.now = 1000 + 3_599_999;
  assert.equal(await api.GetFlagCode("1"), "");
  assert.equal(fetchCount, 1);
  assert.equal(errors.length, 1);

  clock.now = 1000 + 3_600_000;
  assert.equal(await api.GetFlagCode("1"), "");
  assert.equal(fetchCount, 2);
  assert.equal(errors.length, 2);
});

test("keeps negative cache expiry independent for each user", async () => {
  const calls = [];
  const { api, clock } = loadLibrary({
    now: 0,
    fetch: async (url) => {
      calls.push(url);
      return jsonResponse(404, { error: "flag_not_set" });
    },
  });

  await api.GetFlagCode("1");
  clock.now = 1_800_000;
  await api.GetFlagCode("2");
  clock.now = 3_600_000;
  await api.GetFlagCode("1");
  await api.GetFlagCode("2");
  assert.equal(calls.length, 3);
});

test("does not cache invalid, transient, malformed, or network failures", async () => {
  const responses = [
    jsonResponse(400, { error: "invalid_twitch_user_id" }),
    jsonResponse(429, { error: "rate_limited" }),
    jsonResponse(503, { error: "service_unavailable" }),
    jsonResponse(200, { twitchUserId: "3", flag: "bad" }),
  ];
  let index = 0;
  const { api } = loadLibrary({
    fetch: async () => {
      if (index === responses.length) {
        index += 1;
        throw new Error("offline");
      }
      return responses[index++];
    },
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(await api.GetFlagCode("3"), "");
  }
  assert.equal(index, 5);
});

test("uses an existing Twemoji global for element and HTML outputs", async () => {
  const dom = createDocumentFixture();
  const harness = loadLibrary({
    document: dom.document,
    fetch: async () => jsonResponse(200, { twitchUserId: "1", flag: "US" }),
  });
  installTwemoji(harness.context);

  const element = await harness.api.GetFlagImageElement("1");
  assert.equal(element.alt, "🇺🇸");
  assert.equal(await harness.api.GetFlagImageHtml("1"), element.outerHTML);
  assert.equal(dom.scripts.length, 0);
});

test("dynamically loads the pinned default Twemoji version once", async () => {
  const dom = createDocumentFixture();
  const harness = loadLibrary({
    document: dom.document,
    fetch: async () => jsonResponse(200, { twitchUserId: "1", flag: "US" }),
  });
  dom.setOnAppendScript((script) =>
    queueMicrotask(() => {
      installTwemoji(harness.context);
      script.onload();
    }),
  );

  const [element, html] = await Promise.all([
    harness.api.GetFlagImageElement("1"),
    harness.api.GetFlagImageHtml("1"),
  ]);
  assert.equal(element.alt, "🇺🇸");
  assert.match(html, /^<img /);
  assert.equal(dom.scripts.length, 1);
  assert.equal(
    dom.scripts[0].src,
    "https://cdn.jsdelivr.net/npm/@twemoji/api@17.0.3/dist/twemoji.min.js",
  );
});

test("supports configured Twemoji versions and custom URLs", async () => {
  for (const [options, expectedUrl] of [
    [
      { twemojiVersion: "17.0.2" },
      "https://cdn.jsdelivr.net/npm/@twemoji/api@17.0.2/dist/twemoji.min.js",
    ],
    [{ twemojiVersion: "17.0.2", twemojiUrl: "/vendor/twemoji.js" }, "/vendor/twemoji.js"],
  ]) {
    const dom = createDocumentFixture();
    const harness = loadLibrary({
      document: dom.document,
      fetch: async () => jsonResponse(200, { twitchUserId: "1", flag: "US" }),
    });
    harness.api.Configure(options);
    dom.setOnAppendScript((script) =>
      queueMicrotask(() => {
        installTwemoji(harness.context);
        script.onload();
      }),
    );

    assert.notEqual(await harness.api.GetFlagImageElement("1"), null);
    assert.equal(dom.scripts[0].src, expectedUrl);
  }
});

test("logs invalid configuration and preserves the previous values", () => {
  const { api, errors } = loadLibrary({ fetch: async () => {} });
  assert.equal(api.Configure({ twemojiVersion: "" }), undefined);
  assert.equal(api.Configure({ twemojiUrl: 17 }), undefined);
  assert.equal(errors.length, 2);
});

test("returns empty image results when loading fails and retries later", async () => {
  const dom = createDocumentFixture();
  const harness = loadLibrary({
    document: dom.document,
    fetch: async () => jsonResponse(200, { twitchUserId: "1", flag: "US" }),
  });
  dom.setOnAppendScript((script) =>
    queueMicrotask(() => script.onerror(new Error("blocked"))),
  );

  assert.equal(await harness.api.GetFlagImageElement("1"), null);
  assert.equal(await harness.api.GetFlagImageHtml("1"), "");
  assert.equal(dom.scripts.length, 2);
  assert.equal(harness.errors.length, 2);
});
