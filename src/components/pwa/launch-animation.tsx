import { LAUNCH_BG, MARK_BOX, RIBBON_PATH, STROKE_WIDTH, TONES } from "./launch-mark.generated";

/**
 * The installed app's opening: a line draws the mark, ribbon after ribbon in its own tone, the
 * finished mark settles over it, the name rises under it, and after a moment it lifts onto the app.
 *
 * ⚠️⚠️ **It continues the system's launch screen; it is never a second one** (decided 2 October
 * 2026: a page splash after the system's read as two splashes). Same colour (`LAUNCH_BG`, the
 * manifest's `background_color`), the mark at the middle, and:
 * - **iOS** (`draw`): the launch images are plain navy (scripts/generate-pwa-icons.mjs), so the
 *   line draws the mark from nothing — the first time it appears.
 * - **Android** (`retrace`): the system has already shown the mark and a web app cannot remove it,
 *   so the opening starts from it: the mark fades to a watermark and the line traces it again.
 *
 * ⚠️ **Only in the installed app** (`display-mode: standalone`), once per session. In a browser tab
 * it covered the page at every new session. `?splash=draw` or `?splash=retrace` plays it anywhere,
 * to look at it.
 *
 * ⚠️⚠️ **It can never trap anybody behind it.** The script lifts it on `load`, after the animation;
 * a timer lifts it at five seconds whatever happens; and with no script at all it never shows (it
 * is hidden until the script names a mode), with a CSS animation hiding it at six seconds anyway.
 * `prefers-reduced-motion` gets the finished mark at once (`still`).
 *
 * Plain HTML, CSS and two inline scripts, first in the body: it paints before anything else loads.
 * The finished mark (`launch-final-512.png`, gradients and weave) is laid over the line on the same
 * square, so the hand-over is exact.
 *
 * ⚠️⚠️ **Nothing here may move on the main thread.** It plays while that thread is busy starting the
 * app, and what it animates there stutters: the line used to be a CSS animation of
 * `stroke-dashoffset`, which with the main thread blocked froze (measured in Chrome: one picture in
 * 1.4 s). The line is now an animated WebP (`launch-draw.webp`, scripts/generate-pwa-icons.mjs, same
 * geometry, timing and glow), which the compositor advances (28 pictures in the same 1.4 s); the
 * rest is opacity and transform on layers of their own (`will-change`). The CSS clock waits for the
 * line to be decoded (`data-launch-go`), so the two start together.
 */
export function LaunchAnimation({ nonce }: { nonce?: string }) {
  const script = `(function(){var d=document.documentElement,f=/[?&]splash=(draw|retrace)\\b/.exec(location.search),sa=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;function off(){d.setAttribute("data-launch","off")}if(!f&&!sa)return off();if(!f){try{if(sessionStorage.getItem("flux-launch"))return off();sessionStorage.setItem("flux-launch","1")}catch(e){}}var m=f?f[1]:/Android/i.test(navigator.userAgent)?"retrace":"draw",still=matchMedia("(prefers-reduced-motion: reduce)").matches;d.setAttribute("data-launch",still?"still":m);var s=Date.now(),min=still?450:m==="retrace"?2250:2150;function done(){d.setAttribute("data-launch-done","")}function lift(){setTimeout(done,Math.max(0,min-(Date.now()-s)))}if(document.readyState==="complete")lift();else addEventListener("load",lift,{once:true});setTimeout(done,5000)})();`;

  const ribbons = (className: string) => (
    <svg
      className={className}
      viewBox={`${MARK_BOX.lo} ${MARK_BOX.lo} ${MARK_BOX.size} ${MARK_BOX.size}`}
      role="presentation"
    >
      {TONES.map((tone, q) => (
        <path
          key={tone}
          className={`fl-r${q}`}
          d={RIBBON_PATH}
          transform={`rotate(${q * 90} 12 12)`}
          stroke={tone}
          pathLength={1}
        />
      ))}
    </svg>
  );

  return (
    <>
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS, no user input
        dangerouslySetInnerHTML={{ __html: LAUNCH_CSS }}
      />
      <script
        nonce={nonce}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static script, no user input
        dangerouslySetInnerHTML={{ __html: script }}
      />
      <div id="flux-launch" aria-hidden="true">
        <div className="fl-glow" />
        <div className="fl-stage">
          {ribbons("fl-ghost")}
          {/* biome-ignore lint/performance/noImgElement: plain HTML painted before React, by design */}
          <img className="fl-line" src="/icons/launch-draw.webp" alt="" fetchPriority="high" decoding="async" />
          {/* biome-ignore lint/performance/noImgElement: plain HTML painted before React, by design */}
          <img className="fl-final" src="/icons/launch-final-512.png" alt="" fetchPriority="high" />
        </div>
        {/* biome-ignore lint/performance/noImgElement: plain HTML painted before React, by design */}
        <img className="fl-word" src="/brand/flux-wordmark-dark-bg.svg" alt="" />
      </div>
      <script
        nonce={nonce}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static script, no user input
        dangerouslySetInnerHTML={{ __html: GO_SCRIPT }}
      />
    </>
  );
}

/**
 * Starts the CSS clock once the line is decoded, so the image (which starts playing when it is
 * first painted) and the CSS run together; at 0.4 s it starts anyway.
 */
const GO_SCRIPT = `(function(){var d=document.documentElement;if(!d.getAttribute("data-launch")||d.getAttribute("data-launch")==="off")return;var i=document.querySelector("#flux-launch .fl-line"),done=false;function go(){if(done)return;done=true;d.setAttribute("data-launch-go","")}setTimeout(go,400);if(!i||i.complete)return go();if(i.decode)i.decode().then(go,go);else i.addEventListener("load",go)})();`;

/**
 * The timeline (draw; retrace starts 0.15 s later, after the watermark):
 *   0.20–1.40 s  the line: ribbon by ribbon, accelerating into the first and easing out of the last,
 *                so the four read as one gesture;
 *   1.30–1.70 s  the finished mark settles over the line; a soft glow comes up behind it;
 *   1.35–1.85 s  the name rises;
 *   ~2.15 s      it lifts (0.45 s), once the page has loaded.
 */
const LAUNCH_CSS = `
#flux-launch{display:none}
html[data-launch=draw] #flux-launch,html[data-launch=retrace] #flux-launch,html[data-launch=still] #flux-launch{
display:block;position:fixed;inset:0;z-index:2147483647;overflow:hidden;background:${LAUNCH_BG};--t:0s;
transition:opacity .45s ease,visibility .45s ease;animation:fl-failsafe .3s 6s forwards}
html[data-launch=retrace] #flux-launch{--t:.15s}
html[data-launch-done] #flux-launch{opacity:0;visibility:hidden;pointer-events:none}
#flux-launch .fl-stage{position:absolute;left:50%;top:50%;width:104px;height:104px;margin:-52px 0 0 -52px}
#flux-launch .fl-stage>*{position:absolute;inset:0;width:100%;height:100%}
/* Held until the line is decoded (GO_SCRIPT), so image and CSS start together. */
html[data-launch] #flux-launch *{animation-play-state:paused}
html[data-launch-go] #flux-launch *{animation-play-state:running}
/* Each moving part on a layer of its own: the compositor moves it, never the main thread. */
#flux-launch .fl-glow,#flux-launch .fl-ghost,#flux-launch .fl-line{will-change:opacity}
#flux-launch .fl-final,#flux-launch .fl-word{will-change:opacity,transform}
#flux-launch .fl-glow{position:absolute;left:50%;top:50%;width:380px;height:380px;margin:-190px 0 0 -190px;border-radius:50%;
background:radial-gradient(circle,rgba(124,125,255,.32) 0%,rgba(75,134,255,.1) 42%,transparent 70%);opacity:0;
animation:fl-in .6s calc(var(--t) + 1.15s) ease-out forwards}
/* A gap longer than the path: with 1 1, a dash of rounding length showed as a dot at the far end. */
#flux-launch svg path{fill:none;stroke-width:${STROKE_WIDTH};stroke-linecap:round;stroke-linejoin:round}
#flux-launch .fl-ghost{opacity:0}
html[data-launch=retrace] #flux-launch .fl-ghost{opacity:1;animation:fl-ghost .4s .05s ease-in-out forwards}
/* The line draws itself (an animated image, glow included); here it only fades once the mark has settled. */
#flux-launch .fl-line{animation:fl-out .35s calc(var(--t) + 1.7s) ease forwards}
#flux-launch .fl-final{opacity:0;transform:scale(.985);animation:fl-settle .4s calc(var(--t) + 1.3s) cubic-bezier(.2,.8,.2,1) forwards}
#flux-launch .fl-word{position:absolute;left:50%;top:calc(50% + 86px);width:auto;height:28px;opacity:0;transform:translate(-50%,10px);
animation:fl-rise .5s calc(var(--t) + 1.35s) cubic-bezier(.2,.8,.2,1) forwards}
@keyframes fl-ghost{to{opacity:.14}}
@keyframes fl-settle{to{opacity:1;transform:none}}
@keyframes fl-rise{to{opacity:1;transform:translate(-50%,0)}}
@keyframes fl-in{to{opacity:1}}
@keyframes fl-out{to{opacity:0}}
@keyframes fl-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}
html[data-launch=still] #flux-launch *{animation:none!important}
html[data-launch=still] #flux-launch .fl-line,html[data-launch=still] #flux-launch .fl-ghost{display:none}
html[data-launch=still] #flux-launch .fl-final{opacity:1;transform:none}
html[data-launch=still] #flux-launch .fl-word{opacity:1;transform:translate(-50%,0)}
html[data-launch=still] #flux-launch .fl-glow{opacity:1}
`;
