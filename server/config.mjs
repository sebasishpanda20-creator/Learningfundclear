// Worker configuration (source of truth for the deployed runtime).
// assets/js/config.js mirrors these public values for the browser; anonKey is a
// public Supabase anon key, never a service-role key or broker secret.
const config = {
  url: "",
  anonKey:
    "",
  storageKey: "",
  fyersBase: "/api/fyers",
};

export default config;
