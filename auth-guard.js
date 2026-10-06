/* Shared authentication. The local stamp is a UI hint; Supabase + RLS authorize data. */
(function (global) {
  "use strict";
  const config = global.LFC_CONFIG;
  const script = document.currentScript;
  const base = new URL(".", script.src);
  const isSignin = location.pathname.endsWith("/signin.html");
  const KEY = "lfc.auth";
  let user = null,
    signingOut = false;
  const storage = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    remove(k) {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  };
  const client = global.supabase.createClient(config.url, config.anonKey, {
    auth: { storageKey: config.storageKey, detectSessionInUrl: false },
    global: {
      fetch: (url, options = {}) =>
        fetch(url, {
          ...options,
          signal: options.signal || AbortSignal.timeout(12000),
        }),
    },
  });
  function safeTarget(raw) {
    try {
      const target = new URL(raw || "index.html", base);
      const relative = target.pathname.slice(base.pathname.length);
      const allowed =
        /^(index|performance|admin|scanner|setups|gex|crypto)\.html$|^funds\/(index|funds|scheme|compare|calculators|methodology|legal)\.html$/;
      return target.origin === base.origin &&
        target.pathname.startsWith(base.pathname) &&
        allowed.test(relative)
        ? target.pathname + target.search + target.hash
        : new URL("index.html", base).pathname;
    } catch {
      return new URL("index.html", base).pathname;
    }
  }
  function clear() {
    user = null;
    storage.remove(KEY);
    storage.remove(config.storageKey);
    storage.remove(config.storageKey + "-code-verifier");
  }
  function redirect() {
    const next =
      location.pathname.slice(base.pathname.length) +
      location.search +
      location.hash;
    location.replace(
      new URL(
        "signin.html" + (isSignin ? "" : "?next=" + encodeURIComponent(next)),
        base,
      ),
    );
  }
  function stamp(u) {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          u: u.id,
          n: u.display_name || u.username,
          a: !!u.is_admin,
          t: Date.now(),
        }),
      );
    } catch {}
  }
  async function verify() {
    const {
      data: { session },
      error,
    } = await client.auth.getSession();
    if (error) throw error;
    if (!session) return null;
    const checked = await client.auth.getUser();
    if (checked.error || !checked.data.user) {
      clear();
      return null;
    }
    const { data, error: profileError } = await client
      .from("app_users")
      .select("id,username,display_name,is_admin,is_active")
      .eq("id", checked.data.user.id)
      .single();
    if (profileError) throw profileError;
    if (!data?.is_active) {
      await logout(false);
      return null;
    }
    user = data;
    stamp(data);
    return data;
  }
  async function logout(navigate = true) {
    if (signingOut) return;
    signingOut = true;
    document.documentElement.classList.remove("auth-ready");
    document.documentElement.classList.add("auth-pending");
    // Start revocation while the client still has the session; clear local credentials immediately.
    const revocation = client.auth.signOut({ scope: "local" }).catch(() => {});
    clear();
    try {
      await Promise.race([
        revocation,
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    } finally {
      clear();
      if (navigate) location.replace(new URL("signin.html?loggedOut=1", base));
      else signingOut = false;
    }
  }
  async function init() {
    try {
      const result = await verify();
      if (!result && !isSignin) {
        clear();
        redirect();
        return new Promise(() => {});
      }
      document.documentElement.classList.remove("auth-pending");
      document.documentElement.classList.add("auth-ready");
      return result;
    } catch (error) {
      if (isSignin) return null;
      const showError = () => {
        const panel = document.createElement("div");
        panel.className = "auth-error";
        panel.innerHTML =
          '<h1>We couldn’t verify your session</h1><p>Please check your connection and try again.</p><button id="authRetry">Retry</button> <button id="authExit">Return to sign in</button>';
        document.body.append(panel);
        panel.querySelector("#authRetry").onclick = () => location.reload();
        panel.querySelector("#authExit").onclick = () => logout();
      };
      if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", showError);
      else showError();
      return new Promise(() => {});
    }
  }
  if (!isSignin) document.documentElement.classList.add("auth-pending");
  const ready = init();
  global.LfcAuth = {
    client,
    ready,
    current: () => user,
    stamp,
    clear,
    logout,
    verify,
    safeTarget,
    base,
    require: async (fn) => {
      await ready;
      return fn?.();
    },
    guard: () => ready,
  };
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && !signingOut && !isSignin) {
      clear();
      redirect();
    }
  });
  addEventListener("storage", (event) => {
    if (
      (event.key === KEY || event.key === config.storageKey) &&
      !event.newValue &&
      !isSignin
    ) {
      clear();
      redirect();
    }
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted && !isSignin) {
      document.documentElement.classList.add("auth-pending");
      if (!storage.get(config.storageKey)) {
        clear();
        redirect();
      } else location.reload();
    }
  });
})(window);
