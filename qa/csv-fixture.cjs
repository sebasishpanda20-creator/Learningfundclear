/**
 * Deterministic daily OHLCV series for the scanner's local CSV path.
 *
 * The shape matters: a sustained decline into a base, a bounce, then a
 * pullback that rests on the base — the structure a demand-zone scan looks for.
 * The series ends today because the scanner rejects daily history older than
 * four days.
 */
function makeCsv() {
  const lines = ["symbol,date,open,high,low,close,volume"];
  const today = new Date();
  const start =
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
    139 * 86400000;

  const write = (sym, closes) => {
    for (let i = 0; i < closes.length; i++) {
      const d = new Date(start + i * 86400000);
      const c = closes[i];
      const o = i === 0 ? c : closes[i - 1];
      const h = Math.max(o, c) * 1.008;
      const l = Math.min(o, c) * 0.992;
      lines.push(
        [
          sym,
          d.toISOString().slice(0, 10),
          o.toFixed(2),
          h.toFixed(2),
          l.toFixed(2),
          c.toFixed(2),
          900000 + i * 500,
        ].join(","),
      );
    }
  };

  const a = [];
  for (let i = 0; i < 100; i++) a.push(220 - i * 1.1 + Math.sin(i / 3) * 0.6);
  for (let i = 0; i < 22; i++) a.push(110 + Math.sin(i / 2) * 0.5);
  for (let i = 0; i < 8; i++) a.push(110 + i * 1.4);
  for (let i = 0; i < 10; i++) a.push(121 - i * 1.3);
  write("TESTONE.NS", a);

  const b = [];
  for (let i = 0; i < 100; i++) b.push(520 - i * 2.2 + Math.cos(i / 4) * 1.2);
  for (let i = 0; i < 22; i++) b.push(300 + Math.cos(i / 2) * 1.1);
  for (let i = 0; i < 8; i++) b.push(300 + i * 3.1);
  for (let i = 0; i < 10; i++) b.push(325 - i * 2.8);
  write("TESTTWO.NS", b);

  return lines.join("\n");
}

module.exports = { makeCsv };
