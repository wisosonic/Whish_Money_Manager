// App identity, in one place. Components import from here instead of hardcoding the name or logo.
// (The browser tab title/icon in index.html and public/manifest.json can't import JS — keep them in sync.)
import logo from "@/assets/images/logo.png";
import ar from "@/locales/ar";

export const APP_NAME = "Whish Money Manager";
export const APP_SHORT_NAME = "Whish Manager";
// The tagline is translated (key "app.tagline"); this is the Arabic default for non-React code.
export const APP_TAGLINE = ar["app.tagline"];
export const APP_LOGO = logo;
