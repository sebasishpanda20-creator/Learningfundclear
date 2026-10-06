(function () {
  const form = document.getElementById("loginForm"),
    button = document.getElementById("loginBtn"),
    msg = document.getElementById("msg"),
    pass = document.getElementById("loginPass");
  const params = new URLSearchParams(location.search);
  if (params.has("loggedOut"))
    msg.textContent = "You’re signed out of this browser.";
  document.getElementById("showPassword").onclick = function () {
    const show = pass.type === "password";
    pass.type = show ? "text" : "password";
    this.textContent = show ? "Hide" : "Show";
    this.setAttribute("aria-label", show ? "Hide password" : "Show password");
  };
  LfcAuth.ready.then((user) => {
    if (user && !params.has("loggedOut"))
      location.replace(LfcAuth.safeTarget(params.get("next")));
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
      location.replace(LfcAuth.safeTarget(params.get("next")));
    } catch (error) {
      msg.textContent = error.message?.includes("Invalid login")
        ? "Username or password is incorrect. Please try again."
        : "Unable to sign in. Check your connection and credentials, then try again.";
    } finally {
      button.disabled = false;
    }
  };
})();
