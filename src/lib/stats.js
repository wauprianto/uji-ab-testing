// ============================================================================
// UJI — Statistical Engine
// Implemented from first principles (no black-box stats library) so every
// number on screen can be traced back to a formula.
// ============================================================================

// ---- Basic descriptive helpers ---------------------------------------------

export function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

export function sampleVariance(arr) {
  const m = mean(arr);
  const sq = arr.reduce((s, x) => s + (x - m) ** 2, 0);
  return sq / (arr.length - 1);
}

export function sampleStdDev(arr) {
  return Math.sqrt(sampleVariance(arr));
}

// ---- Normal distribution ----------------------------------------------------
// erf approximation: Abramowitz & Stegun 7.1.26 (max error ~1.5e-7)
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

export function normalCDF(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse normal CDF (probit), Acklam's rational approximation, |err| < 1.15e-9
export function normalInvCDF(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pLow = 0.02425;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ---- Student's t-distribution ----------------------------------------------
// log-gamma via Lanczos approximation
function logGamma(x) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// continued fraction for the incomplete beta function (Numerical Recipes)
function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-9, FPMIN = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// P(T <= t) for Student's t with `df` degrees of freedom
export function studentTCDF(t, df) {
  const x = df / (df + t * t);
  const p = regularizedIncompleteBeta(x, df / 2, 0.5) / 2;
  return t > 0 ? 1 - p : p;
}

// two-tailed p-value: P(|T| >= |t|)
export function studentTTwoTailedP(t, df) {
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

// inverse t CDF via bisection on the monotonic forward CDF (robust, no closed form needed)
export function studentTInvCDF(p, df) {
  let lo = -100, hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCDF(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ============================================================================
// A/B TEST: two-proportion z-test (conversion-rate style metrics)
// ============================================================================
export function twoProportionZTest({ controlConversions, controlTotal, variantConversions, variantTotal, alpha = 0.05 }) {
  const p1 = controlConversions / controlTotal;
  const p2 = variantConversions / variantTotal;
  const pooled = (controlConversions + variantConversions) / (controlTotal + variantTotal);

  // pooled SE is used for the test statistic (assumes null hypothesis p1 = p2)
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / controlTotal + 1 / variantTotal));
  const z = sePooled === 0 ? 0 : (p2 - p1) / sePooled;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));

  // unpooled SE is used for the confidence interval (doesn't assume p1 = p2)
  const seDiff = Math.sqrt((p1 * (1 - p1)) / controlTotal + (p2 * (1 - p2)) / variantTotal);
  const zCrit = normalInvCDF(1 - alpha / 2);
  const diff = p2 - p1;

  return {
    testType: "proportion",
    p1, p2, diff,
    relativeLift: p1 === 0 ? null : (diff / p1) * 100,
    z, pValue,
    ci: [diff - zCrit * seDiff, diff + zCrit * seDiff],
    alpha,
    significant: pValue < alpha,
    n1: controlTotal, n2: variantTotal,
  };
}

// ============================================================================
// A/B TEST: Welch's t-test (continuous metrics — revenue, time on page, etc.)
// Welch's version (not Student's pooled) because we should never assume the
// control and variant have equal variance.
// ============================================================================
export function welchTTest({ control, variant, alpha = 0.05 }) {
  const n1 = control.length, n2 = variant.length;
  const m1 = mean(control), m2 = mean(variant);
  const v1 = sampleVariance(control), v2 = sampleVariance(variant);

  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = se === 0 ? 0 : (m2 - m1) / se;

  // Welch–Satterthwaite degrees of freedom
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));

  const pValue = studentTTwoTailedP(t, df);
  const tCrit = studentTInvCDF(1 - alpha / 2, df);
  const diff = m2 - m1;

  return {
    testType: "continuous",
    m1, m2, diff,
    relativeLift: m1 === 0 ? null : (diff / m1) * 100,
    t, df, pValue,
    ci: [diff - tCrit * se, diff + tCrit * se],
    alpha,
    significant: pValue < alpha,
    n1, n2,
    sd1: Math.sqrt(v1), sd2: Math.sqrt(v2),
  };
}

// ============================================================================
// SAMPLE SIZE / POWER — two-proportion test, equal allocation
// Standard formula: n per arm using pooled variance for the alpha term and
// unpooled variance for the beta term.
// ============================================================================
export function sampleSizeForProportion({ baselineRate, mde, mdeType = "relative", alpha = 0.05, power = 0.8 }) {
  const p1 = baselineRate;
  const p2 = mdeType === "relative" ? p1 * (1 + mde) : p1 + mde;
  const pBar = (p1 + p2) / 2;

  const zAlpha = normalInvCDF(1 - alpha / 2);
  const zBeta = normalInvCDF(power);

  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  const denominator = (p2 - p1) ** 2;
  const nPerArm = numerator / denominator;

  return {
    p1, p2,
    nPerArm: Math.ceil(nPerArm),
    totalN: Math.ceil(nPerArm) * 2,
    alpha, power,
  };
}

// ============================================================================
// CSV → grouped raw data → auto-run the right test
// Expects columns: group (control/variant, or a/b, or 0/1) plus either
// `converted` (0/1) for a proportion test or `value` (numeric) for a t-test.
// ============================================================================
export function summarizeRawData(rows) {
  const isControl = (g) => ["control", "a", "0"].includes(String(g).trim().toLowerCase());
  const isVariant = (g) => ["variant", "treatment", "b", "1"].includes(String(g).trim().toLowerCase());

  const control = [];
  const variant = [];
  rows.forEach((row) => {
    if (isControl(row.group)) control.push(row);
    else if (isVariant(row.group)) variant.push(row);
  });

  const hasConverted = rows.some((r) => r.converted !== undefined && r.converted !== "");
  const hasValue = rows.some((r) => r.value !== undefined && r.value !== "");

  if (hasConverted) {
    const controlConversions = control.filter((r) => Number(r.converted) === 1).length;
    const variantConversions = variant.filter((r) => Number(r.converted) === 1).length;
    return {
      detectedType: "proportion",
      controlConversions, controlTotal: control.length,
      variantConversions, variantTotal: variant.length,
    };
  }
  if (hasValue) {
    return {
      detectedType: "continuous",
      control: control.map((r) => Number(r.value)).filter((v) => !Number.isNaN(v)),
      variant: variant.map((r) => Number(r.value)).filter((v) => !Number.isNaN(v)),
    };
  }
  throw new Error("CSV harus punya kolom 'converted' (0/1) atau 'value' (angka), plus kolom 'group'.");
}
