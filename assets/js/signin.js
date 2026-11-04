(function () {
  const form = document.getElementById("loginForm"),
    button = document.getElementById("loginBtn"),
    msg = document.getElementById("msg"),
    pass = document.getElementById("loginPass");
  const params = new URLSearchParams(location.search);
  // Collapse previously nested sign-in return URLs without another navigation.
  if (params.has("next")) {
    params.set("next", LfcAuth.safeTarget(params.get("next")));
    history.replaceState(null, "", location.pathname + "?" + params.toString());
  }
  if (params.has("loggedOut"))
    msg.textContent = "You’re signed out of this browser.";
  // Where to land after sign-in: an explicit ?next= deep link always wins,
  // then the desk the user was last on (recorded by shell.js on every verified
  // page), then the dashboard. LfcAuth.safeTarget validates whatever this
  // returns — unknown or off-origin values fall back to index.html.
  function resumeTarget() {
    try {
      return params.get("next") || localStorage.getItem("lfc.lastPage");
    } catch {
      return params.get("next");
    }
  }
  const target = () => LfcAuth.safeTarget(resumeTarget());
  document.getElementById("showPassword").onclick = function () {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
    this.setAttribute("aria-label", show ? "Hide password" : "Show password");
  };
  LfcAuth.ready.then((user) => {
    if (user && !params.has("loggedOut"))
      location.replace(target());
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const username = document.getElementById("loginUser").value.trim();
    if (!username || !pass.value) {
      msg.textContent = "Enter your username and password.";
      return;
    }
    button.disabled = true;
    msg.textContent = "Signing in…";
    try {
      const { error } = await LfcAuth.client.auth.signInWithPassword({
        email: (username.includes("@")
          ? username
          : username + "@portal.local"
        ).toLowerCase(),
        password: pass.value,
      });
      if (error) throw error;
      const user = await LfcAuth.verify();
      if (!user) {
        msg.textContent =
          "This account is not active. Contact your administrator.";
        return;
      }
      pass.value = "";
      location.replace(target());
    } catch (error) {
      msg.textContent = error.message?.includes("Invalid login")
        ? "Username or password is incorrect. Please try again."
        : "Unable to sign in. Check your connection and credentials, then try again.";
    } finally {
      button.disabled = false;
    }
  };
})();
