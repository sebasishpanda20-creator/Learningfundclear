(function () {
  function apply(dark) {
    document.documentElement.classList.toggle("theme-dark", dark);
    document.querySelectorAll("[data-lfc-theme-toggle],.topbar-theme").forEach((b) => {
      b.textContent = b.classList.contains("topbar-theme") ? (dark ? "☀" : "☾") : (dark ? "Light appearance" : "Dark appearance");
      b.setAttribute("aria-label",dark ? "Switch to light appearance" : "Switch to dark appearance");
      b.setAttribute("aria-pressed", String(dark));
    });
  }
  try {
    apply(localStorage.getItem("lfc.theme") === "dark");
  } catch {
    apply(false);
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-lfc-theme-toggle],.topbar-theme")) return;
    const dark = !document.documentElement.classList.contains("theme-dark");
    apply(dark);
    try {
      localStorage.setItem("lfc.theme", dark ? "dark" : "light");
    } catch {}
  });
  document.addEventListener("DOMContentLoaded", () =>
    apply(document.documentElement.classList.contains("theme-dark")),
  );
})();
