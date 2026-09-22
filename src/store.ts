/**
 * Which store the screens talk to. One store today; the server already keys
 * everything by store id, so a second store is `?store=<id>` (remembered in the
 * browser) with no other change on this side.
 */
const fromUrl = (() => { try { return new URLSearchParams(window.location.search).get('store'); } catch { return null; } })();
const remembered = (() => { try { return window.localStorage.getItem('loopdesk.store'); } catch { return null; } })();
export const STORE: string = fromUrl ?? remembered ?? 'climax';
try { if (fromUrl) window.localStorage.setItem('loopdesk.store', fromUrl); } catch { /* private mode */ }
