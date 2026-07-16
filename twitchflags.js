(function installTwitchFlagsJS(global) {
  "use strict";

  const API_BASE_URL = "https://twitchflags.live/api/flags/";
  const DEFAULT_TWEMOJI_VERSION = "17.0.3";
  const NEGATIVE_CACHE_TTL_MS = 3_600_000;
  const SUCCESS_CACHE_EXPIRY = Number.POSITIVE_INFINITY;
  const configuration = { twemojiVersion: DEFAULT_TWEMOJI_VERSION, twemojiUrl: "" };
  const flagCache = new Map();
  let twemojiLoaderPromise = null;

  function logError(message, details) {
    try {
      global.console.error(`[TwitchFlagsJS] ${message}`, details);
    } catch (_) {
      // Logging must never alter the public empty-result contract.
    }
  }

  function normalizeUserId(userId) {
    if (typeof userId === "number") {
      if (!Number.isSafeInteger(userId) || userId < 0) return "";
      return String(userId);
    }
    return typeof userId === "string" && /^\d+$/.test(userId) ? userId : "";
  }

  function Configure(options) {
    if (!options || typeof options !== "object") {
      logError("Invalid configuration", { options });
      return undefined;
    }
    for (const key of ["twemojiVersion", "twemojiUrl"]) {
      if (!(key in options)) continue;
      if (typeof options[key] !== "string" || options[key].length === 0) {
        logError("Invalid configuration value", { key, value: options[key] });
        continue;
      }
      configuration[key] = options[key];
    }
    return undefined;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return { jsonError: error };
    }
  }

  async function requestFlag(userId) {
    try {
      const response = await global.fetch(`${API_BASE_URL}${encodeURIComponent(userId)}`, {
        cache: "default",
      });
      const body = await readJson(response);
      if (response.ok) {
        if (
          !body ||
          body.twitchUserId !== userId ||
          typeof body.flag !== "string" ||
          !/^[A-Z]{2}$/.test(body.flag)
        ) {
          logError("Flag lookup returned invalid data", {
            userId,
            reason: "malformed_response",
            response: body,
          });
          return { value: "", cacheUntil: 0 };
        }
        return { value: body.flag, cacheUntil: SUCCESS_CACHE_EXPIRY };
      }

      const errorCode = body && body.error;
      logError("Flag lookup failed", { userId, status: response.status, error: errorCode });
      if (response.status === 404 && errorCode === "flag_not_set") {
        return { value: "", cacheUntil: global.Date.now() + NEGATIVE_CACHE_TTL_MS };
      }
      return { value: "", cacheUntil: 0 };
    } catch (error) {
      logError("Flag lookup failed", { userId, error });
      return { value: "", cacheUntil: 0 };
    }
  }

  async function GetFlagCode(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) {
      logError("Invalid Twitch user ID", { userId });
      return "";
    }
    const cached = flagCache.get(normalizedUserId);
    if (cached) {
      if (cached.promise) return cached.promise;
      if (cached.expiresAt > global.Date.now()) return cached.value;
      flagCache.delete(normalizedUserId);
    }

    const promise = requestFlag(normalizedUserId).then(({ value, cacheUntil }) => {
      if (cacheUntil > global.Date.now()) {
        flagCache.set(normalizedUserId, { value, expiresAt: cacheUntil });
      } else {
        flagCache.delete(normalizedUserId);
      }
      return value;
    });
    flagCache.set(normalizedUserId, { promise });
    return promise;
  }

  async function GetFlagEmoji(userId) {
    const code = await GetFlagCode(userId);
    return code
      ? String.fromCodePoint(...[...code].map((letter) => letter.charCodeAt(0) + 127397))
      : "";
  }

  async function GetFlagShortCode(userId) {
    const code = await GetFlagCode(userId);
    return code ? `:flag_${code.toLowerCase()}:` : "";
  }

  async function GetFlagName(userId) {
    const code = await GetFlagCode(userId);
    if (!code) return "";
    try {
      return new global.Intl.DisplayNames(undefined, { type: "region" }).of(code) || "";
    } catch (error) {
      logError("Could not localize flag name", { operation: "GetFlagName", userId, error });
      return "";
    }
  }

  function hasTwemoji() {
    return Boolean(global.twemoji && typeof global.twemoji.parse === "function");
  }

  function getTwemojiUrl() {
    return (
      configuration.twemojiUrl ||
      `https://cdn.jsdelivr.net/npm/@twemoji/api@${encodeURIComponent(configuration.twemojiVersion)}/dist/twemoji.min.js`
    );
  }

  async function loadTwemoji() {
    if (hasTwemoji()) return global.twemoji;
    if (twemojiLoaderPromise) return twemojiLoaderPromise;

    twemojiLoaderPromise = new Promise((resolve) => {
      try {
        const script = global.document.createElement("script");
        script.async = true;
        script.crossOrigin = "anonymous";
        script.src = getTwemojiUrl();
        script.onload = () => {
          if (hasTwemoji()) {
            resolve(global.twemoji);
          } else {
            logError("Twemoji loaded without a valid global", { url: script.src });
            resolve(null);
          }
        };
        script.onerror = (error) => {
          logError("Could not load Twemoji", { url: script.src, error });
          resolve(null);
        };
        global.document.head.appendChild(script);
      } catch (error) {
        logError("Could not load Twemoji", { url: getTwemojiUrl(), error });
        resolve(null);
      }
    });

    const result = await twemojiLoaderPromise;
    twemojiLoaderPromise = null;
    return result;
  }

  async function GetFlagImageElement(userId) {
    const emoji = await GetFlagEmoji(userId);
    if (!emoji) return null;
    const twemoji = await loadTwemoji();
    if (!twemoji) return null;
    try {
      const container = global.document.createElement("span");
      container.textContent = emoji;
      twemoji.parse(container);
      const image = container.querySelector("img");
      if (!image) {
        logError("Twemoji did not produce an image", { userId });
        return null;
      }
      image.remove();
      return image;
    } catch (error) {
      logError("Could not render flag image", { userId, error });
      return null;
    }
  }

  async function GetFlagImageHtml(userId) {
    const image = await GetFlagImageElement(userId);
    return image ? image.outerHTML : "";
  }

  global.TwitchFlagsJS = {
    Configure,
    GetFlagCode,
    GetFlagEmoji,
    GetFlagImageElement,
    GetFlagImageHtml,
    GetFlagName,
    GetFlagShortCode,
  };
})(globalThis);
