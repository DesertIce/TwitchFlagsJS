# TwitchFlagsJS

TwitchFlagsJS is a small browser-global client for the [TwitchFlags public API](https://twitchflags.live/docs). It looks up the flag saved for a Twitch user and exposes it as an ISO country code, Unicode emoji, emoji shortcode, browser-localized country name, or Twemoji image.

The library is a single browser script. It has no required build step and loads Twemoji automatically only when an image method needs it.

## Requirements

- A modern browser with `fetch`, promises, `Map`, and `Intl.DisplayNames`.
- A digits-only Twitch numeric user ID. Twitch usernames are not accepted by the upstream API.
- UTF-8 page encoding for Unicode flag emoji.

## Quick start

Load TwitchFlagsJS directly. You do not need to load Twemoji yourself.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <script src="twitchflags.js"></script>
  </head>
</html>
```

After GitHub Pages is enabled with **GitHub Actions** as its source, the hosted script is available directly from:

```html
<script src="https://desertice.github.io/TwitchFlagsJS/twitchflags.js"></script>
```

The Pages deployment contains only `twitchflags.js`; the README, tests, and browser harness remain repository-only files.

Then call any lookup method with a Twitch numeric user ID:

```js
const userId = "18063875";

const code = await TwitchFlagsJS.GetFlagCode(userId);           // "US"
const emoji = await TwitchFlagsJS.GetFlagEmoji(userId);         // "🇺🇸"
const shortcode = await TwitchFlagsJS.GetFlagShortCode(userId); // ":flag_us:"
const name = await TwitchFlagsJS.GetFlagName(userId);            // "United States" in an en-US browser
```

`GetFlagName` always uses the browser's current locale. It does not accept a locale argument.

## Rendering Twemoji images

For normal DOM use, request an element and append it:

```js
const image = await TwitchFlagsJS.GetFlagImageElement("18063875");

if (image) {
  image.classList.add("user-flag");
  document.querySelector("#flag-container").append(image);
}
```

The returned `HTMLImageElement` is detached, so consuming code decides where and whether to insert it.

If the consumer needs serialized markup instead, request the generated HTML string:

```js
const html = await TwitchFlagsJS.GetFlagImageHtml("18063875");

if (html) {
  document.querySelector("#flag-container").insertAdjacentHTML("beforeend", html);
}
```

Both methods use Twemoji's DOM parser internally. TwitchFlagsJS does not pass user-provided HTML to Twemoji.

Twemoji images use the `emoji` CSS class. A typical inline style is:

```css
img.emoji {
  height: 1em;
  width: 1em;
  margin: 0 0.05em 0 0.1em;
  vertical-align: -0.1em;
}
```

## Twemoji configuration

If `globalThis.twemoji` already contains a valid Twemoji instance, TwitchFlagsJS reuses it and does not load another copy.

Otherwise, the first image request dynamically loads pinned Twemoji version `17.0.3` from jsDelivr. Configure a different version before the first image request with:

```js
TwitchFlagsJS.Configure({ twemojiVersion: "17.0.2" });
```

Use a self-hosted file or alternate CDN by providing a complete or relative script URL:

```js
TwitchFlagsJS.Configure({ twemojiUrl: "/vendor/twemoji.min.js" });
```

When both settings are present, `twemojiUrl` takes precedence over `twemojiVersion`. Configuration does not replace a Twemoji instance that is already loaded.

Consumers may also preload their chosen version before TwitchFlagsJS:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@twemoji/api@17.0.3/dist/twemoji.min.js"
  crossorigin="anonymous"
></script>
<script src="twitchflags.js"></script>
```

## API reference

All lookup methods accept `userId` as a digits-only string or a non-negative safe integer. Every lookup method returns a promise.

| Method | Resolves with | Empty result |
| --- | --- | --- |
| `GetFlagCode(userId)` | Uppercase ISO 3166-1 alpha-2 code such as `"US"` | `""` |
| `GetFlagEmoji(userId)` | Unicode regional-indicator flag such as `"🇺🇸"` | `""` |
| `GetFlagShortCode(userId)` | Emoji-style shortcode such as `":flag_us:"` | `""` |
| `GetFlagName(userId)` | Country or territory name in the browser's locale | `""` |
| `GetFlagImageHtml(userId)` | Serialized Twemoji `<img>` markup | `""` |
| `GetFlagImageElement(userId)` | Detached Twemoji `HTMLImageElement` | `null` |

`TwitchFlagsJS.Configure(options)` is synchronous, returns `undefined`, and accepts these optional non-empty strings:

| Option | Purpose | Default |
| --- | --- | --- |
| `twemojiVersion` | Version inserted into the default jsDelivr URL | `"17.0.3"` |
| `twemojiUrl` | Custom Twemoji browser-script URL; takes precedence when set | Not set |

Invalid configuration values are logged and ignored.

## Empty results and errors

Lookup promises do not reject. When a lookup, localization, or Twemoji operation fails, the method resolves with its documented empty result. Available error information is written to `console.error` with a `[TwitchFlagsJS]` prefix.

The TwitchFlags API currently documents:

| HTTP status | API error | Meaning |
| --- | --- | --- |
| `400` | `invalid_twitch_user_id` | The supplied ID is missing or not digits-only |
| `404` | `flag_not_set` | The user has not saved a flag |
| `429` | `rate_limited` | The request was rate limited |
| `503` | `service_unavailable` | Flag storage is temporarily unavailable |

## Caching

- Successful flags are cached for the lifetime of the page.
- A `404 flag_not_set` result is cached separately for that user for one hour.
- After the hour expires, that user's next lookup requests fresh data.
- Invalid input, rate limits, service failures, malformed responses, and network failures are not cached.
- Concurrent lookups for the same user share one request.
- Concurrent image requests share one Twemoji load.
- A failed Twemoji load is not retained; a later image request can retry.

## Testing

Run the dependency-free automated suite with Node:

```bash
node --test tests/twitchflags.test.js
```

Serve the repository and open `test.html` to exercise the real TwitchFlags and Twemoji integrations in a browser:

```bash
python -m http.server 4173
```

Then visit <http://127.0.0.1:4173/test.html>.

## Twemoji attribution and license

TwitchFlagsJS uses Twemoji code and graphics without modifying the Twemoji assets.

- **Work:** [Twemoji](https://github.com/jdecked/twemoji)
- **Graphics creator:** [Twemoji contributors](https://github.com/jdecked/twemoji/graphs/contributors)
- **Graphics source:** [jdecked/twemoji assets](https://github.com/jdecked/twemoji/tree/main/assets)
- **Graphics license:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://github.com/jdecked/twemoji/blob/main/LICENSE-GRAPHICS)
- **Modifications:** None. TwitchFlagsJS requests and renders the upstream assets through the Twemoji API.

Twemoji's JavaScript code is distributed under the [MIT License](https://github.com/jdecked/twemoji/blob/main/LICENSE). Copyright © 2022–present Jason Sofonia and Justine De Caires; copyright © 2014–2021 Twitter.

Applications that display Twemoji graphics should retain an appropriate Twemoji attribution in their README, About screen, site footer, or source. See Twemoji's [attribution requirements](https://github.com/jdecked/twemoji#attribution-requirements).
