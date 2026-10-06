(function () {
  function apply(dark) {
    document.documentElement.classList.toggle("theme-dark", dark);
    document.querySelectorAll("[data-lfc-theme-toggle]").forEach((b) => {
      b.textContent = dark ? "Light appearance" : "Dark appearance";
      b.setAttribute("aria-pressed", String(dark));
    });
  }
  try {
    apply(localStorage.getItem("lfc.theme") === "dark");
  } catch {
    apply(false);
  }
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-lfc-theme-toggle]")) return;
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
