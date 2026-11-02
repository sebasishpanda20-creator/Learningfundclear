/* Quant Desk embedding configuration.
 *
 * `url` is the origin of the running Quant execution daemon. It must be an
 * HTTPS origin that stays stable — the daemon serves its own UI, so the desk
 * below simply frames that origin.
 *
 * Current value is a Cloudflare Quick Tunnel: it works while `cloudflared` is
 * running on the daemon machine, but the hostname changes every time that
 * process restarts. Replace it with a named-tunnel hostname
 * (e.g. https://quant.example.com) or a hosted daemon URL once one exists;
 * this is the only line that needs to change.
 */
window.QUANT_TERMINAL = {
  url: "https://telling-bar-healing-gently.trycloudflare.com",
};
