import { APP_CONFIG } from "@/config/app-config";

/**
 * The opening screen: the mark draws itself, the name rises under it, a thin bar
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
            <svg viewBox="0 0 24 24" width="52" height="52" role="presentation">
              <path
                className="fs-glyph"
                pathLength={100}
                d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
              />
            </svg>
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
background:radial-gradient(120% 75% at 50% 0%,#3a6bff 0%,#1447e6 38%,#0c2fa8 72%,#071d6e 100%);
transition:opacity .5s ease,visibility .5s ease,transform .6s cubic-bezier(.2,.8,.2,1);
animation:fs-failsafe .4s 6s forwards}
html[data-splash=done] #flux-splash{opacity:0;visibility:hidden;transform:scale(1.06);pointer-events:none}
html[data-splash=off] #flux-splash{display:none}
#flux-splash .fs-glow{position:absolute;left:50%;top:50%;width:560px;height:560px;margin:-300px 0 0 -280px;border-radius:50%;
background:radial-gradient(circle,rgba(140,175,255,.55) 0%,rgba(90,130,255,.18) 40%,transparent 70%);animation:fs-breathe 2.8s ease-in-out infinite}
#flux-splash .fs-center{position:relative;display:flex;flex-direction:column;align-items:center}
#flux-splash .fs-mark{position:relative;overflow:hidden;display:grid;place-items:center;width:104px;height:104px;border-radius:28px;
background:linear-gradient(150deg,rgba(255,255,255,.26),rgba(255,255,255,.07));border:1px solid rgba(255,255,255,.3);
box-shadow:0 24px 60px -12px rgba(2,10,50,.65),inset 0 1px 0 rgba(255,255,255,.4);
animation:fs-pop .8s cubic-bezier(.2,.9,.25,1.15) both}
#flux-splash .fs-mark::after{content:"";position:absolute;inset:0;border-radius:inherit;transform:translateX(-130%);
background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.5) 50%,transparent 70%);animation:fs-shine .8s .9s ease-in-out forwards}
#flux-splash .fs-glyph{fill:none;stroke:#fff;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;
stroke-dasharray:100;stroke-dashoffset:100;animation:fs-draw .8s .15s cubic-bezier(.6,0,.2,1) forwards}
#flux-splash .fs-word{margin-top:26px;font:600 30px/1.1 var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);
letter-spacing:-.02em;opacity:0;transform:translateY(10px);animation:fs-rise .6s .45s cubic-bezier(.2,.8,.2,1) forwards}
#flux-splash .fs-bar{position:absolute;left:50%;bottom:calc(56px + env(safe-area-inset-bottom));width:132px;height:3px;margin-left:-66px;
border-radius:3px;overflow:hidden;background:rgba(255,255,255,.18);opacity:0;animation:fs-fade .4s .6s forwards}
#flux-splash .fs-bar i{position:absolute;top:0;bottom:0;width:42%;border-radius:3px;background:#fff;animation:fs-slide 1.15s ease-in-out infinite}
@keyframes fs-pop{from{opacity:0;transform:scale(.72) translateY(6px)}to{opacity:1;transform:none}}
@keyframes fs-draw{to{stroke-dashoffset:0}}
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
