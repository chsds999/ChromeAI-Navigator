const out = document.getElementById('output');
const statusEl = document.getElementById('status');
const modeEl = document.getElementById('mode');

function show(msg) { out.textContent = msg; }
function status(msg) { statusEl.textContent = msg; }

document.getElementById('openOptions').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

async function getSelectedText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (window.getSelection?.().toString() || "")
  });
  return (res?.result || "").trim();
}

function withTimeout(promise, ms, onTimeoutMsg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(onTimeoutMsg || "Timed out")), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, err => { clearTimeout(t); reject(err); });
  });
}

async function getCloudConfig() {
  const { openaiKey, openaiModel } = await chrome.storage.sync.get({
    openaiKey: "",
    openaiModel: "gpt-4o-mini"
  });
  return { openaiKey, openaiModel };
}

// ---------- Cloud fallback (OpenAI). Swap to Gemini Dev API if you prefer ----------
async function callOpenAI(prompt) {
  const { openaiKey, openaiModel } = await getCloudConfig();
  if (!openaiKey) throw new Error("No API key set. Click Options and add your OpenAI key.");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: openaiModel || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a precise, concise writing assistant." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 600
    })
  });
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content?.trim() || "No content.";
}

// ---------- Local built-in APIs ----------
async function summarizeLocal(text, onProgress) {
  if (!("Summarizer" in self)) return null;
  const avail = await Summarizer.availability?.();
  if (avail === "unavailable") return "Summarizer unavailable on this device/browser.";

  const s = await withTimeout(
    Summarizer.create({
      type: "key-points", length: "medium", format: "markdown",
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          if (onProgress) onProgress(Math.round(e.loaded * 100));
        });
      }
    }),
    15000,
    "Summarizer model creation timed out."
  );

  const res = await s.summarize(text);
  return typeof res === "string" ? res : (res?.summary || JSON.stringify(res, null, 2));
}

async function translateLocal(text, to = "en", onProgress) {
  if (!("Translator" in self)) return null;
  let src = "en";
  if ("LanguageDetector" in self) {
    const det = await (await LanguageDetector.create()).detect(text);
    src = det?.detectedLanguage || "en";
  }
  const t = await withTimeout(
    Translator.create({ sourceLanguage: src, targetLanguage: to }),
    15000,
    "Translator model creation timed out."
  );
  const res = await t.translate(text);
  return typeof res === "string" ? res : (res?.text || JSON.stringify(res, null, 2));
}

async function promptLocal(system, user, schema, onProgress) {
  if (typeof LanguageModel === "undefined") return null;
  const a = await LanguageModel.availability?.();
  if (a === "unavailable") return "Prompt API unavailable on this device/browser.";

  const session = await withTimeout(
    LanguageModel.create({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      monitor(m){ m.addEventListener("downloadprogress", e => onProgress && onProgress(Math.round(e.loaded * 100))); }
    }),
    15000,
    "Prompt model creation timed out."
  );

  if (system) await session.append([{ role: "system", content: system }]);
  const options = schema ? { responseConstraint: schema, omitResponseConstraintInput: true } : undefined;
  return await session.prompt(user, options);
}

// ---------- Button handlers (local first, cloud fallback) ----------
async function onSummarize() {
  status("Preparing summarizer…"); show("Working...");
  try {
    const text = await getSelectedText();
    if (!text) return show("Select some text first.");

    try {
      const res = await summarizeLocal(text, p => status(`Downloading on-device model… ${p}%`));
      if (res === null) throw new Error("LOCAL_NOT_SUPPORTED");
      status(""); show(res); return;
    } catch (e) {
      if (e.message === "LOCAL_NOT_SUPPORTED") {
        status("Local not supported. Falling back to cloud…");
      } else if (e.message.includes("timed out")) {
        status("On-device model is still downloading. Falling back to cloud…");
      } else {
        status("Local failed. Falling back to cloud…");
      }
      const res = await callOpenAI(`Summarize the following text in 3–5 concise bullet points (markdown):\n\n${text}`);
      show(res); status("");
    }
  } catch (e) { status(""); show("Error: " + (e?.message || String(e))); }
}

async function onTranslate() {
  status("Preparing translator…"); show("Working...");
  try {
    const text = await getSelectedText();
    if (!text) return show("Select some text first.");
    const to = document.getElementById('translateTo').value || 'en';

    try {
      const res = await translateLocal(text, to, p => status(`Downloading on-device model… ${p}%`));
      if (res === null) throw new Error("LOCAL_NOT_SUPPORTED");
      status(""); show(res); return;
    } catch (e) {
      status("Using cloud fallback…");
      const res = await callOpenAI(`Translate the text into ${to}. Return only the translation.\n\n${text}`);
      show(res); status("");
    }
  } catch (e) { status(""); show("Error: " + (e?.message || String(e))); }
}

async function onRewrite() {
  status("Preparing rewrite…"); show("Working...");
  try {
    const text = await getSelectedText();
    if (!text) return show("Select some text first.");

    try {
      const res = await promptLocal(
        "Rewrite the text to be clearer and more natural, preserving meaning. Return only the rewritten text.",
        text,
        null,
        p => status(`Downloading on-device model… ${p}%`)
      );
      if (res === null) throw new Error("LOCAL_NOT_SUPPORTED");
      status(""); show(res); return;
    } catch (e) {
      status("Using cloud fallback…");
      const res = await callOpenAI(`Rewrite the text to be clearer and more natural, preserving meaning. Return only the rewritten text.\n\n${text}`);
      show(res); status("");
    }
  } catch (e) { status(""); show("Error: " + (e?.message || String(e))); }
}

async function onCompose() {
  status("Preparing compose…"); show("Working...");
  try {
    const text = await getSelectedText();
    if (!text) return show("Select some text first (e.g., the message you’re replying to).");

    try {
      const res = await promptLocal(
        "You are a concise, polite email assistant. Write a short professional reply under 120 words.",
        `Reply to this:\n\n${text}`,
        null,
        p => status(`Downloading on-device model… ${p}%`)
      );
      if (res === null) throw new Error("LOCAL_NOT_SUPPORTED");
      status(""); show(res); return;
    } catch (e) {
      status("Using cloud fallback…");
      const res = await callOpenAI(`Write a short, professional reply (<=120 words) to the message below.\n\n${text}`);
      show(res); status("");
    }
  } catch (e) { status(""); show("Error: " + (e?.message || String(e))); }
}

async function onProofread() {
  status("Preparing proofread…"); show("Working...");
  try {
    const text = await getSelectedText();
    if (!text) return show("Select some text first.");

    try {
      const res = await promptLocal(
        "Fix grammar, punctuation, clarity, and tone. Return only the corrected text.",
        text,
        null,
        p => status(`Downloading on-device model… ${p}%`)
      );
      if (res === null) throw new Error("LOCAL_NOT_SUPPORTED");
      status(""); show(res); return;
    } catch (e) {
      status("Using cloud fallback…");
      const res = await callOpenAI(`Proofread the text. Fix grammar, punctuation, clarity, and tone. Return only the corrected text.\n\n${text}`);
      show(res); status("");
    }
  } catch (e) { status(""); show("Error: " + (e?.message || String(e))); }
}

// Bind
document.getElementById('summarize').onclick = onSummarize;
document.getElementById('translate').onclick = onTranslate;
document.getElementById('rewrite').onclick = onRewrite;
document.getElementById('compose').onclick = onCompose;
document.getElementById('proofread').onclick = onProofread;

// Mode detector (Local vs Cloud)
(async function detectMode(){
  try {
    const hasSum = ("Summarizer" in self);
    const hasTrans = ("Translator" in self);
    const hasPrompt = (typeof LanguageModel !== "undefined");
    const anyLocal = hasSum || hasTrans || hasPrompt;
    const { openaiKey } = await getCloudConfig();
    const hasCloud = !!openaiKey;
    modeEl.textContent = `Mode: ${anyLocal ? "Local (Gemini Nano)" : "Local unavailable"}${hasCloud ? " + Cloud fallback" : " (add API key in Options for cloud)"}`;
  } catch {
    modeEl.textContent = "Mode: unknown • Click Options to configure";
  }
})();
