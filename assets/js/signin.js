(function () {
  const form = document.getElementById("loginForm"),
    button = document.getElementById("loginBtn"),
    msg = document.getElementById("msg"),
    pass = document.getElementById("loginPass"),
    help = document.getElementById("help");
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
  // Access is granted by an administrator, so these two links explain the route
  // instead of pretending to be a self-service flow the portal cannot offer.
  function showHelp(text) {
    if (!help) return;
    help.hidden = false;
    help.textContent = text;
    msg.textContent = "";
  }
  const request = document.getElementById("requestAccess");
  if (request)
    request.onclick = () =>
      showHelp(
        "Access is granted by your portal administrator — ask them to enable an account, then sign in here.",
      );
  const forgot = document.getElementById("forgotPassword");
  if (forgot)
    forgot.onclick = () =>
      showHelp(
        "Passwords are reset by your portal administrator. Ask them to issue you a new one.",
      );
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
