import { APP_CONFIG } from "@/config/app-config";

/**
 * The opening screen: the app's tile pops in, the name rises under it, a thin bar
 * says the app is on its way — and then it lifts away as the page is ready.
 *
 * ⚠️ Plain HTML, CSS and one inline script, rendered by the root layout, on
 * purpose. A splash made of React components appears only once the JavaScript
 * that draws it has arrived, which is exactly the wait it exists to cover: here it
 * is in the first bytes of the document and paints before anything else loads.
 *
 * ⚠️⚠️ It can never trap anybody behind it. The script lifts it on `load` (after
 * at least long enough to finish the animation), a timer lifts it at five seconds
 * whatever happens, and if the script never runs at all — blocked, broken, no
 * JavaScript — a CSS animation hides it at six. It is `aria-hidden` and ignores
 * the pointer once lifting.
 *
 * Once per browsing session: the first open of the installed app or of a tab,
 * not every reload. `sessionStorage` is per tab and cleared when the tab (or the
 * standalone app) closes, which is the rhythm of "opening the app".
 *
 * The colours continue the platform's own launch screen — Android paints the
 * manifest's `background_color`, iOS the startup images from
 * scripts/generate-pwa-icons.mjs — so the hand-over from the system to the page
 * is one gradient, not a white flash between two.
 */
export function SplashScreen({ nonce }: { nonce?: string }) {
  const script = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem("flux-splash")){d.setAttribute("data-splash","off");return}sessionStorage.setItem("flux-splash","1")}catch(e){}var s=Date.now(),m=matchMedia("(prefers-reduced-motion: reduce)").matches?250:1100;function lift(){setTimeout(function(){d.setAttribute("data-splash","done")},Math.max(0,m-(Date.now()-s)))}if(document.readyState==="complete")lift();else addEventListener("load",lift,{once:true});setTimeout(function(){d.setAttribute("data-splash","done")},5000)})();`;

  return (
    <>
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS, no user input
        dangerouslySetInnerHTML={{ __html: SPLASH_CSS }}
      />
      <script
        nonce={nonce}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static script, no user input
        dangerouslySetInnerHTML={{ __html: script }}
      />
      <div id="flux-splash" aria-hidden="true">
        <div className="fs-glow" />
        <div className="fs-center">
          <div className="fs-mark">
            {/* The tile itself (scripts/generate-pwa-icons.mjs), as on the home screen and in the
                launch images: an image rather than inline SVG, which would put the mark's
                twenty kilobytes into every page's HTML. */}
            {/* biome-ignore lint/performance/noImgElement: plain HTML painted before React, by design */}
            <img src="/icons/icon.svg" alt="" width={104} height={104} fetchPriority="high" />
          </div>
          <div className="fs-word">{APP_CONFIG.name}</div>
        </div>
        <div className="fs-bar">
          <i />
        </div>
      </div>
    </>
  );
}

const SPLASH_CSS = `
#flux-splash{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;overflow:hidden;color:#fff;
background:radial-gradient(120% 75% at 50% 0%,#25386f 0%,#15224d 38%,#0c1633 72%,#070d22 100%);
transition:opacity .5s ease,visibility .5s ease,transform .6s cubic-bezier(.2,.8,.2,1);
animation:fs-failsafe .4s 6s forwards}
html[data-splash=done] #flux-splash{opacity:0;visibility:hidden;transform:scale(1.06);pointer-events:none}
html[data-splash=off] #flux-splash{display:none}
#flux-splash .fs-glow{position:absolute;left:50%;top:50%;width:560px;height:560px;margin:-300px 0 0 -280px;border-radius:50%;
background:radial-gradient(circle,rgba(124,125,255,.38) 0%,rgba(75,134,255,.12) 40%,transparent 70%);animation:fs-breathe 2.8s ease-in-out infinite}
#flux-splash .fs-center{position:relative;display:flex;flex-direction:column;align-items:center}
#flux-splash .fs-mark{position:relative;overflow:hidden;width:104px;height:104px;border-radius:30px;
box-shadow:0 24px 60px -12px rgba(1,4,15,.75),0 0 0 1px rgba(255,255,255,.14);
animation:fs-pop .8s cubic-bezier(.2,.9,.25,1.15) both}
#flux-splash .fs-mark img{display:block;width:104px;height:104px}
#flux-splash .fs-mark::after{content:"";position:absolute;inset:0;border-radius:inherit;transform:translateX(-130%);
background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.5) 50%,transparent 70%);animation:fs-shine .8s .9s ease-in-out forwards}
#flux-splash .fs-word{margin-top:26px;font:600 30px/1.1 var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
letter-spacing:-.02em;opacity:0;transform:translateY(10px);animation:fs-rise .6s .45s cubic-bezier(.2,.8,.2,1) forwards}
#flux-splash .fs-bar{position:absolute;left:50%;bottom:calc(56px + env(safe-area-inset-bottom));width:132px;height:3px;margin-left:-66px;
border-radius:3px;overflow:hidden;background:rgba(255,255,255,.18);opacity:0;animation:fs-fade .4s .6s forwards}
#flux-splash .fs-bar i{position:absolute;top:0;bottom:0;width:42%;border-radius:3px;background:#fff;animation:fs-slide 1.15s ease-in-out infinite}
@keyframes fs-pop{from{opacity:0;transform:scale(.72) translateY(6px)}to{opacity:1;transform:none}}
@keyframes fs-shine{to{transform:translateX(130%)}}
@keyframes fs-rise{to{opacity:1;transform:none}}
@keyframes fs-fade{to{opacity:1}}
@keyframes fs-slide{from{left:-42%}to{left:100%}}
@keyframes fs-breathe{0%,100%{transform:scale(.92);opacity:.75}50%{transform:scale(1.05);opacity:1}}
@keyframes fs-failsafe{to{opacity:0;visibility:hidden;pointer-events:none}}
@media (prefers-reduced-motion:reduce){
#flux-splash,#flux-splash *{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important}
#flux-splash{animation:fs-failsafe .4s 6s forwards!important}
#flux-splash .fs-bar,#flux-splash .fs-mark::after{display:none}}
`;
