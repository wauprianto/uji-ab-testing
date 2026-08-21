// ============================================================================
// /api/analyze — Vercel Serverless Function
//
// Proxies a "explain this A/B test result" request to the Gemini API. Runs
// server-side so GEMINI_API_KEY never reaches the browser (unlike a
// VITE_-prefixed env var, which gets bundled into client JS and is visible
// to anyone who opens devtools).
//
// Local testing: `npm run dev` alone does NOT serve this route (Vite doesn't
// know about /api). Use `vercel dev` instead — see README.md.
// ============================================================================

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Turn a stats.js result object into a compact, human-readable summary the
// model can reason over — deliberately not just JSON.stringify(result), so
// the prompt stays short and the model can't misinterpret field names.
function summarizeResult(result) {
  const pct = (x) => `${(x * 100).toFixed(2)}%`;

  switch (result.testType) {
    case "proportion":
      return `Uji Proporsi (Two-Proportion Z-Test). Control: ${pct(result.p1)} (n=${result.n1}). ` +
        `Variant: ${pct(result.p2)} (n=${result.n2}). Selisih: ${(result.diff * 100).toFixed(2)} poin persen, ` +
        `lift relatif ${result.relativeLift?.toFixed(2)}%. z=${result.z.toFixed(3)}, p-value=${result.pValue.toFixed(4)}, ` +
        `alpha=${result.alpha}, signifikan=${result.significant ? "ya" : "tidak"}. ` +
        `CI 95% selisih: [${pct(result.ci[0])}, ${pct(result.ci[1])}].`;

    case "continuous":
      return `Uji Rata-rata (Welch's T-Test). Control: mean=${result.m1.toFixed(2)} (n=${result.n1}, sd=${result.sd1.toFixed(2)}). ` +
        `Variant: mean=${result.m2.toFixed(2)} (n=${result.n2}, sd=${result.sd2.toFixed(2)}). ` +
        `Selisih=${result.diff.toFixed(2)}, lift relatif ${result.relativeLift?.toFixed(2)}%. ` +
        `t=${result.t.toFixed(3)}, df=${result.df.toFixed(1)}, p-value=${result.pValue.toFixed(4)}, ` +
        `alpha=${result.alpha}, signifikan=${result.significant ? "ya" : "tidak"}.`;

    case "mannwhitney":
      return `Mann-Whitney U (non-parametrik). Median Control=${result.medianControl.toFixed(2)} (n=${result.n1}). ` +
        `Median Variant=${result.medianVariant.toFixed(2)} (n=${result.n2}). U=${result.U.toFixed(1)}, ` +
        `z=${result.z.toFixed(3)}, p-value=${result.pValue.toFixed(4)}, alpha=${result.alpha}, ` +
        `signifikan=${result.significant ? "ya" : "tidak"}.`;

    case "bayesian":
      return `Bayesian A/B Test. Rate Control=${pct(result.controlRate)} (CI95 [${pct(result.controlCI[0])}, ${pct(result.controlCI[1])}]). ` +
        `Rate Variant=${pct(result.variantRate)} (CI95 [${pct(result.variantCI[0])}, ${pct(result.variantCI[1])}]). ` +
        `Probabilitas variant lebih baik dari control=${(result.probVariantBeatsControl * 100).toFixed(1)}%. ` +
        `Expected uplift=${result.expectedUplift.toFixed(2)}%. ` +
        `Expected loss kalau pilih variant=${(result.expectedLossChoosingVariant * 100).toFixed(3)} poin persen, ` +
        `expected loss kalau pilih control=${(result.expectedLossChoosingControl * 100).toFixed(3)} poin persen.`;

    case "chisquare": {
      const groups = result.groups.map((g) => `${g.name}: ${pct(g.rate)} (${g.conversions}/${g.total})`).join("; ");
      return `Chi-Square Test of Independence, ${result.groups.length} grup. ${groups}. ` +
        `chi-square=${result.chiSq.toFixed(3)}, df=${result.df}, p-value=${result.pValue.toFixed(4)}, ` +
        `alpha=${result.alpha}, signifikan=${result.significant ? "ya" : "tidak"}.`;
    }

    case "anova": {
      const groups = result.groups.map((g) => `${g.name}: mean=${g.mean.toFixed(2)} (n=${g.n}, sd=${g.sd.toFixed(2)})`).join("; ");
      return `One-Way ANOVA, ${result.groups.length} grup. ${groups}. F=${result.F.toFixed(3)}, ` +
        `df=(${result.dfBetween},${result.dfWithin}), p-value=${result.pValue.toFixed(4)}, ` +
        `alpha=${result.alpha}, signifikan=${result.significant ? "ya" : "tidak"}.`;
    }

    default:
      return JSON.stringify(result);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY belum diset di Environment Variables Vercel." });
    return;
  }

  const { result, hypothesis } = req.body || {};
  if (!result || !result.testType) {
    res.status(400).json({ error: "Data hasil uji tidak lengkap." });
    return;
  }

  const summary = summarizeResult(result);
  const prompt = `Kamu adalah analis data eksperimen A/B testing yang membantu product manager non-teknis memahami hasil uji statistik.
${hypothesis ? `\nHipotesis eksperimen: "${hypothesis}"\n` : "\n"}
Ringkasan hasil uji:
${summary}

Tulis interpretasi singkat dalam Bahasa Indonesia (maksimal 120 kata, tanpa heading atau bullet point, satu paragraf mengalir) yang mencakup:
1. Apa arti hasil ini secara bisnis/praktis — jangan mengulang angka statistik yang sudah ada di ringkasan
2. Rekomendasi tindakan konkret
3. Satu catatan kehati-hatian kalau relevan (misalnya ukuran sampel kecil, atau perlu data lebih banyak sebelum yakin)

Jangan mengarang angka yang tidak ada di ringkasan di atas.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      res.status(502).json({ error: `Gemini API error (${geminiRes.status}). Cek GEMINI_API_KEY dan nama model (GEMINI_MODEL=${GEMINI_MODEL}).` });
      return;
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    if (!text) {
      res.status(502).json({ error: "Gemini tidak mengembalikan hasil teks (mungkin diblokir safety filter)." });
      return;
    }

    res.status(200).json({ analysis: text.trim() });
  } catch (err) {
    console.error("Analyze handler error:", err);
    res.status(500).json({ error: "Terjadi kesalahan internal saat memanggil Gemini API." });
  }
}
