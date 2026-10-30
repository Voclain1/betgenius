import { NextResponse } from "next/server";
import { AD_UNITS, INTERSTITIAL_FRAME_ID, SOCIAL_BAR_SRC, invokeUrl, type AdUnitId } from "@/lib/ads";

/**
 * The document that goes inside an ad frame.
 *
 * WHY THIS ROUTE EXISTS AT ALL, rather than the frame carrying its HTML in a
 * `srcdoc` attribute — which is where this started, and which does not work.
 *
 * The frame has to be sandboxed WITHOUT `allow-same-origin`, so that the ad
 * script runs on an opaque origin and cannot read our cookies, our storage or
 * our DOM. Four ways of loading the same unit were measured in a real Chrome
 * against the real network, watching whether invoke.js was requested at all:
 *
 *   inline in the page, no frame ............................ requested
 *   srcdoc frame, sandbox WITHOUT allow-same-origin ......... NOT requested
 *   srcdoc frame, sandbox WITH allow-same-origin ............ requested
 *   src frame from this route, WITHOUT allow-same-origin .... requested
 *
 * A `srcdoc` document on an opaque origin never issues the script request, so
 * that combination serves zero ads — silently, with the slot rendering as an
 * empty reserved box and nothing in the console. The choice was therefore
 * between giving the ad script our origin (row 3, which is no better than
 * pasting the supplied tag straight into the page) and serving the same HTML
 * from a URL (row 4), which loads and stays isolated. Hence this route.
 *
 * The frame is still a document WE author — the network only ever gets the two
 * script tags it asked for — and `atOptions` is still a global of this frame's
 * window rather than of the page, which is the other half of what the frame is
 * for. See the header of src/lib/ads.ts.
 */

// The unit is looked up in AD_UNITS and NEVER interpolated from the query
// string. An unknown id is a 404, not a frame built from whatever was in the
// URL: this route emits raw HTML, so an id that reached the output unescaped
// would be an injection point on our own origin.
function isAdUnitId(value: string | null): value is AdUnitId {
  return value !== null && Object.prototype.hasOwnProperty.call(AD_UNITS, value);
}

function html(body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${body}</html>`;
}

/**
 * The full-screen between-pages document: the Social Bar interstitial, with
 * the 300x250 centred underneath for a load where the network shows nothing.
 * The two can share one document because only the rectangle uses atOptions.
 */
function interstitialBody() {
  const r = AD_UNITS.rectangle;
  return (
    `<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}` +
    `body{display:flex;align-items:center;justify-content:center}</style></head><body>` +
    `<div style="width:${r.width}px;height:${r.height}px">` +
    `<script>window.atOptions=${JSON.stringify({ key: r.key, format: "iframe", height: r.height, width: r.width, params: {} })}</script>` +
    `<script src="${invokeUrl(r.key)}"></script></div>` +
    `<script data-cfasync="false" src="${SOCIAL_BAR_SRC}"></script></body>`
  );
}

const HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // The document is a pure function of the unit id, so it caches happily.
  // What must not be cached is the ad the script fetches, and that request
  // is made fresh by the browser on every load regardless of this.
  "cache-control": "public, max-age=3600, s-maxage=3600",
  // Not a page. It has no content of its own and must never be indexed or
  // appear as a search result in place of the page that embeds it.
  "x-robots-tag": "noindex, nofollow",
};

export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("unit");
  if (id === INTERSTITIAL_FRAME_ID) return new NextResponse(html(interstitialBody()), { headers: HEADERS });
  if (!isAdUnitId(id)) return new NextResponse("Unknown ad unit", { status: 404 });
  const unit = AD_UNITS[id];

  const body =
    unit.kind === "iframe"
      ? // The creative is exactly the size of the frame, so nothing here can
        // scroll. Without `overflow:hidden` a creative that measures a pixel
        // over its declared size shows as a grey scrollbar stripe down the
        // side of the unit.
        `<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>` +
        `<script>window.atOptions=${JSON.stringify({
          key: unit.key,
          format: "iframe",
          height: unit.height,
          width: unit.width,
          params: {},
        })}</script>` +
        `<script src="${invokeUrl(unit.key)}"></script></body>`
      : // The Native Banner takes its key from the script URL and renders into
        // a container it finds by id, so it needs no atOptions. `data-cfasync`
        // is carried over from the supplied tag: it tells Cloudflare Rocket
        // Loader to leave the script alone.
        `<style>html,body{margin:0;padding:0;background:transparent}</style></head><body>` +
        `<script async data-cfasync="false" src="${unit.src}"></script>` +
        `<div id="${unit.containerId}"></div></body>`;

  return new NextResponse(html(body), { headers: HEADERS });
}
