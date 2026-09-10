import { SESSION_COOKIE } from "./session-cookie";

const clientStateScript = [
  "(function(){",
  'var c="; "+document.cookie;',
  'var has=function(p){return c.indexOf("; "+p)>-1};',
  "var r=document.documentElement;",
  `r.setAttribute("data-session",has("${SESSION_COOKIE}")?"authed":"anon");`,
  "})();",
].join("");

export { clientStateScript };
