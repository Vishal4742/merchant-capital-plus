// The day/night choice (batch 060, FR-UX-4). tokens.css styles <html data-theme="light"|"dark">, and with no data-theme
// it follows the device (prefers-color-scheme). A plain module, not the "use client" toggle's: the root layout (a server
// component) needs these values, and a client module's exports reach the server only as references.
export type Theme = "light" | "dark";

export const THEME_KEY = "mcplus.theme"; // kept by the Whiteflow rename sweep (mcplus.* keys stay)

/** Runs inline in <head> before first paint, so a saved choice never flashes the other theme. The stored value is only
 * compared, never written into the page; private mode's throwing localStorage leaves the device's choice. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
