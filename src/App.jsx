import { useState, useEffect } from "react";
import Papa from "papaparse";
import {
  FlaskConical, Calculator, Target, Upload, History, LogOut,
  ChevronRight, ChevronDown, Trash2, AlertCircle, CheckCircle2,
  Loader2, Save, X, Plus, Minus, TrendingUp,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import {
  twoProportionZTest, welchTTest, sampleSizeForProportion, summarizeRawData,
  chiSquareTest, oneWayANOVA, mannWhitneyU, bayesianProportionTest,
  betaPDF, normalPDF,
} from "./lib/stats";

// ============================================================================
// Small shared UI pieces
// ============================================================================

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-wider text-text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-text-faint">{hint}</span>}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-text " +
        "font-mono placeholder:text-text-faint focus:border-control focus:outline-none " +
        "focus:ring-1 focus:ring-control " + (props.className || "")
      }
    />
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="no-scrollbar inline-flex min-w-0 max-w-full gap-0 overflow-x-auto rounded-lg border border-line bg-paper p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
            (value === opt.value
              ? "bg-paper-raised text-text shadow-sm ring-1 ring-line"
              : "text-text-muted hover:text-text")
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Badge({ signal, children }) {
  const cls = signal
    ? "bg-signal-dim text-signal ring-1 ring-signal/40"
    : "bg-noise-dim text-noise ring-1 ring-noise/40";
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-semibold " + cls}>
      {signal ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {children}
    </span>
  );
}

// The signature element: a signal/noise gauge showing where the p-value
// lands relative to the alpha threshold.
function SignificanceMeter({ pValue, alpha }) {
  const maxScale = Math.max(alpha * 4, pValue * 1.15, 0.1);
  const pct = Math.min(100, (pValue / maxScale) * 100);
  const alphaPct = Math.min(100, (alpha / maxScale) * 100);
  const isSig = pValue < alpha;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-xs font-mono text-text-muted">
        <span>0</span>
        <span>p-value scale →</span>
        <span>{maxScale.toFixed(2)}</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-paper-raised ring-1 ring-line">
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${alphaPct}%`,
            background: "linear-gradient(90deg, var(--color-signal-dim), var(--color-signal))",
            opacity: 0.35,
          }}
        />
        <div
          className="absolute top-0 h-full"
          style={{
            left: `${alphaPct}%`,
            width: `${100 - alphaPct}%`,
            background: "var(--color-noise-dim)",
            opacity: 0.35,
          }}
        />
        <div
          className="absolute top-[-3px] h-[18px] w-[2px] bg-text-muted"
          style={{ left: `calc(${alphaPct}% - 1px)` }}
          title={`α = ${alpha}`}
        />
        <div
          className="absolute top-0 h-full w-[3px] rounded-full transition-all"
          style={{ left: `calc(${pct}% - 1.5px)`, background: isSig ? "var(--color-signal)" : "var(--color-noise)" }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs font-mono text-text-faint">α = {alpha}</span>
        <span className={"text-xs font-mono font-semibold " + (isSig ? "text-signal" : "text-noise")}>
          {isSig ? "SIGNAL TERDETEKSI" : "BELUM SIGNIFIKAN — NOISE"}
        </span>
      </div>
    </div>
  );
}

function CompareBars({ v1, v2, format }) {
  const max = Math.max(v1, v2, 0.0001);
  return (
    <div className="space-y-2.5">
      {[["Control", v1, "control"], ["Variant", v2, "variant"]].map(([name, v, key]) => (
        <div key={name}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-mono uppercase tracking-wider text-text-muted">{name}</span>
            <span className="font-mono font-semibold text-text">{format(v)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-paper-raised">
            <div
              className="h-2 rounded-full"
              style={{ width: `${(v / max) * 100}%`, background: `var(--color-${key})` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalCurvePoints(m, sd, n = 60) {
  const points = [];
  const lo = m - 4 * sd, hi = m + 4 * sd;
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    points.push({ x, y: normalPDF(x, m, sd) });
  }
  return points;
}

// Wilson score interval — more reliable than the plain Wald interval for
// proportions, especially with smaller samples.
function wilsonCI(p, n, z = 1.96) {
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

// ============================================================================
// CHART PRIMITIVES — plain SVG, no charting library. Kept consistent with the
// control (blue) / variant (amber) duotone used everywhere else.
// ============================================================================
const CHART_W = 400, CHART_H = 160, PAD_L = 8, PAD_R = 8, PAD_T = 10, PAD_B = 22;

function pathFromPoints(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

// Overlaid curves for control vs variant — either normal approximations
// (frequentist) or actual Beta posteriors (Bayesian).
function DistributionChart({ curves, xFormat }) {
  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;
  const xMin = Math.min(...curves.flatMap((c) => c.points.map((p) => p.x)));
  const xMax = Math.max(...curves.flatMap((c) => c.points.map((p) => p.x)));
  const yMax = Math.max(...curves.flatMap((c) => c.points.map((p) => p.y))) * 1.08 || 1;

  const sx = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (y) => PAD_T + innerH - (y / yMax) * innerH;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ height: 170 }}>
      <line x1={PAD_L} y1={PAD_T + innerH} x2={CHART_W - PAD_R} y2={PAD_T + innerH} stroke="var(--color-line)" strokeWidth="1" />
      {curves.map((c) => {
        const pts = c.points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
        const areaPts = [{ x: pts[0].x, y: sy(0) }, ...pts, { x: pts[pts.length - 1].x, y: sy(0) }];
        return (
          <g key={c.label}>
            <path d={pathFromPoints(areaPts) + " Z"} fill={c.color} opacity="0.14" />
            <path d={pathFromPoints(pts)} fill="none" stroke={c.color} strokeWidth="2" />
          </g>
        );
      })}
      <text x={PAD_L} y={CHART_H - 4} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-text-faint)">
        {xFormat ? xFormat(xMin) : xMin.toFixed(2)}
      </text>
      <text x={CHART_W - PAD_R} y={CHART_H - 4} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-text-faint)" textAnchor="end">
        {xFormat ? xFormat(xMax) : xMax.toFixed(2)}
      </text>
      {curves.map((c, i) => (
        <g key={c.label} transform={`translate(${PAD_L + i * 90}, ${PAD_T})`}>
          <rect width="8" height="8" rx="2" fill={c.color} />
          <text x="12" y="8" fontSize="10" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">{c.label}</text>
        </g>
      ))}
    </svg>
  );
}

// Horizontal bars with a point estimate + confidence/credible interval whiskers —
// one row per group, works for 2 groups or many (multi-variant tests).
function ForestPlot({ rows, xFormat }) {
  const rowH = 34;
  const height = rows.length * rowH + PAD_T + 20;
  const labelW = 84;
  const innerW = CHART_W - labelW - PAD_R - 10;
  const xMin = Math.min(...rows.map((r) => r.ci[0]), ...rows.map(r=>r.estimate));
  const xMax = Math.max(...rows.map((r) => r.ci[1]), ...rows.map(r=>r.estimate));
  const pad = (xMax - xMin) * 0.15 || 0.01;
  const domainMin = xMin - pad, domainMax = xMax + pad;
  const sx = (x) => labelW + ((x - domainMin) / (domainMax - domainMin || 1)) * innerW;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${height}`} className="w-full" style={{ height: height * 0.85 }}>
      {rows.map((r, i) => {
        const y = PAD_T + i * rowH + rowH / 2;
        return (
          <g key={r.label}>
            <text x={0} y={y + 3} fontSize="10" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
              {r.label.length > 12 ? r.label.slice(0, 11) + "…" : r.label}
            </text>
            <line x1={sx(r.ci[0])} y1={y} x2={sx(r.ci[1])} y2={y} stroke={r.color} strokeWidth="2" opacity="0.6" />
            <line x1={sx(r.ci[0])} y1={y - 4} x2={sx(r.ci[0])} y2={y + 4} stroke={r.color} strokeWidth="2" opacity="0.6" />
            <line x1={sx(r.ci[1])} y1={y - 4} x2={sx(r.ci[1])} y2={y + 4} stroke={r.color} strokeWidth="2" opacity="0.6" />
            <circle cx={sx(r.estimate)} cy={y} r="4" fill={r.color} />
            <text x={sx(r.estimate)} y={y - 9} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-text)" textAnchor="middle">
              {xFormat ? xFormat(r.estimate) : r.estimate.toFixed(3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Dot/strip plot of raw values along a number line — used for the
// non-parametric test since Mann-Whitney makes no distributional assumption,
// so showing the actual points (not a fitted curve) is the honest choice.
function StripPlot({ control, variant }) {
  const all = [...control, ...variant];
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  const domainMin = min - pad, domainMax = max + pad;
  const innerW = CHART_W - PAD_L - PAD_R;
  const sx = (x) => PAD_L + ((x - domainMin) / (domainMax - domainMin || 1)) * innerW;
  const rowY = { control: 34, variant: 74 };

  return (
    <svg viewBox={`0 0 ${CHART_W} 100`} className="w-full" style={{ height: 100 }}>
      <line x1={PAD_L} y1={rowY.control} x2={CHART_W - PAD_R} y2={rowY.control} stroke="var(--color-line)" strokeWidth="1" />
      <line x1={PAD_L} y1={rowY.variant} x2={CHART_W - PAD_R} y2={rowY.variant} stroke="var(--color-line)" strokeWidth="1" />
      <text x={PAD_L} y={rowY.control - 8} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-control)">CONTROL</text>
      <text x={PAD_L} y={rowY.variant - 8} fontSize="9" fontFamily="var(--font-mono)" fill="var(--color-variant)">VARIANT</text>
      {control.map((v, i) => (
        <circle key={"c" + i} cx={sx(v)} cy={rowY.control} r="3.5" fill="var(--color-control)" opacity="0.75" />
      ))}
      {variant.map((v, i) => (
        <circle key={"v" + i} cx={sx(v)} cy={rowY.variant} r="3.5" fill="var(--color-variant)" opacity="0.75" />
      ))}
    </svg>
  );
}


function ResultPanel({ result }) {
  if (!result) return null;
  const isProp = result.testType === "proportion";
  return (
    <div className="space-y-5 rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-text-muted">
            {isProp ? "Uji Proporsi (Two-Proportion Z-Test)" : "Uji Rata-rata (Welch's T-Test)"}
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-text">
            p = {result.pValue < 0.0001 ? result.pValue.toExponential(2) : result.pValue.toFixed(4)}
          </div>
        </div>
        <Badge signal={result.significant}>{result.significant ? "Signifikan" : "Tidak Signifikan"}</Badge>
      </div>

      <SignificanceMeter pValue={result.pValue} alpha={result.alpha} />

      <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">{isProp ? "z-score" : "t-stat"}</div>
          <div className="font-mono text-lg text-text">{(isProp ? result.z : result.t).toFixed(3)}</div>
        </div>
        {!isProp && (
          <div>
            <div className="text-xs font-mono uppercase text-text-muted">df</div>
            <div className="font-mono text-lg text-text">{result.df.toFixed(1)}</div>
          </div>
        )}
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Lift Relatif</div>
          <div className="font-mono text-lg text-text">
            {result.relativeLift === null ? "—" : `${result.relativeLift >= 0 ? "+" : ""}${result.relativeLift.toFixed(2)}%`}
          </div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">CI {(1 - result.alpha) * 100}%</div>
          <div className="font-mono text-sm text-text">
            [{result.ci[0].toFixed(isProp ? 4 : 3)}, {result.ci[1].toFixed(isProp ? 4 : 3)}]
          </div>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <CompareBars
          v1={isProp ? result.p1 : result.m1}
          v2={isProp ? result.p2 : result.m2}
          format={(v) => (isProp ? `${(v * 100).toFixed(2)}%` : v.toFixed(2))}
        />
      </div>

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Distribusi (Aproksimasi Normal)</div>
          <DistributionChart
            xFormat={(v) => (isProp ? `${(v * 100).toFixed(1)}%` : v.toFixed(1))}
            curves={[
              { label: "Control", color: "var(--color-control)", points: normalCurvePoints(isProp ? result.p1 : result.m1, isProp ? Math.sqrt(result.p1 * (1 - result.p1) / result.n1) : result.sd1 / Math.sqrt(result.n1)) },
              { label: "Variant", color: "var(--color-variant)", points: normalCurvePoints(isProp ? result.p2 : result.m2, isProp ? Math.sqrt(result.p2 * (1 - result.p2) / result.n2) : result.sd2 / Math.sqrt(result.n2)) },
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Estimasi & CI</div>
          <ForestPlot
            xFormat={(v) => (isProp ? `${(v * 100).toFixed(1)}%` : v.toFixed(1))}
            rows={(() => {
              const est1 = isProp ? result.p1 : result.m1;
              const est2 = isProp ? result.p2 : result.m2;
              const ci1 = isProp ? wilsonCI(result.p1, result.n1) : [est1 - 1.96 * result.sd1 / Math.sqrt(result.n1), est1 + 1.96 * result.sd1 / Math.sqrt(result.n1)];
              const ci2 = isProp ? wilsonCI(result.p2, result.n2) : [est2 - 1.96 * result.sd2 / Math.sqrt(result.n2), est2 + 1.96 * result.sd2 / Math.sqrt(result.n2)];
              return [
                { label: "Control", estimate: est1, ci: ci1, color: "var(--color-control)" },
                { label: "Variant", estimate: est2, ci: ci2, color: "var(--color-variant)" },
              ];
            })()}
          />
        </div>
      </div>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
        {result.significant
          ? `Perbedaan antara control dan variant kemungkinan besar bukan kebetulan (p < α = ${result.alpha}). Cukup bukti untuk menolak hipotesis nol.`
          : `Belum cukup bukti statistik untuk menyimpulkan ada perbedaan nyata (p ≥ α = ${result.alpha}). Bisa jadi efeknya kecil, atau sampel belum cukup besar — lihat tab Sample Size.`}
      </p>
    </div>
  );
}

// Multi-variant result panel — shared by chi-square (proportion) and ANOVA (continuous)
function MultiVariantResultPanel({ result }) {
  const isChiSq = result.testType === "chisquare";
  const palette = ["var(--color-control)", "var(--color-variant)", "#a78bfa", "#f472b6", "#34d399", "#fbbf24"];
  const rows = result.groups.map((g, i) => ({
    label: g.name,
    estimate: isChiSq ? g.rate : g.mean,
    ci: g.ci,
    color: palette[i % palette.length],
  }));

  return (
    <div className="space-y-5 rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-text-muted">
            {isChiSq ? "Chi-Square Test of Independence" : "One-Way ANOVA"}
          </div>
          <div className="mt-1 font-mono text-3xl font-bold text-text">
            p = {result.pValue < 0.0001 ? result.pValue.toExponential(2) : result.pValue.toFixed(4)}
          </div>
        </div>
        <Badge signal={result.significant}>{result.significant ? "Signifikan" : "Tidak Signifikan"}</Badge>
      </div>

      <SignificanceMeter pValue={result.pValue} alpha={result.alpha} />

      <div className="grid grid-cols-3 gap-4 border-t border-line pt-4">
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">{isChiSq ? "χ²" : "F-stat"}</div>
          <div className="font-mono text-lg text-text">{(isChiSq ? result.chiSq : result.F).toFixed(3)}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">df</div>
          <div className="font-mono text-lg text-text">{isChiSq ? result.df : `${result.dfBetween}, ${result.dfWithin}`}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Grup</div>
          <div className="font-mono text-lg text-text">{result.groups.length}</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Perbandingan Antar Grup (dengan CI 95%)</div>
        <ForestPlot rows={rows} xFormat={(v) => (isChiSq ? `${(v * 100).toFixed(1)}%` : v.toFixed(1))} />
      </div>

      <div className="overflow-x-auto border-t border-line pt-3">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-text-muted">
              <th className="pb-2 font-mono font-normal uppercase">Grup</th>
              {isChiSq ? (
                <>
                  <th className="pb-2 font-mono font-normal uppercase">Konversi</th>
                  <th className="pb-2 font-mono font-normal uppercase">Rate</th>
                </>
              ) : (
                <>
                  <th className="pb-2 font-mono font-normal uppercase">n</th>
                  <th className="pb-2 font-mono font-normal uppercase">Mean</th>
                  <th className="pb-2 font-mono font-normal uppercase">SD</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="font-mono text-text">
            {result.groups.map((g) => (
              <tr key={g.name} className="border-t border-line/50">
                <td className="py-1.5">{g.name}</td>
                {isChiSq ? (
                  <>
                    <td className="py-1.5">{g.conversions}/{g.total}</td>
                    <td className="py-1.5">{(g.rate * 100).toFixed(2)}%</td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5">{g.n}</td>
                    <td className="py-1.5">{g.mean.toFixed(2)}</td>
                    <td className="py-1.5">{g.sd.toFixed(2)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
        {result.significant
          ? `Ada perbedaan signifikan di antara ${result.groups.length} grup ini (p < α = ${result.alpha}). ${isChiSq ? "Chi-square" : "ANOVA"} cuma bilang "ada beda", untuk tau grup mana vs mana lakukan uji lanjutan (post-hoc) atau bandingkan 2 grup langsung di tab Uji Proporsi/Rata-rata.`
          : `Belum cukup bukti ada perbedaan nyata di antara grup-grup ini (p ≥ α = ${result.alpha}).`}
      </p>
    </div>
  );
}

function MannWhitneyResultPanel({ result }) {
  return (
    <div className="space-y-5 rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-text-muted">Mann-Whitney U (Non-Parametrik)</div>
          <div className="mt-1 font-mono text-3xl font-bold text-text">
            p = {result.pValue < 0.0001 ? result.pValue.toExponential(2) : result.pValue.toFixed(4)}
          </div>
        </div>
        <Badge signal={result.significant}>{result.significant ? "Signifikan" : "Tidak Signifikan"}</Badge>
      </div>

      <SignificanceMeter pValue={result.pValue} alpha={result.alpha} />

      <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">U-statistic</div>
          <div className="font-mono text-lg text-text">{result.U.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">z-score</div>
          <div className="font-mono text-lg text-text">{result.z.toFixed(3)}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Median Control</div>
          <div className="font-mono text-lg text-control">{result.medianControl.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Median Variant</div>
          <div className="font-mono text-lg text-variant">{result.medianVariant.toFixed(2)}</div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Sebaran Data Aktual (bukan kurva — sesuai prinsip non-parametrik)</div>
        <StripPlot control={result.control} variant={result.variant} />
      </div>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
        Mann-Whitney U membandingkan <em>ranking/urutan</em> data, bukan rata-rata — cocok dipakai kalau data
        tidak berdistribusi normal atau ada outlier ekstrem. {result.significant
          ? `Ranking kedua grup berbeda signifikan (p < α = ${result.alpha}).`
          : `Belum cukup bukti perbedaan ranking antar grup (p ≥ α = ${result.alpha}).`}
      </p>
    </div>
  );
}

function BayesianResultPanel({ result }) {
  const probPct = result.probVariantBeatsControl * 100;
  const curves = [
    { label: "Control", color: "var(--color-control)", points: betaCurvePoints(result.posteriorControl.a, result.posteriorControl.b) },
    { label: "Variant", color: "var(--color-variant)", points: betaCurvePoints(result.posteriorVariant.a, result.posteriorVariant.b) },
  ];

  return (
    <div className="space-y-5 rounded-xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-text-muted">Bayesian A/B Test</div>
          <div className="mt-1 font-mono text-3xl font-bold text-text">
            {probPct.toFixed(1)}% <span className="text-base font-normal text-text-muted">peluang variant menang</span>
          </div>
        </div>
        <Badge signal={probPct >= 95 || probPct <= 5}>
          {probPct >= 95 ? "Kuat: Variant" : probPct <= 5 ? "Kuat: Control" : "Belum Jelas"}
        </Badge>
      </div>

      {/* probability meter, reusing the signal/noise duotone but for P(variant wins) */}
      <div className="w-full">
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-paper-raised ring-1 ring-line">
          <div className="absolute inset-y-0 left-0 h-full" style={{ width: `${probPct}%`, background: "linear-gradient(90deg, var(--color-control-dim), var(--color-variant))" }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs font-mono text-text-faint">
          <span>0% (Control lebih baik)</span>
          <span>100% (Variant lebih baik)</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Rate Control</div>
          <div className="font-mono text-lg text-control">{(result.controlRate * 100).toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Rate Variant</div>
          <div className="font-mono text-lg text-variant">{(result.variantRate * 100).toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Expected Uplift</div>
          <div className="font-mono text-lg text-text">{result.expectedUplift >= 0 ? "+" : ""}{result.expectedUplift.toFixed(2)}%</div>
        </div>
        <div>
          <div className="text-xs font-mono uppercase text-text-muted">Expected Loss</div>
          <div className="font-mono text-sm text-text">
            V: {(result.expectedLossChoosingVariant * 100).toFixed(3)}pp
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Distribusi Posterior (Beta)</div>
        <DistributionChart curves={curves} xFormat={(v) => `${(v * 100).toFixed(1)}%`} />
      </div>

      <div>
        <div className="mb-1.5 text-xs font-mono uppercase tracking-wider text-text-muted">Credible Interval 95%</div>
        <ForestPlot
          xFormat={(v) => `${(v * 100).toFixed(1)}%`}
          rows={[
            { label: "Control", estimate: result.controlRate, ci: result.controlCI, color: "var(--color-control)" },
            { label: "Variant", estimate: result.variantRate, ci: result.variantCI, color: "var(--color-variant)" },
          ]}
        />
      </div>

      <p className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
        Beda dari uji frequentist, di sini tidak ada "signifikan/tidak" biner — cuma probabilitas. <strong>Expected loss</strong> menunjukkan
        rata-rata kerugian (dalam poin persen) kalau kamu pilih variant ternyata control yang lebih baik, atau sebaliknya. Dihitung dari{" "}
        {result.samples.toLocaleString("id-ID")} simulasi Monte Carlo atas posterior Beta({result.posteriorControl.a.toFixed(0)},{result.posteriorControl.b.toFixed(0)})
        vs Beta({result.posteriorVariant.a.toFixed(0)},{result.posteriorVariant.b.toFixed(0)}).
      </p>
    </div>
  );
}

function betaCurvePoints(a, b, n = 80) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    points.push({ x, y: betaPDF(Math.min(0.999, Math.max(0.001, x)), a, b) });
  }
  return points;
}


function AuthScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setNotice("Akun dibuat. Cek email untuk verifikasi, lalu masuk.");
      }
    } catch (err) {
      setError(err.message || "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-labgrid flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-paper p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-control-dim text-control">
            <FlaskConical size={20} />
          </div>
          <div>
            <div className="font-mono text-lg font-bold leading-none text-text">UJI</div>
            <div className="text-xs text-text-muted">A/B Testing Toolkit</div>
          </div>
        </div>

        <h1 className="mb-1 text-lg font-semibold text-text">
          {mode === "signin" ? "Masuk ke akunmu" : "Buat akun baru"}
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          Riwayat eksperimenmu tersimpan aman, hanya kamu yang bisa lihat.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@email.com" />
          </Field>
          <Field label="Password">
            <TextInput type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>

          {error && <p className="text-sm text-noise">{error}</p>}
          {notice && <p className="text-sm text-signal">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-control py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {mode === "signin" ? "Masuk" : "Daftar"}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}
          className="mt-4 w-full text-center text-sm text-text-muted hover:text-control"
        >
          {mode === "signin" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SAVE-TO-HISTORY dialog (used by both Kalkulator and Upload CSV tabs)
// ============================================================================
function SaveDialog({ onSave, onClose, saving }) {
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-line bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-text">Simpan Eksperimen</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <Field label="Nama Eksperimen">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Checkout Button Color Test" />
          </Field>
          <Field label="Hipotesis (opsional)">
            <textarea
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-control focus:outline-none focus:ring-1 focus:ring-control"
              placeholder="cth. Tombol warna oranye akan naikkan conversion rate"
            />
          </Field>
        </div>
        <button
          disabled={!name || saving}
          onClick={() => onSave({ name, hypothesis })}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-control py-2.5 text-sm font-semibold text-ink hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Simpan
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// TAB 1 — KALKULATOR
// ============================================================================
function CalculatorTab({ userId }) {
  const [groupMode, setGroupMode] = useState("two");
  return (
    <div className="space-y-6">
      <Segmented
        value={groupMode}
        onChange={setGroupMode}
        options={[
          { value: "two", label: "2 Grup" },
          { value: "multi", label: "Multi-Varian (3+)" },
        ]}
      />
      {groupMode === "two" ? <TwoGroupCalculator userId={userId} /> : <MultiVariantCalculator userId={userId} />}
    </div>
  );
}

// ---- 2-group calculator: z-test / t-test / Mann-Whitney / Bayesian ---------
function TwoGroupCalculator({ userId }) {
  const [method, setMethod] = useState("proportion");
  const [alpha, setAlpha] = useState(0.05);

  const [cConv, setCConv] = useState("120");
  const [cTotal, setCTotal] = useState("1000");
  const [vConv, setVConv] = useState("150");
  const [vTotal, setVTotal] = useState("1000");

  const [cData, setCData] = useState("20.1\n21.3\n19.8\n22.0\n20.5\n21.1\n19.9\n20.7");
  const [vData, setVData] = useState("22.5\n23.1\n21.8\n24.0\n22.9\n23.4\n22.1\n23.6");

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const usesProportionInput = method === "proportion" || method === "bayesian";

  function runTest() {
    setError("");
    try {
      if (usesProportionInput) {
        const cc = Number(cConv), ct = Number(cTotal), vc = Number(vConv), vt = Number(vTotal);
        if (!ct || !vt || cc > ct || vc > vt || cc < 0 || vc < 0) throw new Error("Periksa lagi angka konversi & total — konversi tidak boleh melebihi total.");
        if (method === "proportion") {
          setResult(twoProportionZTest({ controlConversions: cc, controlTotal: ct, variantConversions: vc, variantTotal: vt, alpha }));
        } else {
          setResult(bayesianProportionTest({ controlConversions: cc, controlTotal: ct, variantConversions: vc, variantTotal: vt }));
        }
      } else {
        const control = cData.split(/[\n,]+/).map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
        const variant = vData.split(/[\n,]+/).map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
        if (control.length < 2 || variant.length < 2) throw new Error("Butuh minimal 2 data poin di masing-masing grup.");
        if (method === "continuous") {
          setResult(welchTTest({ control, variant, alpha }));
        } else {
          setResult(mannWhitneyU({ control, variant, alpha }));
        }
      }
    } catch (e) {
      setError(e.message);
      setResult(null);
    }
  }

  async function handleSave({ name, hypothesis }) {
    setSaving(true);
    try {
      const input = usesProportionInput
        ? { controlConversions: Number(cConv), controlTotal: Number(cTotal), variantConversions: Number(vConv), variantTotal: Number(vTotal) }
        : { control: cData, variant: vData };
      const { error } = await supabase.from("experiments").insert({
        user_id: userId, name, hypothesis, test_type: result.testType, input, result,
      });
      if (error) throw error;
      setShowSave(false);
      setSaveMsg("Tersimpan ke riwayat ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented
          value={method}
          onChange={(v) => { setMethod(v); setResult(null); setError(""); }}
          options={[
            { value: "proportion", label: "Proporsi (Z-Test)" },
            { value: "continuous", label: "Rata-rata (T-Test)" },
            { value: "mannwhitney", label: "Non-Parametrik" },
            { value: "bayesian", label: "Bayesian" },
          ]}
        />
        {method !== "bayesian" && (
          <Field label="Signifikansi (α)">
            <select
              value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              className="rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-sm text-text focus:border-control focus:outline-none"
            >
              <option value={0.01}>0.01</option>
              <option value={0.05}>0.05</option>
              <option value={0.10}>0.10</option>
            </select>
          </Field>
        )}
      </div>

      <p className="text-xs text-text-faint">
        {method === "proportion" && "Uji signifikansi untuk metrik conversion rate — cocok kalau data kamu berupa jumlah konversi dari total user."}
        {method === "continuous" && "Uji signifikansi untuk metrik kontinu (revenue, waktu, dsb) — mengasumsikan data mendekati distribusi normal."}
        {method === "mannwhitney" && "Alternatif non-parametrik dari uji rata-rata — tidak mengasumsikan distribusi normal, tahan terhadap outlier."}
        {method === "bayesian" && "Menghasilkan probabilitas langsung ('X% peluang variant menang') dan expected loss, bukan p-value biner."}
      </p>

      {usesProportionInput ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-control"><span className="h-2 w-2 rounded-full bg-control" />Control</div>
            <Field label="Jumlah Konversi"><TextInput type="number" value={cConv} onChange={(e) => setCConv(e.target.value)} /></Field>
            <Field label="Total Visitor / User"><TextInput type="number" value={cTotal} onChange={(e) => setCTotal(e.target.value)} /></Field>
          </div>
          <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-variant"><span className="h-2 w-2 rounded-full bg-variant" />Variant</div>
            <Field label="Jumlah Konversi"><TextInput type="number" value={vConv} onChange={(e) => setVConv(e.target.value)} /></Field>
            <Field label="Total Visitor / User"><TextInput type="number" value={vTotal} onChange={(e) => setVTotal(e.target.value)} /></Field>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-control"><span className="h-2 w-2 rounded-full bg-control" />Control</div>
            <Field label="Data (satu angka per baris)">
              <textarea value={cData} onChange={(e) => setCData(e.target.value)} rows={8}
                className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text focus:border-control focus:outline-none focus:ring-1 focus:ring-control" />
            </Field>
          </div>
          <div className="space-y-3 rounded-xl border border-line bg-paper p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-variant"><span className="h-2 w-2 rounded-full bg-variant" />Variant</div>
            <Field label="Data (satu angka per baris)">
              <textarea value={vData} onChange={(e) => setVData(e.target.value)} rows={8}
                className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text focus:border-control focus:outline-none focus:ring-1 focus:ring-control" />
            </Field>
          </div>
        </div>
      )}

      {error && <p className="flex items-center gap-2 text-sm text-noise"><AlertCircle size={15} />{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={runTest} className="rounded-lg bg-control px-5 py-2.5 text-sm font-semibold text-ink hover:opacity-90">
          Hitung
        </button>
        {result && (
          <button onClick={() => setShowSave(true)} className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm text-text hover:border-control">
            <Save size={15} /> Simpan ke Riwayat
          </button>
        )}
        {saveMsg && <span className="text-sm text-signal">{saveMsg}</span>}
      </div>

      {result && method === "mannwhitney" && <MannWhitneyResultPanel result={result} />}
      {result && method === "bayesian" && <BayesianResultPanel result={result} />}
      {result && (method === "proportion" || method === "continuous") && <ResultPanel result={result} />}

      {showSave && <SaveDialog onClose={() => setShowSave(false)} onSave={handleSave} saving={saving} />}
    </div>
  );
}

// ---- Multi-variant calculator: chi-square (proportion) / ANOVA (continuous) --
let groupIdCounter = 0;
function newGroupId() { groupIdCounter += 1; return `g${groupIdCounter}`; }
function groupLabel(i) { return String.fromCharCode(65 + i); } // A, B, C, ...

function MultiVariantCalculator({ userId }) {
  const [method, setMethod] = useState("chisquare");
  const [alpha, setAlpha] = useState(0.05);

  const [propGroups, setPropGroups] = useState([
    { id: newGroupId(), name: "A", conv: "80", total: "800" },
    { id: newGroupId(), name: "B", conv: "95", total: "800" },
    { id: newGroupId(), name: "C", conv: "110", total: "800" },
  ]);
  const [contGroups, setContGroups] = useState([
    { id: newGroupId(), name: "A", data: "20.1\n21.3\n19.8\n22.0\n20.5" },
    { id: newGroupId(), name: "B", data: "22.5\n23.1\n21.8\n24.0\n22.9" },
    { id: newGroupId(), name: "C", data: "24.8\n25.2\n24.1\n26.0\n25.5" },
  ]);

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const groups = method === "chisquare" ? propGroups : contGroups;
  const setGroups = method === "chisquare" ? setPropGroups : setContGroups;

  function addGroup() {
    if (groups.length >= 6) return;
    const i = groups.length;
    setGroups([...groups, method === "chisquare"
      ? { id: newGroupId(), name: groupLabel(i), conv: "100", total: "800" }
      : { id: newGroupId(), name: groupLabel(i), data: "21.0\n22.0\n20.5\n21.5\n22.5" }]);
  }
  function removeGroup(id) {
    if (groups.length <= 2) return;
    setGroups(groups.filter((g) => g.id !== id));
  }
  function updateGroup(id, patch) {
    setGroups(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }

  function runTest() {
    setError("");
    try {
      if (method === "chisquare") {
        const parsed = propGroups.map((g) => ({ name: g.name || "?", conversions: Number(g.conv), total: Number(g.total) }));
        if (parsed.some((g) => !g.total || g.conversions > g.total || g.conversions < 0)) {
          throw new Error("Periksa lagi angka konversi & total di tiap grup.");
        }
        setResult(chiSquareTest({ groups: parsed, alpha }));
      } else {
        const parsed = contGroups.map((g) => ({
          name: g.name || "?",
          data: g.data.split(/[\n,]+/).map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
        }));
        if (parsed.some((g) => g.data.length < 2)) throw new Error("Tiap grup butuh minimal 2 data poin.");
        setResult(oneWayANOVA({ groups: parsed, alpha }));
      }
    } catch (e) {
      setError(e.message);
      setResult(null);
    }
  }

  async function handleSave({ name, hypothesis }) {
    setSaving(true);
    try {
      const { error } = await supabase.from("experiments").insert({
        user_id: userId, name, hypothesis, test_type: result.testType, input: { groups }, result,
      });
      if (error) throw error;
      setShowSave(false);
      setSaveMsg("Tersimpan ke riwayat ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented
          value={method}
          onChange={(v) => { setMethod(v); setResult(null); setError(""); }}
          options={[
            { value: "chisquare", label: "Proporsi (Chi-Square)" },
            { value: "anova", label: "Rata-rata (ANOVA)" },
          ]}
        />
        <Field label="Signifikansi (α)">
          <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value))}
            className="rounded-md border border-line bg-paper px-3 py-1.5 font-mono text-sm text-text focus:border-control focus:outline-none">
            <option value={0.01}>0.01</option>
            <option value={0.05}>0.05</option>
            <option value={0.10}>0.10</option>
          </select>
        </Field>
      </div>

      <p className="text-xs text-text-faint">
        {method === "chisquare"
          ? "Bandingkan conversion rate di 3 varian atau lebih sekaligus (A/B/C/D...) — chi-square cuma bilang 'ada beda' atau 'tidak', bukan pasangan mana yang beda."
          : "Bandingkan rata-rata metrik kontinu di 3 varian atau lebih sekaligus."}
      </p>

      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id} className="rounded-xl border border-line bg-paper p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <input
                value={g.name}
                onChange={(e) => updateGroup(g.id, { name: e.target.value })}
                className="w-32 rounded-md border border-line bg-ink px-2 py-1 text-sm font-semibold text-text focus:border-control focus:outline-none"
              />
              {groups.length > 2 && (
                <button onClick={() => removeGroup(g.id)} className="text-text-faint hover:text-noise"><Minus size={16} /></button>
              )}
            </div>
            {method === "chisquare" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Konversi"><TextInput type="number" value={g.conv} onChange={(e) => updateGroup(g.id, { conv: e.target.value })} /></Field>
                <Field label="Total"><TextInput type="number" value={g.total} onChange={(e) => updateGroup(g.id, { total: e.target.value })} /></Field>
              </div>
            ) : (
              <Field label="Data (satu angka per baris)">
                <textarea value={g.data} onChange={(e) => updateGroup(g.id, { data: e.target.value })} rows={4}
                  className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text focus:border-control focus:outline-none focus:ring-1 focus:ring-control" />
              </Field>
            )}
          </div>
        ))}
        {groups.length < 6 && (
          <button onClick={addGroup} className="flex items-center gap-2 rounded-lg border border-dashed border-line px-4 py-2 text-sm text-text-muted hover:border-control hover:text-control">
            <Plus size={15} /> Tambah Grup
          </button>
        )}
      </div>

      {error && <p className="flex items-center gap-2 text-sm text-noise"><AlertCircle size={15} />{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={runTest} className="rounded-lg bg-control px-5 py-2.5 text-sm font-semibold text-ink hover:opacity-90">
          Hitung
        </button>
        {result && (
          <button onClick={() => setShowSave(true)} className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm text-text hover:border-control">
            <Save size={15} /> Simpan ke Riwayat
          </button>
        )}
        {saveMsg && <span className="text-sm text-signal">{saveMsg}</span>}
      </div>

      {result && <MultiVariantResultPanel result={result} />}

      {showSave && <SaveDialog onClose={() => setShowSave(false)} onSave={handleSave} saving={saving} />}
    </div>
  );
}

// ============================================================================
// TAB 2 — SAMPLE SIZE & POWER
// ============================================================================
function SampleSizeTab() {
  const [baseline, setBaseline] = useState("10");
  const [mde, setMde] = useState("20");
  const [mdeType, setMdeType] = useState("relative");
  const [alpha, setAlpha] = useState(0.05);
  const [power, setPower] = useState(0.8);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  function calc() {
    setError("");
    try {
      const p1 = Number(baseline) / 100;
      const mdeVal = Number(mde) / 100;
      if (p1 <= 0 || p1 >= 1) throw new Error("Baseline conversion rate harus antara 0–100%.");
      setResult(sampleSizeForProportion({ baselineRate: p1, mde: mdeVal, mdeType, alpha, power }));
    } catch (e) {
      setError(e.message);
      setResult(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border border-line bg-paper p-5 sm:grid-cols-2">
        <Field label="Baseline Conversion Rate (%)" hint="Conversion rate saat ini, sebelum eksperimen">
          <TextInput type="number" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </Field>
        <Field label="Minimum Detectable Effect" hint={mdeType === "relative" ? "Persentase kenaikan RELATIF, mis. 20% dari 10% → 12%" : "Kenaikan ABSOLUT dalam poin persen"}>
          <div className="flex gap-2">
            <TextInput type="number" value={mde} onChange={(e) => setMde(e.target.value)} />
            <select value={mdeType} onChange={(e) => setMdeType(e.target.value)} className="rounded-md border border-line bg-ink px-2 text-xs font-mono text-text-muted focus:outline-none">
              <option value="relative">% relatif</option>
              <option value="absolute">pp absolut</option>
            </select>
          </div>
        </Field>
        <Field label="Signifikansi (α)">
          <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text focus:outline-none">
            <option value={0.01}>0.01</option>
            <option value={0.05}>0.05</option>
            <option value={0.10}>0.10</option>
          </select>
        </Field>
        <Field label="Power (1 − β)">
          <select value={power} onChange={(e) => setPower(Number(e.target.value))} className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm text-text focus:outline-none">
            <option value={0.8}>0.80</option>
            <option value={0.9}>0.90</option>
            <option value={0.95}>0.95</option>
          </select>
        </Field>
      </div>

      {error && <p className="flex items-center gap-2 text-sm text-noise"><AlertCircle size={15} />{error}</p>}

      <button onClick={calc} className="rounded-lg bg-control px-5 py-2.5 text-sm font-semibold text-ink hover:opacity-90">
        Hitung Sample Size
      </button>

      {result && (
        <div className="space-y-5 rounded-xl border border-line bg-paper p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs font-mono uppercase text-text-muted">Per Arm</div>
              <div className="font-mono text-3xl font-bold text-control">{result.nPerArm.toLocaleString("id-ID")}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-text-muted">Total (2 arm)</div>
              <div className="font-mono text-3xl font-bold text-text">{result.totalN.toLocaleString("id-ID")}</div>
            </div>
            <div>
              <div className="text-xs font-mono uppercase text-text-muted">Target Rate Variant</div>
              <div className="font-mono text-lg text-variant">{(result.p2 * 100).toFixed(2)}%</div>
            </div>
          </div>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-text-faint">
            Untuk mendeteksi kenaikan dari {(result.p1 * 100).toFixed(1)}% ke {(result.p2 * 100).toFixed(2)}% dengan
            confidence {(1 - result.alpha) * 100}% dan power {result.power * 100}%, kamu butuh minimal{" "}
            <span className="font-mono text-text">{result.nPerArm.toLocaleString("id-ID")}</span> user per grup sebelum
            menghentikan eksperimen.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB 3 — UPLOAD CSV
// ============================================================================
function UploadTab({ userId }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState("");
  const [summary, setSummary] = useState(null);
  const [alpha, setAlpha] = useState(0.05);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError("");
    setParseError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          setRows(res.data);
          setSummary(summarizeRawData(res.data));
        } catch (e) {
          setParseError(e.message);
          setSummary(null);
        }
      },
      error: (err) => setParseError(err.message),
    });
  }

  function runAnalysis() {
    setError("");
    try {
      if (summary.detectedType === "proportion") {
        setResult(twoProportionZTest({ ...summary, alpha }));
      } else {
        setResult(welchTTest({ control: summary.control, variant: summary.variant, alpha }));
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSave({ name, hypothesis }) {
    setSaving(true);
    try {
      const { error } = await supabase.from("experiments").insert({
        user_id: userId, name, hypothesis, test_type: result.testType,
        input: { source: "csv", fileName, summary }, result,
      });
      if (error) throw error;
      setShowSave(false);
      setSaveMsg("Tersimpan ke riwayat ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-line bg-paper p-8 text-center">
        <Upload size={28} className="mx-auto mb-3 text-text-muted" />
        <p className="mb-1 text-sm text-text">Upload CSV data eksperimen level-user</p>
        <p className="mb-4 text-xs text-text-faint">
          Kolom wajib: <code className="text-control">group</code> (control/variant) + <code className="text-control">converted</code> (0/1) ATAU <code className="text-variant">value</code> (angka)
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper-raised px-4 py-2 text-sm text-text hover:border-control">
          <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
          Pilih File CSV
        </label>
        {fileName && <p className="mt-3 font-mono text-xs text-text-muted">{fileName} · {rows.length} baris</p>}
      </div>

      {parseError && <p className="flex items-center gap-2 text-sm text-noise"><AlertCircle size={15} />{parseError}</p>}

      {summary && (
        <div className="space-y-4 rounded-xl border border-line bg-paper p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-text">
              Terdeteksi: <span className="font-mono text-control">
                {summary.detectedType === "proportion" ? "Uji Proporsi" : "Uji Rata-rata"}
              </span>
            </div>
            <Field label="α">
              <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="rounded-md border border-line bg-ink px-2 py-1 font-mono text-xs text-text focus:outline-none">
                <option value={0.01}>0.01</option>
                <option value={0.05}>0.05</option>
                <option value={0.10}>0.10</option>
              </select>
            </Field>
          </div>
          {summary.detectedType === "proportion" ? (
            <p className="font-mono text-xs text-text-muted">
              Control: {summary.controlConversions}/{summary.controlTotal} · Variant: {summary.variantConversions}/{summary.variantTotal}
            </p>
          ) : (
            <p className="font-mono text-xs text-text-muted">
              Control: n={summary.control.length} · Variant: n={summary.variant.length}
            </p>
          )}
          <button onClick={runAnalysis} className="rounded-lg bg-control px-5 py-2.5 text-sm font-semibold text-ink hover:opacity-90">
            Jalankan Analisis
          </button>
        </div>
      )}

      {error && <p className="flex items-center gap-2 text-sm text-noise"><AlertCircle size={15} />{error}</p>}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setShowSave(true)} className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm text-text hover:border-control">
              <Save size={15} /> Simpan ke Riwayat
            </button>
            {saveMsg && <span className="text-sm text-signal">{saveMsg}</span>}
          </div>
          <ResultPanel result={result} />
        </>
      )}

      {showSave && <SaveDialog onClose={() => setShowSave(false)} onSave={handleSave} saving={saving} />}
    </div>
  );
}

// ============================================================================
// TAB 4 — RIWAYAT
// ============================================================================
const TEST_TYPE_LABEL = {
  proportion: "Proporsi (Z-Test)",
  continuous: "Rata-rata (T-Test)",
  mannwhitney: "Non-Parametrik (Mann-Whitney)",
  bayesian: "Bayesian A/B",
  chisquare: "Multi-Varian (Chi-Square)",
  anova: "Multi-Varian (ANOVA)",
};

function HistoryResultPanel({ result }) {
  if (result.testType === "mannwhitney") return <MannWhitneyResultPanel result={result} />;
  if (result.testType === "bayesian") return <BayesianResultPanel result={result} />;
  if (result.testType === "chisquare" || result.testType === "anova") return <MultiVariantResultPanel result={result} />;
  return <ResultPanel result={result} />;
}

function HistoryBadge({ result }) {
  if (result.testType === "bayesian") {
    const pct = result.probVariantBeatsControl * 100;
    return <Badge signal={pct >= 95 || pct <= 5}>{pct.toFixed(1)}% menang</Badge>;
  }
  return <Badge signal={result.significant}>p={result.pValue < 0.0001 ? result.pValue.toExponential(1) : result.pValue.toFixed(4)}</Badge>;
}

// Trend of p-values across saved experiments over time (frequentist tests only —
// Bayesian results don't have a p-value, so they're excluded from this view).
function TrendChart({ points }) {
  const W = 400, H = 150, PL = 34, PR = 10, PT = 14, PB = 24;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const times = points.map((p) => p.date.getTime());
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const yMax = Math.max(0.12, ...points.map((p) => p.pValue)) * 1.1;
  const sx = (t) => PL + ((t - tMin) / ((tMax - tMin) || 1)) * innerW;
  const sy = (y) => PT + innerH - (y / yMax) * innerH;
  const alphaY = sy(0.05);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      <line x1={PL} y1={PT} x2={PL} y2={PT + innerH} stroke="var(--color-line)" strokeWidth="1" />
      <line x1={PL} y1={PT + innerH} x2={W - PR} y2={PT + innerH} stroke="var(--color-line)" strokeWidth="1" />
      <line x1={PL} y1={alphaY} x2={W - PR} y2={alphaY} stroke="var(--color-text-faint)" strokeWidth="1" strokeDasharray="3,3" />
      <text x={W - PR} y={alphaY - 3} fontSize="8" fontFamily="var(--font-mono)" fill="var(--color-text-faint)" textAnchor="end">α = 0.05</text>
      <text x={2} y={PT + 4} fontSize="8" fontFamily="var(--font-mono)" fill="var(--color-text-faint)">{yMax.toFixed(2)}</text>
      <text x={2} y={PT + innerH} fontSize="8" fontFamily="var(--font-mono)" fill="var(--color-text-faint)">0</text>
      {points.length > 1 && (
        <path
          d={pathFromPoints(points.map((p) => ({ x: sx(p.date.getTime()), y: sy(p.pValue) })))}
          fill="none" stroke="var(--color-text-faint)" strokeWidth="1"
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.date.getTime())} cy={sy(p.pValue)} r="4"
          fill={p.significant ? "var(--color-signal)" : "var(--color-noise)"} />
      ))}
    </svg>
  );
}

function HistoryTab({ userId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("experiments")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [userId]);

  async function handleDelete(id) {
    const { error } = await supabase.from("experiments").delete().eq("id", id);
    if (!error) setItems(items.filter((i) => i.id !== id));
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />Memuat riwayat…</div>;
  if (error) return <p className="text-sm text-noise">{error}</p>;
  if (items.length === 0) return (
    <div className="rounded-xl border border-dashed border-line bg-paper p-10 text-center">
      <History size={26} className="mx-auto mb-3 text-text-muted" />
      <p className="text-sm text-text-muted">Belum ada eksperimen tersimpan. Jalankan analisis di tab Kalkulator atau Upload CSV, lalu simpan.</p>
    </div>
  );

  const trendPoints = items
    .filter((i) => typeof i.result.pValue === "number")
    .map((i) => ({ date: new Date(i.created_at), pValue: i.result.pValue, significant: i.result.significant }))
    .sort((a, b) => a.date - b.date);

  return (
    <div className="space-y-6">
      {trendPoints.length >= 2 && (
        <div className="rounded-xl border border-line bg-paper p-5">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-text-muted">
            <TrendingUp size={13} /> Trend p-value dari waktu ke waktu
          </div>
          <TrendChart points={trendPoints} />
          <p className="mt-1 text-xs text-text-faint">Titik hijau = signifikan, titik merah = belum. (Uji Bayesian tidak ikut ditampilkan di sini karena tidak punya p-value.)</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const isOpen = expandedId === item.id;
          return (
            <div key={item.id} className="overflow-hidden rounded-xl border border-line bg-paper">
              <button onClick={() => setExpandedId(isOpen ? null : item.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{item.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-text-faint">
                    {new Date(item.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    {" · "}{TEST_TYPE_LABEL[item.test_type] || item.test_type}
                  </div>
                </div>
                <HistoryBadge result={item.result} />
                {isOpen ? <ChevronDown size={18} className="shrink-0 text-text-muted" /> : <ChevronRight size={18} className="shrink-0 text-text-muted" />}
              </button>
              {isOpen && (
                <div className="border-t border-line p-4">
                  {item.hypothesis && <p className="mb-4 text-sm italic text-text-muted">"{item.hypothesis}"</p>}
                  <HistoryResultPanel result={item.result} />
                  <button onClick={() => handleDelete(item.id)} className="mt-4 flex items-center gap-2 text-xs text-noise hover:opacity-80">
                    <Trash2 size={13} /> Hapus eksperimen ini
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// ROOT APP — sidebar shell + auth gate
// ============================================================================
const NAV = [
  { id: "calculator", label: "Kalkulator", icon: Calculator, desc: "6 metode uji: Z-test, T-test, Mann-Whitney, Bayesian, Chi-Square, ANOVA" },
  { id: "samplesize", label: "Sample Size", icon: Target, desc: "Hitung sampel & power" },
  { id: "upload", label: "Upload CSV", icon: Upload, desc: "Analisis data mentah" },
  { id: "history", label: "Riwayat", icon: History, desc: "Eksperimen tersimpan" },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [tab, setTab] = useState("calculator");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-ink text-text-muted"><Loader2 className="animate-spin" /></div>;
  }
  if (!session) {
    return <AuthScreen />;
  }

  const active = NAV.find((n) => n.id === tab);

  return (
    <div className="flex min-h-screen bg-ink">
      {/* Sidebar (desktop) / top bar (mobile) */}
      <aside className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-paper px-4 md:static md:h-screen md:w-60 md:flex-col md:items-stretch md:justify-start md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center gap-2.5 md:mb-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-control-dim text-control">
            <FlaskConical size={17} />
          </div>
          <div>
            <div className="font-mono text-sm font-bold leading-none text-text">UJI</div>
            <div className="hidden text-[11px] text-text-muted md:block">A/B Testing Toolkit</div>
          </div>
        </div>

        <nav className="flex gap-1 md:flex-1 md:flex-col md:gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors md:px-3 md:py-2.5 " +
                  (isActive ? "bg-paper-raised text-text ring-1 ring-line" : "text-text-muted hover:bg-paper-raised/50 hover:text-text")
                }
              >
                <Icon size={16} className={isActive ? "text-control" : ""} />
                <span className="hidden md:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => supabase.auth.signOut()}
          className="hidden items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-text-muted hover:bg-paper-raised/50 hover:text-noise md:flex"
        >
          <LogOut size={16} />
          Keluar
        </button>
      </aside>

      {/* Main content */}
      <main className="bg-labgrid mt-14 flex-1 px-4 py-6 md:mt-0 md:px-8 md:py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-text">{active.label}</h1>
            <p className="text-sm text-text-muted">{active.desc}</p>
          </div>
          {tab === "calculator" && <CalculatorTab userId={session.user.id} />}
          {tab === "samplesize" && <SampleSizeTab />}
          {tab === "upload" && <UploadTab userId={session.user.id} />}
          {tab === "history" && <HistoryTab userId={session.user.id} />}
        </div>
      </main>
    </div>
  );
}
