# Built-in display layouts

`renderLayout(display)` in `lib/render.js` produces the device's exact 296 × 128, 4,736-byte monochrome bitmap. The runner uses that same bitmap for its PNG preview and device feed. No browser, third-party fonts, network requests or TickrMeter proprietary rendering service are required.

The built-in typography and icons are original pixel artwork bundled with the runner. These deliberately small presets give an agent a predictable starting point. An app can supply its own renderer for a different visual style or language, using the display SDK's bitmap/PNG conversion tools.

## Metric

```js
{
  layout: 'metric',
  title: 'Email open rate',
  value: '42.5%',
  footer: 'Latest campaign',
  icon: 'mail', // Optional: mail, chart, person, bolt
  trend: 'up'   // Optional: up, down, flat; does not control the device LED
}
```

One large centered value, a title above, and a footer below. An optional icon sits beside the title; an optional trend indicator sits beside the footer. The main value uses a 35–56-pixel font height. The title and footer remain 14 pixels high.

## Two metrics

```js
{
  layout: 'two-metrics',
  title: 'Campaign overview',
  metrics: [
    { label: 'Open rate', value: '42.5%' },
    { label: 'Clicks', value: 128 }
  ],
  footer: 'This week'
}
```

Exactly two values are displayed side by side, separated by a thin vertical rule. Values use a 21–35-pixel font height; labels remain 14 pixels high. Format long values explicitly, for example `12.4K`, to keep the display readable.

## Clock

```js
{
  layout: 'clock',
  title: 'Copenhagen',
  time: '20:23',
  date: 'Wednesday 7 October'
}
```

The app supplies the formatted time and date, including its timezone and daylight-saving handling. The renderer does not read the current time, so a preview and its corresponding device frame cannot disagree. The main time uses a 35–63-pixel font height; title and date remain 14 pixels high. `HH:MM` gives the clearest result; seconds or an AM/PM suffix consume more space.

## Text and overflow policy

- Text is rendered in uppercase. Latin accents are simplified; `ø` becomes `O`, `æ` becomes `AE`, `ß` becomes `SS`. Common smart quotes, dashes and ellipses become their ASCII equivalents. Whitespace is collapsed.
- Digits, Latin letters, common ASCII punctuation and `€ £ ¥ °` are supported. Other characters produce `UNSUPPORTED_CHARACTER`; they are never silently removed. Use a custom renderer for languages outside this character set.
- Titles, labels and footers are shortened with `...` when necessary. Their font size never shrinks.
- Main values use the largest supported size that fits, with the minimum font heights above. If the value still does not fit, the renderer raises `VALUE_TOO_WIDE` instead of cutting off digits or making them illegible. Format currency, precision and compact numbers in the app.
- `0` is displayed as zero. `null`, `undefined`, empty and whitespace-only values display `--`, preserving the distinction between absent data and zero. Booleans, objects and non-finite numbers are rejected.
- Text fields accept at most 512 characters before normalization. Unknown layouts, extra fields, invalid icon names and a metrics array of the wrong length fail with a `LayoutError` containing `code` and `field`.
- Icons are built in; arbitrary image URLs are not fetched. No credentials or provider requests belong in the renderer.

Run the renderer checks with `node --test test/render.test.js` from this package. Visual fixture hashes are tied to reviewed synthetic layouts; inspect new PNGs before intentionally changing those hashes.
