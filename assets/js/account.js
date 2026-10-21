(function () {
  "use strict";
  const form = document.getElementById("passwordForm"), button = document.getElementById("changePassword"), status = document.getElementById("passwordStatus");
  const current = document.getElementById("currentPassword"), next = document.getElementById("nextPassword"), confirm = document.getElementById("confirmPassword");
  let profile;
  LfcAuth.ready.then(user => { if (!user) return; profile = user; document.getElementById("accountUsername").textContent = user.username; button.disabled = false; });
  form.onsubmit = async event => {
    event.preventDefault();
    if (!profile || button.disabled) return;
    if (next.value.length < 12 || next.value !== confirm.value) { status.textContent = "Use at least 12 characters and enter the same new password twice."; return; }
    if (next.value === current.value) { status.textContent = "Choose a password different from your current password."; return; }
    button.disabled = true;
    status.textContent = "Verifying your account…";
    let changed = false;
    try {
      const checked = await LfcAuth.client.auth.getUser();
      if (checked.error || checked.data?.user?.id !== profile.id || !checked.data.user.email) throw new Error("session");
      const signed = await LfcAuth.client.auth.signInWithPassword({email: checked.data.user.email, password: current.value});
      if (signed.error || signed.data?.user?.id !== profile.id) { status.textContent = "Could not verify your current password. Check it and try again."; return; }
      const updated = await LfcAuth.client.auth.updateUser({password: next.value});
      if (updated.error) { status.textContent = "Password was not changed. Supabase may require a stronger password or additional verification. Try signing in again, then retry."; return; }
      changed = true;
      status.textContent = "Password changed. Sign in again with your new password.";
      form.hidden = true;
      document.getElementById("signInAgain").hidden = false;
      await LfcAuth.logout();
    } catch (_) {
      status.textContent = changed ? "Password changed. Sign in again with your new password." : "Unable to confirm the change. Check your connection. If sign-in fails, try your new password before retrying.";
    } finally {
      current.value = next.value = confirm.value = "";
      if (!changed) button.disabled = false;
    }
  };
})();
