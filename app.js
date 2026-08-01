/* Aaki's Developer Journey — private assessment and review platform */
(() => {
  "use strict";

  const STORAGE_KEY = "aaki_dev_journey_workspace_v1";
  const BACKUP_KEY = "aaki_dev_journey_workspace_backup_v1";
  const SESSION_KEY = "aaki_dev_journey_session_v1";
  const THEME_KEY = "aaki_dev_journey_theme_v1";
  const UI_PREFS_KEY = "aaki_dev_journey_ui_preferences_v1";
  const LEGACY_STORAGE_KEY = "devora_data_v1";
  const LEGACY_SESSION_KEY = "devora_session_v1";
  const LEGACY_THEME_KEY = "devora_theme_v1";
  const SCHEMA_VERSION = 7;
  const CONFIGURED_ACCOUNTS = {
    ADMIN: {
      name: "Aayush",
      username: "Aayush",
      title: "Reviewer & Test Creator",
      avatarData: "assets/profiles/aayush.jpg"
    },
    CANDIDATE: {
      name: "Aaki",
      username: "Aaki",
      title: "Developer in Progress",
      avatarData: "assets/profiles/aaki.jpg"
    }
  };
  const TECHNOLOGIES = ["HTML", "CSS", "JavaScript", "Python", "Java", "C", "C++", "SQL", "React", "Other"];
  const APP_CONFIG = window.AAKI_APP_CONFIG || {};
  const CLOUD_REQUIRED = APP_CONFIG.requireCloud !== false;
  const FIREBASE_CONFIG = APP_CONFIG.firebase || {};
  const CLOUD_ENABLED = Boolean(
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.projectId &&
    window.firebase?.initializeApp &&
    window.firebase?.auth &&
    window.firebase?.firestore
  );
  const firebaseApp = CLOUD_ENABLED
    ? (window.firebase.apps?.length ? window.firebase.app() : window.firebase.initializeApp(FIREBASE_CONFIG))
    : null;
  const firebaseAuth = CLOUD_ENABLED ? window.firebase.auth() : null;
  const firestoreDb = CLOUD_ENABLED ? window.firebase.firestore() : null;
  if (firestoreDb?.settings) firestoreDb.settings({ ignoreUndefinedProperties: true });
  const CLOUD_EMAILS = {
    aayush: "aayush@admin.dev",
    aaki: "aaki@devjourney.dev"
  };
  const COLLECTIONS = {
    USERS: "users",
    WORKSPACES: "workspaces",
    PRIVATE_TESTS: "assessmentsPrivate",
    TEST_CATALOG: "assessmentCatalog",
    TEST_CONTENT: "assessmentContent",
    ATTEMPTS: "attempts",
    REVIEWS: "reviews",
    RESULTS: "publishedResults"
  };
  const JUDGE0_LANGUAGE_IDS = {
    PYTHON: 71,
    JAVA: 62,
    C: 50,
    "C++": 54,
    JAVASCRIPT: 63
  };
  const EVALUATION_MODES = [
    { value: "WEB_PREVIEW", label: "Live web preview" },
    { value: "TEST_CASES", label: "Source code + test cases" },
    { value: "SOURCE_ONLY", label: "Source code only" }
  ];
  const WEB_FILE_KEYS = ["html", "css", "javascript"];
  const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
  const DEMO_TEST_IDS = new Set(["test_html_semantics", "test_html_fundamentals"]);
  const DEMO_ATTEMPT_IDS = new Set(["attempt_seed_result"]);

  let data = loadData();
  let currentUser = null;
  let route = "login";
  let routeParams = {};
  let currentQuestionIndex = 0;
  let sidebarOpen = false;
  let builderDraft = null;
  let pendingConfirm = null;
  let timerHandle = null;
  let integrityDeparturePending = false;
  let activeWebFileByQuestion = {};
  let cloudSaveHandle = null;
  let cloudSyncing = false;
  let cloudAuthenticated = false;
  let cloudProfile = null;
  let cloudCandidateAuthId = null;
  let cloudAdminAuthId = null;
  let cloudUnsubscribers = [];
  let cloudRefreshHandle = null;
  let cloudCache = {
    tests: new Map(),
    catalogs: new Map(),
    contents: new Map(),
    attempts: new Map(),
    reviews: new Map(),
    results: new Map(),
    workspace: ""
  };
  let testRunState = {};

  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");
  const codeMirrorInstances = new Map();

  function codeMirrorModeFor(language) {
    const value = String(language || "").trim().toUpperCase();
    if (value === "HTML") return "htmlmixed";
    if (value === "CSS") return "css";
    if (value === "JAVASCRIPT") return "javascript";
    if (value === "REACT") return { name: "javascript", jsx: true };
    if (value === "PYTHON") return "python";
    if (value === "JAVA") return "text/x-java";
    if (value === "C") return "text/x-csrc";
    if (value === "C++") return "text/x-c++src";
    if (value === "SQL") return "text/x-sql";
    return null;
  }

  function destroyCodeEditors(scope = document) {
    for (const [textarea, editor] of [...codeMirrorInstances.entries()]) {
      if (scope !== document && textarea.isConnected && !scope.contains(textarea)) continue;
      try { editor.toTextArea(); } catch (_) { /* The surrounding view may already be removed. */ }
      codeMirrorInstances.delete(textarea);
    }
  }

  function createCodeEditor(textarea, { language, height = "470px", onChange } = {}) {
    if (!textarea || !window.CodeMirror || codeMirrorInstances.has(textarea)) return null;
    const editor = window.CodeMirror.fromTextArea(textarea, {
      mode: codeMirrorModeFor(language),
      theme: "aaki",
      lineNumbers: true,
      lineWrapping: false,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      smartIndent: true,
      electricChars: true,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      viewportMargin: 20,
      extraKeys: {
        Tab(instance) {
          if (instance.somethingSelected()) instance.indentSelection("add");
          else instance.replaceSelection("  ", "end", "+input");
        },
        "Shift-Tab"(instance) {
          instance.indentSelection("subtract");
        }
      }
    });
    editor.setSize("100%", height);
    editor.getWrapperElement().setAttribute("aria-label", `${language || "Code"} editor`);
    editor.on("change", (instance) => {
      textarea.value = instance.getValue();
      if (typeof onChange === "function") onChange(instance.getValue());
    });
    codeMirrorInstances.set(textarea, editor);
    return editor;
  }

  function initializeCandidateCodeEditors(question) {
    if (!window.CodeMirror || !question) return;
    document.querySelectorAll('textarea[data-cm-context="candidate"]').forEach((textarea) => {
      const questionId = textarea.dataset.questionId;
      const fileKey = textarea.dataset.fileKey || null;
      createCodeEditor(textarea, {
        language: textarea.dataset.language || question.language,
        height: "clamp(440px, 58vh, 680px)",
        onChange: (value) => updateCode(questionId, value, fileKey)
      });
    });
    if (isWebPreviewQuestion(question)) {
      setWebFileTab(question.id, activeWebFileByQuestion[question.id] || "html");
    }
  }

  function initializeBuilderCodeEditors() {
    if (!window.CodeMirror || !builderDraft) return;
    modalRoot.querySelectorAll('textarea[data-cm-context="builder"]').forEach((textarea) => {
      const questionId = textarea.dataset.questionId;
      const fileKey = textarea.dataset.fileKey || null;
      createCodeEditor(textarea, {
        language: textarea.dataset.language,
        height: fileKey ? "230px" : "300px",
        onChange: (value) => {
          if (fileKey) updateBuilderStarterFile(questionId, fileKey, value);
          else updateBuilderQuestion(questionId, "starterCode", value);
        }
      });
    });
  }

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value = "") {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function renderQuestionImage(question, className = "question-media") {
    const source = String(question?.imageData || question?.imageUrl || "").trim();
    if (!source) return "";
    const alt = String(question?.imageAlt || "Question reference image");
    return `<figure class="${escapeAttr(className)}"><img src="${escapeAttr(source)}" alt="${escapeAttr(alt)}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
  }

  function normaliseOutput(value) {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .trimEnd();
  }

  function isCloudMode() {
    return CLOUD_ENABLED && cloudAuthenticated && Boolean(firebaseAuth && firestoreDb);
  }

  function cloudStatusLabel() {
    if (isCloudMode()) return "Firebase synced";
    return CLOUD_ENABLED ? "Connecting…" : "Firebase setup required";
  }

  const ALLOWED_THEMES = ["light", "dark"];
  const ALLOWED_PALETTES = ["aurora", "ocean", "sunset", "candy"];

  function appearanceAccountKey() {
    return firebaseAuth?.currentUser?.uid
      || currentUser?.authId
      || String(currentUser?.username || "guest").trim().toLowerCase()
      || "guest";
  }

  function readAppearanceStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function appearancePreferences() {
    const store = readAppearanceStore();
    const saved = store[appearanceAccountKey()] || {};
    const legacyTheme = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY) || "light";
    return {
      theme: ALLOWED_THEMES.includes(saved.theme) ? saved.theme : (ALLOWED_THEMES.includes(legacyTheme) ? legacyTheme : "light"),
      palette: ALLOWED_PALETTES.includes(saved.palette) ? saved.palette : (ALLOWED_PALETTES.includes(data?.branding?.palette) ? data.branding.palette : "aurora")
    };
  }

  function saveAppearancePreferences(patch = {}) {
    const store = readAppearanceStore();
    const key = appearanceAccountKey();
    const previous = store[key] && typeof store[key] === "object" ? store[key] : {};
    store[key] = { ...previous, ...patch, updatedAt: nowIso() };
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(store));
  }

  function currentTheme() {
    return appearancePreferences().theme;
  }

  function currentPalette() {
    return appearancePreferences().palette;
  }

  function applyPalette(palette = currentPalette()) {
    const next = ALLOWED_PALETTES.includes(palette) ? palette : "aurora";
    document.documentElement.dataset.palette = next;
  }

  function isHtmlLanguage(value) {
    return String(value || "").trim().toUpperCase() === "HTML";
  }

  function isWebLanguage(value) {
    return ["HTML", "CSS", "JAVASCRIPT"].includes(String(value || "").trim().toUpperCase());
  }

  function defaultEvaluationMode(language) {
    return isWebLanguage(language) ? "WEB_PREVIEW" : "TEST_CASES";
  }

  function evaluationModeFor(question) {
    return question?.evaluationMode || defaultEvaluationMode(question?.language);
  }

  function isWebPreviewQuestion(question) {
    return question?.type === "CODE" && evaluationModeFor(question) === "WEB_PREVIEW";
  }

  function isTestCaseQuestion(question) {
    return question?.type === "CODE" && evaluationModeFor(question) === "TEST_CASES";
  }

  function cleanCodeFence(value) {
    return String(value || "")
      .replace(/^\s*```[a-z+#]*\s*/i, "")
      .replace(/\s*```\s*$/i, "");
  }

  function getStarterFiles(question) {
    const provided = question?.starterFiles && typeof question.starterFiles === "object"
      ? question.starterFiles
      : {};
    const files = {
      html: String(provided.html || ""),
      css: String(provided.css || ""),
      javascript: String(provided.javascript || "")
    };

    if (!files.html && !files.css && !files.javascript && question?.starterCode) {
      const language = String(question.language || "").toUpperCase();
      if (language === "CSS") files.css = String(question.starterCode);
      else if (language === "JAVASCRIPT") files.javascript = String(question.starterCode);
      else files.html = String(question.starterCode);
    }

    if (!files.html && String(question?.language || "").toUpperCase() === "CSS") {
      files.html = '<main class="preview-stage">Style this preview area with CSS.</main>';
    }
    if (!files.html && String(question?.language || "").toUpperCase() === "JAVASCRIPT") {
      files.html = '<main><h1>JavaScript Preview</h1><div id="app"></div></main>';
    }
    return files;
  }

  function getResponseFiles(question, response) {
    const starter = getStarterFiles(question);
    const provided = response?.files && typeof response.files === "object" ? response.files : {};
    const files = {
      html: provided.html ?? starter.html,
      css: provided.css ?? starter.css,
      javascript: provided.javascript ?? starter.javascript
    };

    if (!response?.files && response?.code) {
      const language = String(question?.language || "").toUpperCase();
      if (language === "CSS") files.css = response.code;
      else if (language === "JAVASCRIPT") files.javascript = response.code;
      else files.html = response.code;
    }
    return files;
  }

  function hasCodeResponse(question, response) {
    if (!response) return false;
    if (isWebPreviewQuestion(question)) {
      const files = getResponseFiles(question, response);
      return WEB_FILE_KEYS.some((key) => String(files[key] || "").trim());
    }
    return Boolean(String(response.code || "").trim());
  }

  function decodeHtmlEntities(value) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = String(value || "");
    return decoder.value;
  }

  function normalizeHtmlSource(source) {
    let html = cleanCodeFence(source, "html").replace(/^\uFEFF/, "").trim();
    if (!html) return "";

    // Firestore, copied snippets, and textarea hydration can leave markup encoded
    // once or more. Decode only while the source looks like encoded HTML and does
    // not already contain a real element.
    for (let pass = 0; pass < 4; pass += 1) {
      const containsRealTag = /<\s*(?:!doctype|html|head|body|[a-z][\w:-]*)(?:\s|>|\/)/i.test(html);
      const looksEntityEncoded = /(?:&(?:amp;)*lt;|&#0*60;|&#x0*3c;)\s*(?:!doctype|html|head|body|[a-z][\w:-]*)/i.test(html);
      if (containsRealTag || !looksEntityEncoded) break;
      const decoded = decodeHtmlEntities(html);
      if (decoded === html) break;
      html = decoded;
    }
    return html;
  }

  function normalizeWebPreview(files = {}) {
    let html = normalizeHtmlSource(files.html);
    const css = cleanCodeFence(files.css, "css").replace(/<\/style/gi, "<\\/style");
    const javascript = cleanCodeFence(files.javascript, "(?:javascript|js)").replace(/<\/script/gi, "<\\/script");

    if (!html) {
      html = `<main class="aaki-preview-empty"><h1>Live preview</h1><p>Write HTML, CSS, or JavaScript to see the project here.</p></main>`;
    }

    const baseHref = String(document.baseURI || window.location.href).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const previewSupport = `
<base href="${baseHref}">
<style id="aaki-preview-support">
  html{background:#fff;color:#171219}
  body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .aaki-preview-empty{min-height:100vh;display:grid;place-content:center;text-align:center;padding:32px;color:#756b78;box-sizing:border-box}
  .aaki-runtime-error{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;padding:12px 14px;border-radius:10px;background:#2b1720;color:#fff;font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;box-shadow:0 12px 32px rgba(0,0,0,.25)}
</style>`;

    const userStyle = css ? `<style id="aaki-user-css">${css}</style>` : "";
    const userScript = javascript ? `
<script>
(() => {
  const showError = (message) => {
    let box = document.getElementById("aaki-runtime-error");
    if (!box) {
      box = document.createElement("div");
      box.id = "aaki-runtime-error";
      box.className = "aaki-runtime-error";
      document.body.appendChild(box);
    }
    box.textContent = "JavaScript error: " + message;
  };
  window.addEventListener("error", (event) => showError(event.message || "Unknown error"));
  window.addEventListener("unhandledrejection", (event) => showError(event.reason?.message || String(event.reason || "Unhandled promise rejection")));
  try {
${javascript}
  } catch (error) {
    showError(error?.message || String(error));
  }
})();
<\/script>` : "";

    const isCompleteDocument = /<!doctype\s+html/i.test(html) || /<html(?:\s|>)/i.test(html);
    if (!isCompleteDocument) {
      return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${previewSupport}
  ${userStyle}
</head>
<body>
${html}
${userScript}
</body>
</html>`;
    }

    let documentHtml = html;
    const headContent = `${previewSupport}${userStyle}`;
    if (/<\/head>/i.test(documentHtml)) {
      documentHtml = documentHtml.replace(/<\/head>/i, `${headContent}</head>`);
    } else if (/<html(?:\s[^>]*)?>/i.test(documentHtml)) {
      documentHtml = documentHtml.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${headContent}</head>`);
    } else {
      documentHtml = `${headContent}${documentHtml}`;
    }

    if (userScript) {
      if (/<\/body>/i.test(documentHtml)) documentHtml = documentHtml.replace(/<\/body>/i, `${userScript}</body>`);
      else documentHtml += userScript;
    }
    return documentHtml;
  }

  function normalizeHtmlPreview(source) {
    return normalizeWebPreview({ html: source, css: "", javascript: "" });
  }

  function renderWebPreview(frame, files) {
    if (!frame) return;
    const source = normalizeWebPreview(files);
    const previousUrl = frame.dataset.previewObjectUrl || "";
    const objectUrl = URL.createObjectURL(new Blob([source], { type: "text/html;charset=utf-8" }));
    frame.dataset.previewObjectUrl = objectUrl;
    frame.removeAttribute("srcdoc");
    frame.src = objectUrl;
    if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 0);
  }

  function renderHtmlPreview(frame, source) {
    renderWebPreview(frame, { html: source, css: "", javascript: "" });
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const options = includeTime
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" };
    return date.toLocaleDateString("en-IN", options);
  }

  function toLocalDateTimeInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  function clamp(number, min, max) {
    return Math.min(Math.max(Number(number) || 0, min), max);
  }

  function getInitials(name = "User") {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");
  }

  function imageWithFallback(source, alt, className, fallbackText = "") {
    const image = String(source || "").trim();
    const fallback = escapeHtml(fallbackText || "ADJ");
    if (!image) return `<div class="${escapeAttr(className)} image-fallback">${fallback}</div>`;
    return `<div class="${escapeAttr(className)} has-photo"><img src="${escapeAttr(image)}" alt="${escapeAttr(alt || "Image")}" onerror="const parent=this.parentElement;parent.classList.remove('has-photo');this.remove();parent.textContent='${escapeAttr(fallbackText || "ADJ")}';parent.classList.add('image-fallback')" /></div>`;
  }

  function brandLogoMarkup(className = "brand-logo") {
    return imageWithFallback(data?.branding?.logoPath, "Aaki's Developer Journey logo", className, "ADJ");
  }

  function avatarMarkup(user, className = "avatar") {
    const safeUser = user || { name: "User", avatarData: "" };
    return imageWithFallback(safeUser.avatarData, `${safeUser.name || "Profile"} profile photo`, className, getInitials(safeUser.name || "User"));
  }

  function publicProfile(user) {
    return {
      id: user.id,
      authId: user.authId || "",
      name: user.name,
      username: user.username,
      title: user.title,
      role: user.role,
      avatarData: String(user.avatarData || "")
    };
  }

  function getTestTotal(test) {
    const calculated = (test?.questions || []).reduce((sum, question) => sum + Number(question.marks || 0), 0);
    return calculated || Number(test?.totalMarks || 0);
  }

  function getTestQuestionCount(test) {
    return (test?.questions || []).length || Number(test?.questionCount || 0);
  }

  function getTestMcqCount(test) {
    const calculated = (test?.questions || []).filter((question) => question.type === "MCQ").length;
    return calculated || Number(test?.mcqCount || 0);
  }

  function getTestCodeCount(test) {
    const calculated = (test?.questions || []).filter((question) => question.type === "CODE").length;
    return calculated || Number(test?.codeCount || 0);
  }

  function getAttempt(testId, userId = currentUser?.id) {
    return data.attempts
      .filter((attempt) => attempt.testId === testId && attempt.userId === userId)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
  }

  function getTest(testId) {
    return data.tests.find((test) => test.id === testId) || null;
  }

  function getUser(userId) {
    return data.users.find((user) => user.id === userId) || null;
  }

  function getAdmin() {
    return data.users.find((user) => user.role === "ADMIN") || null;
  }

  function getCandidate() {
    return data.users.find((user) => user.role === "CANDIDATE") || null;
  }

  function isAdmin() {
    return currentUser?.role === "ADMIN";
  }

  function isCandidate() {
    return currentUser?.role === "CANDIDATE";
  }

  function requireAdmin() {
    if (isAdmin()) return true;
    toast("Access denied", "This area is available only to the administrator.");
    if (currentUser) go("dashboard");
    return false;
  }

  function requireCandidate() {
    if (isCandidate()) return true;
    toast("Access denied", "This action is available only to the candidate account.");
    if (currentUser) go("dashboard");
    return false;
  }

  function ownsAttempt(attempt) {
    return Boolean(attempt && currentUser && (isAdmin() || attempt.userId === currentUser.id));
  }

  function getMcqScore(test, attempt) {
    return test.questions
      .filter((question) => question.type === "MCQ")
      .reduce((score, question) => {
        const response = attempt.responses?.[question.id];
        return score + (response?.selectedOptionId === question.correctOptionId && response?.locked ? 1 : 0);
      }, 0);
  }

  function calculateAttemptScore(test, attempt) {
    const mcqScore = getMcqScore(test, attempt);
    const codingScore = test.questions
      .filter((question) => question.type === "CODE")
      .reduce((sum, question) => {
        const review = attempt.review?.questionReviews?.[question.id];
        return sum + clamp(review?.awardedMarks, 0, question.marks);
      }, 0);
    const total = getTestTotal(test);
    const obtained = mcqScore + codingScore;
    const percentage = total ? Math.round((obtained / total) * 100) : 0;
    return { mcqScore, codingScore, obtained, total, percentage };
  }

  function isTestLocked(test) {
    if (!test?.opensAt) return false;
    const opensAt = new Date(test.opensAt).getTime();
    return Number.isFinite(opensAt) && Date.now() < opensAt;
  }

  function testScheduleBadge(test) {
    if (!test?.opensAt) return `<span class="badge badge-green">Opens immediately</span>`;
    return isTestLocked(test)
      ? `<span class="badge badge-blue">Locked until ${escapeHtml(formatDate(test.opensAt, true))}</span>`
      : `<span class="badge badge-green">Opened ${escapeHtml(formatDate(test.opensAt, true))}</span>`;
  }

  function statusBadge(status) {
    const map = {
      DRAFT: ["Draft", "badge"],
      PUBLISHED: ["Published", "badge-green"],
      LOCKED: ["Scheduled", "badge-blue"],
      IN_PROGRESS: ["In progress", "badge-blue"],
      SUBMITTED: ["Submitted", "badge-amber"],
      UNDER_REVIEW: ["Under review", "badge-amber"],
      REVIEWED: ["Reviewed", "badge-primary"],
      RESULT_PUBLISHED: ["Result published", "badge-green"]
    };
    const [label, variant] = map[status] || [status, "badge"];
    return `<span class="badge ${variant}">${label}</span>`;
  }

  function difficultyBadge(difficulty) {
    const variant = difficulty === "Advanced" ? "badge-rose" : difficulty === "Intermediate" ? "badge-amber" : "badge-green";
    return `<span class="badge ${variant}">${escapeHtml(difficulty)}</span>`;
  }

  function createEmptyData() {
    return {
      version: SCHEMA_VERSION,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      users: [],
      branding: { palette: "aurora", logoPath: "assets/branding/app-logo.png", updatedAt: nowIso() },
      tests: [],
      attempts: [],
      activity: []
    };
  }

  function ensureConfiguredAccounts(workspace) {
    const existingAdmin = workspace.users.find((user) => user.role === "ADMIN") || { id: "user_admin" };
    const existingCandidate = workspace.users.find((user) => user.role === "CANDIDATE") || { id: "user_aaki" };

    const admin = { ...existingAdmin, ...CONFIGURED_ACCOUNTS.ADMIN, role: "ADMIN", avatarData: String(existingAdmin.avatarData || CONFIGURED_ACCOUNTS.ADMIN.avatarData || "") };
    const candidate = { ...existingCandidate, ...CONFIGURED_ACCOUNTS.CANDIDATE, role: "CANDIDATE", avatarData: String(existingCandidate.avatarData || CONFIGURED_ACCOUNTS.CANDIDATE.avatarData || "") };
    delete admin.email;
    delete admin.password;
    delete candidate.email;
    delete candidate.password;

    workspace.users = [admin, candidate];
    return workspace;
  }

  function normalizeQuestionForSchema(question) {
    if (!question || question.type !== "CODE") return question;
    const evaluationMode = question.evaluationMode || defaultEvaluationMode(question.language);
    const testCases = Array.isArray(question.testCases)
      ? question.testCases.map((item) => ({
          id: item.id || uid("case"),
          input: String(item.input || ""),
          expectedOutput: String(item.expectedOutput || ""),
          visibility: item.visibility === "HIDDEN" ? "HIDDEN" : "PUBLIC",
          note: String(item.note || "")
        }))
      : [];
    return {
      ...question,
      imageData: String(question.imageData || question.imageUrl || ""),
      imageAlt: String(question.imageAlt || ""),
      evaluationMode,
      starterFiles: getStarterFiles(question),
      testCases
    };
  }

  function migrateData(raw, fromLegacy = false) {
    const workspace = raw && typeof raw === "object" ? deepClone(raw) : createEmptyData();
    workspace.users = Array.isArray(workspace.users) ? workspace.users : [];
    workspace.tests = Array.isArray(workspace.tests) ? workspace.tests : [];
    workspace.attempts = Array.isArray(workspace.attempts) ? workspace.attempts : [];
    workspace.activity = Array.isArray(workspace.activity) ? workspace.activity : [];
    workspace.branding = workspace.branding && typeof workspace.branding === "object" ? workspace.branding : {};
    workspace.branding.palette = ["aurora", "ocean", "sunset", "candy"].includes(workspace.branding.palette) ? workspace.branding.palette : "aurora";
    workspace.branding.logoPath = String(workspace.branding.logoPath || "assets/branding/app-logo.png");
    workspace.branding.updatedAt = workspace.branding.updatedAt || workspace.updatedAt || nowIso();

    const customTests = workspace.tests.filter((test) => !DEMO_TEST_IDS.has(test.id));
    const customAttempts = workspace.attempts.filter((attempt) => !DEMO_ATTEMPT_IDS.has(attempt.id) && !DEMO_TEST_IDS.has(attempt.testId));
    const onlyLegacyDemoUsers = workspace.users.length > 0 && workspace.users.every((user) =>
      ["user_admin", "user_aaki"].includes(user.id) && String(user.email || "").endsWith("@devora.local")
    );

    workspace.tests = customTests.map((test) => ({
      ...test,
      opensAt: test.opensAt || null,
      assignedTo: Array.isArray(test.assignedTo) ? test.assignedTo : [],
      questions: (Array.isArray(test.questions) ? test.questions : []).map((question) => {
        const normalized = normalizeQuestionForSchema(question);
        return {
          ...normalized,
          imageData: String(normalized?.imageData || normalized?.imageUrl || ""),
          imageAlt: String(normalized?.imageAlt || "")
        };
      })
    }));

    workspace.attempts = customAttempts.map((attempt) => {
      const remainingSeconds = Number(attempt.remainingSeconds) || 0;
      const expiresAt = attempt.expiresAt || (attempt.status === "IN_PROGRESS" && attempt.startedAt
        ? new Date(new Date(attempt.startedAt).getTime() + remainingSeconds * 1000).toISOString()
        : null);
      const integrityEvents = Array.isArray(attempt.integrityEvents) ? attempt.integrityEvents : [];
      const review = attempt.review && typeof attempt.review === "object" ? attempt.review : {};
      return {
        ...attempt,
        responses: (() => {
          const responses = attempt.responses && typeof attempt.responses === "object" ? deepClone(attempt.responses) : {};
          const test = workspace.tests.find((item) => item.id === attempt.testId);
          (test?.questions || []).forEach((question) => {
            if (question.type !== "CODE") return;
            responses[question.id] = responses[question.id] && typeof responses[question.id] === "object"
              ? responses[question.id]
              : {};
            if (isWebPreviewQuestion(question)) {
              responses[question.id].files = getResponseFiles(question, responses[question.id]);
            }
          });
          return responses;
        })(),
        review: {
          questionReviews: review.questionReviews && typeof review.questionReviews === "object" ? review.questionReviews : {},
          overallNotes: review.overallNotes || "",
          strengths: review.strengths || "",
          improvements: review.improvements || "",
          nextSteps: review.nextSteps || "",
          encouragement: review.encouragement || ""
        },
        expiresAt,
        integrityEvents,
        tabSwitchCount: Number(attempt.tabSwitchCount) || integrityEvents.filter((event) => event.type === "TAB_SWITCH").length
      };
    });

    workspace.activity = workspace.activity.filter((item) =>
      !String(item?.text || "").includes("HTML Structure & Semantics result published") &&
      !String(item?.text || "").includes("HTML Fundamentals — Level 1 published")
    );

    if (fromLegacy && onlyLegacyDemoUsers && workspace.tests.length === 0 && workspace.attempts.length === 0) {
      workspace.users = [];
      workspace.activity = [];
    }

    ensureConfiguredAccounts(workspace);
    workspace.version = SCHEMA_VERSION;
    workspace.createdAt = workspace.createdAt || nowIso();
    workspace.updatedAt = nowIso();
    return workspace;
  }

  function clearCloudWorkspaceCaches() {
    const removable = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && (key === STORAGE_KEY || key === BACKUP_KEY || key.startsWith(`${STORAGE_KEY}_`) || key.startsWith(`${BACKUP_KEY}_`))) {
        removable.push(key);
      }
    }
    removable.forEach((key) => localStorage.removeItem(key));
  }

  function persistLocalData() {
    if (cloudAuthenticated) return;
    data.version = SCHEMA_VERSION;
    data.updatedAt = nowIso();
    const next = JSON.stringify(data);
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous && previous !== next) localStorage.setItem(BACKUP_KEY, previous);
    localStorage.setItem(STORAGE_KEY, next);
  }

  function saveData() {
    persistLocalData();
    scheduleCloudSave();
  }

  function loadData() {
    const candidates = [
      [STORAGE_KEY, false],
      [BACKUP_KEY, false],
      [LEGACY_STORAGE_KEY, true]
    ];

    for (const [key, isLegacy] of candidates) {
      try {
        const saved = localStorage.getItem(key);
        if (!saved) continue;
        const migrated = migrateData(JSON.parse(saved), isLegacy);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      } catch (error) {
        console.warn(`Unable to load workspace from ${key}`, error);
      }
    }

    const empty = migrateData(createEmptyData(), false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
    return empty;
  }

  function candidatePublicQuestion(question) {
    const copy = deepClone(question);
    if (copy.type === "MCQ") delete copy.correctOptionId;
    if (copy.type === "CODE") {
      copy.testCases = (copy.testCases || []).filter((item) => item.visibility !== "HIDDEN");
    }
    return copy;
  }

  function candidatePublishedQuestion(question) {
    const copy = deepClone(question);
    if (copy.type === "CODE") {
      copy.testCases = (copy.testCases || []).map((item) => item.visibility === "HIDDEN"
        ? { id: item.id, visibility: "HIDDEN", input: "", expectedOutput: "", note: "" }
        : item);
    }
    return copy;
  }

  function candidatePublicTest(test) {
    return {
      ...deepClone(test),
      questions: (test.questions || []).map(candidatePublicQuestion)
    };
  }

  function candidatePublishedTest(test) {
    return {
      ...deepClone(test),
      questions: (test.questions || []).map(candidatePublishedQuestion)
    };
  }

  function candidateAttemptState(attempt) {
    const copy = deepClone(attempt);
    delete copy.review;
    delete copy.finalScore;
    delete copy.reviewedAt;
    delete copy.publishedAt;
    return copy;
  }

  function buildCandidateResultsPayload() {
    return data.attempts
      .filter((attempt) => attempt.status === "RESULT_PUBLISHED")
      .map((attempt) => {
        const test = getTest(attempt.testId);
        return test ? { attempt: deepClone(attempt), testSnapshot: candidatePublishedTest(test) } : null;
      })
      .filter(Boolean);
  }

  function mergeCandidateAttempts(adminAttempts, candidateAttempts) {
    const byId = new Map((adminAttempts || []).map((attempt) => [attempt.id, deepClone(attempt)]));
    (candidateAttempts || []).forEach((candidateAttempt) => {
      const existing = byId.get(candidateAttempt.id);
      if (!existing) {
        byId.set(candidateAttempt.id, deepClone(candidateAttempt));
        return;
      }
      const published = existing.status === "RESULT_PUBLISHED";
      byId.set(candidateAttempt.id, {
        ...existing,
        ...deepClone(candidateAttempt),
        status: published ? "RESULT_PUBLISHED" : candidateAttempt.status,
        review: existing.review,
        finalScore: existing.finalScore,
        reviewedAt: existing.reviewedAt,
        publishedAt: existing.publishedAt
      });
    });
    return [...byId.values()];
  }

  function firestoreTimestamp(value) {
    if (!value || !window.firebase?.firestore?.Timestamp) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : window.firebase.firestore.Timestamp.fromDate(date);
  }

  function cacheString(value) {
    return JSON.stringify(value ?? null);
  }

  function stripCloudFields(value) {
    const copy = deepClone(value || {});
    [
      "adminId", "candidateId", "workspaceId", "opensAtTs", "updatedAtTs",
      "startedAtTs", "expiresAtTs", "submittedAtTs", "publishedAtTs", "reviewedAtTs"
    ].forEach((key) => delete copy[key]);
    return copy;
  }

  function candidateCatalogTest(test, adminId, candidateId) {
    const questions = Array.isArray(test.questions) ? test.questions : [];
    return {
      id: test.id,
      adminId,
      candidateId,
      workspaceId: adminId,
      title: test.title || "Assessment",
      description: test.description || "",
      technology: test.technology || "Other",
      difficulty: test.difficulty || "Beginner",
      durationMinutes: Number(test.durationMinutes) || 60,
      passPercentage: Number(test.passPercentage) || 0,
      instructions: test.instructions || "",
      status: test.status,
      opensAt: test.opensAt || null,
      opensAtTs: firestoreTimestamp(test.opensAt),
      assignedTo: Array.isArray(test.assignedTo) ? test.assignedTo : [],
      questionCount: questions.length,
      mcqCount: questions.filter((question) => question.type === "MCQ").length,
      codeCount: questions.filter((question) => question.type === "CODE").length,
      totalMarks: getTestTotal(test),
      createdAt: test.createdAt || nowIso(),
      updatedAt: test.updatedAt || nowIso(),
      updatedAtTs: firestoreTimestamp(test.updatedAt || nowIso())
    };
  }

  function candidateContentTest(test, adminId, candidateId) {
    const safe = candidatePublicTest(test);
    return {
      ...deepClone(safe),
      adminId,
      candidateId,
      workspaceId: adminId,
      opensAtTs: firestoreTimestamp(test.opensAt),
      updatedAtTs: firestoreTimestamp(test.updatedAt || nowIso())
    };
  }

  function privateTestPayload(test, adminId, candidateId) {
    return {
      ...deepClone(test),
      adminId,
      candidateId,
      workspaceId: adminId,
      opensAtTs: firestoreTimestamp(test.opensAt),
      updatedAtTs: firestoreTimestamp(test.updatedAt || nowIso())
    };
  }

  function attemptPayload(attempt, adminId, candidateId) {
    const safe = candidateAttemptState(attempt);
    const updatedAt = safe.lastSavedAt || safe.submittedAt || nowIso();
    return {
      ...safe,
      adminId,
      candidateId,
      workspaceId: adminId,
      startedAtTs: firestoreTimestamp(safe.startedAt),
      expiresAtTs: firestoreTimestamp(safe.expiresAt),
      submittedAtTs: firestoreTimestamp(safe.submittedAt),
      updatedAt,
      updatedAtTs: firestoreTimestamp(updatedAt)
    };
  }

  function reviewPayload(attempt, adminId, candidateId) {
    const updatedAt = attempt.publishedAt || attempt.reviewedAt || attempt.submittedAt || nowIso();
    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      adminId,
      candidateId,
      workspaceId: adminId,
      status: attempt.status,
      review: deepClone(attempt.review || {}),
      finalScore: attempt.finalScore ? deepClone(attempt.finalScore) : null,
      reviewedAt: attempt.reviewedAt || null,
      publishedAt: attempt.publishedAt || null,
      reviewedAtTs: firestoreTimestamp(attempt.reviewedAt),
      publishedAtTs: firestoreTimestamp(attempt.publishedAt),
      updatedAt,
      updatedAtTs: firestoreTimestamp(updatedAt)
    };
  }

  function resultPayload(attempt, test, adminId, candidateId) {
    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      adminId,
      candidateId,
      workspaceId: adminId,
      publishedAt: attempt.publishedAt || nowIso(),
      publishedAtTs: firestoreTimestamp(attempt.publishedAt || nowIso()),
      attempt: deepClone(attempt),
      testSnapshot: candidatePublishedTest(test),
      updatedAt: attempt.publishedAt || attempt.reviewedAt || attempt.submittedAt || nowIso(),
      updatedAtTs: firestoreTimestamp(attempt.publishedAt || attempt.reviewedAt || attempt.submittedAt || nowIso())
    };
  }

  function workspacePayload(adminId, candidateId) {
    const admin = getAdmin();
    const candidate = getCandidate();
    const updatedAt = data.branding?.updatedAt || data.createdAt || nowIso();
    return {
      adminId,
      candidateId,
      workspaceId: adminId,
      palette: ALLOWED_PALETTES.includes(data.branding?.palette) ? data.branding.palette : "aurora",
      logoPath: String(data.branding?.logoPath || "assets/branding/app-logo.png"),
      adminPhotoPath: String(admin?.avatarData || "assets/profiles/aayush.jpg"),
      candidatePhotoPath: String(candidate?.avatarData || "assets/profiles/aaki.jpg"),
      updatedAt,
      updatedAtTs: firestoreTimestamp(updatedAt)
    };
  }

  function resetCloudCache() {
    cloudCache = {
      tests: new Map(),
      catalogs: new Map(),
      contents: new Map(),
      attempts: new Map(),
      reviews: new Map(),
      results: new Map(),
      workspace: ""
    };
  }

  function primeCloudCache() {
    resetCloudCache();
    if (!isCloudMode()) return;
    const adminId = cloudAdminAuthId;
    const candidateId = cloudCandidateAuthId;
    if (!adminId || !candidateId) return;

    if ((currentUser?.role || cloudProfile?.role) === "ADMIN") {
      data.tests.forEach((test) => {
        cloudCache.tests.set(test.id, cacheString(privateTestPayload(test, adminId, candidateId)));
        if (test.status === "PUBLISHED") {
          cloudCache.catalogs.set(test.id, cacheString(candidateCatalogTest(test, adminId, candidateId)));
          cloudCache.contents.set(test.id, cacheString(candidateContentTest(test, adminId, candidateId)));
        }
      });
      data.attempts.forEach((attempt) => {
        cloudCache.attempts.set(attempt.id, cacheString(attemptPayload(attempt, adminId, candidateId)));
        if (attempt.review && ["UNDER_REVIEW", "REVIEWED", "RESULT_PUBLISHED"].includes(attempt.status)) {
          cloudCache.reviews.set(attempt.id, cacheString(reviewPayload(attempt, adminId, candidateId)));
        }
        if (attempt.status === "RESULT_PUBLISHED") {
          const test = getTest(attempt.testId);
          if (test) cloudCache.results.set(attempt.id, cacheString(resultPayload(attempt, test, adminId, candidateId)));
        }
      });
      cloudCache.workspace = cacheString(workspacePayload(adminId, candidateId));
    } else {
      data.attempts
        .filter((attempt) => attempt.userId === getCandidate()?.id && ["IN_PROGRESS", "SUBMITTED"].includes(attempt.status))
        .forEach((attempt) => cloudCache.attempts.set(attempt.id, cacheString(attemptPayload(attempt, adminId, candidateId))));
    }
  }

  function scheduleCloudSave() {
    if (!isCloudMode() || cloudSyncing) return;
    clearTimeout(cloudSaveHandle);
    cloudSaveHandle = setTimeout(() => syncCloudData().catch((error) => {
      console.warn("Firebase sync failed", error);
      toast("Sync paused", "Your open page keeps the latest changes and will retry automatically.");
    }), 900);
  }

  async function getCloudAdminAuthId() {
    if (cloudAdminAuthId) return cloudAdminAuthId;
    if (!cloudProfile) return null;
    cloudAdminAuthId = cloudProfile.role === "ADMIN"
      ? cloudProfile.id
      : (cloudProfile.workspaceId || cloudProfile.linkedAdminId || null);
    return cloudAdminAuthId;
  }

  async function getCloudCandidateAuthId() {
    if (cloudCandidateAuthId) return cloudCandidateAuthId;
    if (!firestoreDb || !cloudProfile) return null;
    if (cloudProfile.role === "CANDIDATE") {
      cloudCandidateAuthId = cloudProfile.id;
      return cloudCandidateAuthId;
    }
    if (cloudProfile.linkedCandidateId) {
      cloudCandidateAuthId = cloudProfile.linkedCandidateId;
      return cloudCandidateAuthId;
    }
    const adminId = await getCloudAdminAuthId();
    const snapshot = await firestoreDb.collection(COLLECTIONS.USERS)
      .where("workspaceId", "==", adminId)
      .where("role", "==", "CANDIDATE")
      .limit(1)
      .get();
    cloudCandidateAuthId = snapshot.empty ? null : snapshot.docs[0].id;
    return cloudCandidateAuthId;
  }

  async function setIfChanged(cacheMap, key, reference, payload, operations) {
    const next = cacheString(payload);
    if (cacheMap.get(key) === next) return;
    operations.push(reference.set(payload).then(() => cacheMap.set(key, next)));
  }

  async function deleteIfCached(cacheMap, key, reference, operations) {
    if (!cacheMap.has(key)) return;
    operations.push(reference.delete().then(() => cacheMap.delete(key)));
  }

  async function syncCloudData(force = false) {
    if (!isCloudMode() || cloudSyncing) return;
    cloudSyncing = true;
    try {
      const adminId = await getCloudAdminAuthId();
      const candidateId = await getCloudCandidateAuthId();
      if (!adminId) throw new Error("Aayush's Firebase profile is missing its workspace ID.");
      if (!candidateId) throw new Error("Aaki's Firebase profile is missing from this workspace.");
      const operations = [];

      if ((currentUser?.role || cloudProfile?.role) === "ADMIN") {
        const liveTestIds = new Set();
        for (const test of data.tests) {
          liveTestIds.add(test.id);
          await setIfChanged(
            cloudCache.tests,
            test.id,
            firestoreDb.collection(COLLECTIONS.PRIVATE_TESTS).doc(test.id),
            privateTestPayload(test, adminId, candidateId),
            operations
          );
          if (test.status === "PUBLISHED") {
            await setIfChanged(
              cloudCache.catalogs,
              test.id,
              firestoreDb.collection(COLLECTIONS.TEST_CATALOG).doc(test.id),
              candidateCatalogTest(test, adminId, candidateId),
              operations
            );
            await setIfChanged(
              cloudCache.contents,
              test.id,
              firestoreDb.collection(COLLECTIONS.TEST_CONTENT).doc(test.id),
              candidateContentTest(test, adminId, candidateId),
              operations
            );
          } else {
            await deleteIfCached(cloudCache.catalogs, test.id, firestoreDb.collection(COLLECTIONS.TEST_CATALOG).doc(test.id), operations);
            await deleteIfCached(cloudCache.contents, test.id, firestoreDb.collection(COLLECTIONS.TEST_CONTENT).doc(test.id), operations);
          }
        }
        for (const id of [...cloudCache.tests.keys()]) {
          if (liveTestIds.has(id)) continue;
          await deleteIfCached(cloudCache.tests, id, firestoreDb.collection(COLLECTIONS.PRIVATE_TESTS).doc(id), operations);
          await deleteIfCached(cloudCache.catalogs, id, firestoreDb.collection(COLLECTIONS.TEST_CATALOG).doc(id), operations);
          await deleteIfCached(cloudCache.contents, id, firestoreDb.collection(COLLECTIONS.TEST_CONTENT).doc(id), operations);
        }

        const liveAttemptIds = new Set();
        for (const attempt of data.attempts) {
          liveAttemptIds.add(attempt.id);
          await setIfChanged(
            cloudCache.attempts,
            attempt.id,
            firestoreDb.collection(COLLECTIONS.ATTEMPTS).doc(attempt.id),
            attemptPayload(attempt, adminId, candidateId),
            operations
          );

          if (attempt.review && ["UNDER_REVIEW", "REVIEWED", "RESULT_PUBLISHED"].includes(attempt.status)) {
            await setIfChanged(
              cloudCache.reviews,
              attempt.id,
              firestoreDb.collection(COLLECTIONS.REVIEWS).doc(attempt.id),
              reviewPayload(attempt, adminId, candidateId),
              operations
            );
          } else {
            await deleteIfCached(cloudCache.reviews, attempt.id, firestoreDb.collection(COLLECTIONS.REVIEWS).doc(attempt.id), operations);
          }

          if (attempt.status === "RESULT_PUBLISHED") {
            const test = getTest(attempt.testId);
            if (test) {
              await setIfChanged(
                cloudCache.results,
                attempt.id,
                firestoreDb.collection(COLLECTIONS.RESULTS).doc(attempt.id),
                resultPayload(attempt, test, adminId, candidateId),
                operations
              );
            }
          } else {
            await deleteIfCached(cloudCache.results, attempt.id, firestoreDb.collection(COLLECTIONS.RESULTS).doc(attempt.id), operations);
          }
        }
        for (const id of [...cloudCache.attempts.keys()]) {
          if (liveAttemptIds.has(id)) continue;
          await deleteIfCached(cloudCache.attempts, id, firestoreDb.collection(COLLECTIONS.ATTEMPTS).doc(id), operations);
          await deleteIfCached(cloudCache.reviews, id, firestoreDb.collection(COLLECTIONS.REVIEWS).doc(id), operations);
          await deleteIfCached(cloudCache.results, id, firestoreDb.collection(COLLECTIONS.RESULTS).doc(id), operations);
        }

        const workspace = workspacePayload(adminId, candidateId);
        const workspaceCache = cacheString(workspace);
        if (cloudCache.workspace !== workspaceCache) {
          operations.push(
            firestoreDb.collection(COLLECTIONS.WORKSPACES).doc(adminId).set(workspace)
              .then(() => { cloudCache.workspace = workspaceCache; })
          );
          const admin = getAdmin();
          const candidate = getCandidate();
          if (admin) {
            operations.push(firestoreDb.collection(COLLECTIONS.USERS).doc(adminId).set({
              username: admin.username,
              name: admin.name,
              title: admin.title,
              role: "ADMIN",
              workspaceId: adminId,
              linkedCandidateId: candidateId,
              avatarPath: admin.avatarData || "",
              updatedAt: nowIso()
            }, { merge: true }));
          }
          if (candidate) {
            operations.push(firestoreDb.collection(COLLECTIONS.USERS).doc(candidateId).set({
              username: candidate.username,
              name: candidate.name,
              title: candidate.title,
              role: "CANDIDATE",
              workspaceId: adminId,
              linkedAdminId: adminId,
              avatarPath: candidate.avatarData || "",
              updatedAt: nowIso()
            }, { merge: true }));
          }
        }
      } else {
        const candidateLogicalId = currentUser?.id || getCandidate()?.id;
        for (const attempt of data.attempts.filter((item) => item.userId === candidateLogicalId && ["IN_PROGRESS", "SUBMITTED"].includes(item.status))) {
          await setIfChanged(
            cloudCache.attempts,
            attempt.id,
            firestoreDb.collection(COLLECTIONS.ATTEMPTS).doc(attempt.id),
            attemptPayload(attempt, adminId, candidateId),
            operations
          );
        }
      }

      await Promise.all(operations);
      if (force) toast("Firebase synced", "The latest tests, submissions, and results are available across devices.");
    } finally {
      cloudSyncing = false;
    }
  }

  async function loadUserProfile(authUser) {
    if (!authUser || !firestoreDb) return null;
    const snapshot = await firestoreDb.collection(COLLECTIONS.USERS).doc(authUser.uid).get();
    if (!snapshot.exists) throw new Error("This Firebase account does not have a role profile yet.");
    return { id: snapshot.id, ...snapshot.data() };
  }

  function logicalUsersFromCloud(adminProfile, candidateProfile, workspace) {
    const admin = {
      id: "user_admin",
      authId: adminProfile?.id || cloudAdminAuthId || "",
      ...CONFIGURED_ACCOUNTS.ADMIN,
      name: adminProfile?.name || CONFIGURED_ACCOUNTS.ADMIN.name,
      username: adminProfile?.username || CONFIGURED_ACCOUNTS.ADMIN.username,
      title: adminProfile?.title || CONFIGURED_ACCOUNTS.ADMIN.title,
      avatarData: workspace?.adminPhotoPath || adminProfile?.avatarPath || CONFIGURED_ACCOUNTS.ADMIN.avatarData,
      role: "ADMIN"
    };
    const candidate = {
      id: "user_aaki",
      authId: candidateProfile?.id || cloudCandidateAuthId || "",
      ...CONFIGURED_ACCOUNTS.CANDIDATE,
      name: candidateProfile?.name || CONFIGURED_ACCOUNTS.CANDIDATE.name,
      username: candidateProfile?.username || CONFIGURED_ACCOUNTS.CANDIDATE.username,
      title: candidateProfile?.title || CONFIGURED_ACCOUNTS.CANDIDATE.title,
      avatarData: workspace?.candidatePhotoPath || candidateProfile?.avatarPath || CONFIGURED_ACCOUNTS.CANDIDATE.avatarData,
      role: "CANDIDATE"
    };
    return [admin, candidate];
  }

  async function loadCandidateTests(candidateId) {
    const catalogSnapshot = await firestoreDb.collection(COLLECTIONS.TEST_CATALOG)
      .where("candidateId", "==", candidateId)
      .get();
    const catalogs = catalogSnapshot.docs.map((document) => stripCloudFields({ id: document.id, ...document.data(), questions: [] }));
    const tests = [];
    for (const catalog of catalogs) {
      if (!isTestLocked(catalog)) {
        try {
          const contentSnapshot = await firestoreDb.collection(COLLECTIONS.TEST_CONTENT).doc(catalog.id).get();
          if (contentSnapshot.exists) {
            tests.push(migrateData({ tests: [stripCloudFields({ id: contentSnapshot.id, ...contentSnapshot.data() })] }, false).tests[0]);
            continue;
          }
        } catch (error) {
          if (error?.code !== "permission-denied") console.warn("Unable to load assessment content", error);
        }
      }
      tests.push({ ...catalog, questions: [] });
    }
    return tests;
  }

  async function loadCloudWorkspace(profile) {
    if (!CLOUD_ENABLED || !firestoreDb || !profile) return;
    cloudProfile = profile;
    cloudAuthenticated = true;
    cloudCandidateAuthId = profile.role === "CANDIDATE" ? profile.id : (profile.linkedCandidateId || null);
    cloudAdminAuthId = profile.role === "ADMIN" ? profile.id : (profile.workspaceId || profile.linkedAdminId || null);

    const adminId = await getCloudAdminAuthId();
    const candidateId = await getCloudCandidateAuthId();
    if (!adminId || !candidateId) throw new Error("The two Firebase accounts are not linked to the same workspace.");

    const [workspaceSnapshot, adminProfileSnapshot, candidateProfileSnapshot] = await Promise.all([
      firestoreDb.collection(COLLECTIONS.WORKSPACES).doc(adminId).get(),
      firestoreDb.collection(COLLECTIONS.USERS).doc(adminId).get(),
      firestoreDb.collection(COLLECTIONS.USERS).doc(candidateId).get()
    ]);
    const workspace = workspaceSnapshot.exists ? workspaceSnapshot.data() : {};
    const adminProfile = adminProfileSnapshot.exists ? { id: adminProfileSnapshot.id, ...adminProfileSnapshot.data() } : null;
    const candidateProfile = candidateProfileSnapshot.exists ? { id: candidateProfileSnapshot.id, ...candidateProfileSnapshot.data() } : null;
    const users = logicalUsersFromCloud(adminProfile, candidateProfile, workspace);
    const branding = {
      palette: workspace.palette || "aurora",
      logoPath: workspace.logoPath || "assets/branding/app-logo.png"
    };

    if (profile.role === "ADMIN") {
      const [testsSnapshot, attemptsSnapshot, reviewsSnapshot, resultsSnapshot] = await Promise.all([
        firestoreDb.collection(COLLECTIONS.PRIVATE_TESTS).where("adminId", "==", adminId).get(),
        firestoreDb.collection(COLLECTIONS.ATTEMPTS).where("adminId", "==", adminId).get(),
        firestoreDb.collection(COLLECTIONS.REVIEWS).where("adminId", "==", adminId).get(),
        firestoreDb.collection(COLLECTIONS.RESULTS).where("adminId", "==", adminId).get()
      ]);
      const tests = testsSnapshot.docs.map((document) => stripCloudFields({ id: document.id, ...document.data() }));
      const reviews = new Map(reviewsSnapshot.docs.map((document) => [document.id, document.data()]));
      const results = new Map(resultsSnapshot.docs.map((document) => [document.id, document.data()]));
      const attempts = attemptsSnapshot.docs.map((document) => {
        const attempt = stripCloudFields({ id: document.id, ...document.data() });
        const review = reviews.get(document.id);
        if (review) {
          attempt.review = deepClone(review.review || {});
          attempt.finalScore = review.finalScore ? deepClone(review.finalScore) : null;
          attempt.reviewedAt = review.reviewedAt || null;
          attempt.publishedAt = review.publishedAt || null;
          attempt.status = review.status || attempt.status;
        }
        const result = results.get(document.id);
        if (result?.attempt) return deepClone(result.attempt);
        return attempt;
      });
      data = migrateData({
        version: SCHEMA_VERSION,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        users,
        branding,
        tests,
        attempts,
        activity: []
      }, false);
    } else {
      const [tests, attemptsSnapshot, resultsSnapshot] = await Promise.all([
        loadCandidateTests(candidateId),
        firestoreDb.collection(COLLECTIONS.ATTEMPTS).where("candidateId", "==", candidateId).get(),
        firestoreDb.collection(COLLECTIONS.RESULTS).where("candidateId", "==", candidateId).get()
      ]);
      const attempts = attemptsSnapshot.docs.map((document) => stripCloudFields({ id: document.id, ...document.data() }));
      const resultBundles = resultsSnapshot.docs.map((document) => document.data());
      const testMap = new Map(tests.map((test) => [test.id, test]));
      const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]));
      resultBundles.forEach((bundle) => {
        if (bundle?.testSnapshot) testMap.set(bundle.testSnapshot.id, deepClone(bundle.testSnapshot));
        if (bundle?.attempt) attemptMap.set(bundle.attempt.id, deepClone(bundle.attempt));
      });
      data = migrateData({
        version: SCHEMA_VERSION,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        users,
        branding,
        tests: [...testMap.values()],
        attempts: [...attemptMap.values()],
        activity: []
      }, false);
    }

    clearCloudWorkspaceCaches();
    applyPalette();
    primeCloudCache();
  }

  function stopCloudSubscriptions() {
    cloudUnsubscribers.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (_) { /* no-op */ }
    });
    cloudUnsubscribers = [];
    clearTimeout(cloudRefreshHandle);
  }

  function queueCloudRefresh(message) {
    clearTimeout(cloudRefreshHandle);
    cloudRefreshHandle = setTimeout(async () => {
      if (!isCloudMode() || !cloudProfile || route === "test_runner" || route === "review" || builderDraft) return;
      try {
        await loadCloudWorkspace(cloudProfile);
        currentUser = data.users.find((user) => user.role === cloudProfile.role) || currentUser;
        render();
        if (message) toast(message);
      } catch (error) {
        console.warn("Realtime Firebase refresh failed", error);
      }
    }, 650);
  }

  function subscribeCloudUpdates() {
    stopCloudSubscriptions();
    if (!isCloudMode()) return;
    let initialSnapshots = 0;
    const ignoreInitial = () => {
      initialSnapshots += 1;
      return initialSnapshots <= 2;
    };
    if (cloudProfile.role === "ADMIN") {
      const unsubscribe = firestoreDb.collection(COLLECTIONS.ATTEMPTS)
        .where("adminId", "==", cloudAdminAuthId)
        .onSnapshot(() => {
          if (ignoreInitial()) return;
          queueCloudRefresh("Aaki's latest assessment activity is available.");
        }, (error) => console.warn("Attempt listener failed", error));
      cloudUnsubscribers.push(unsubscribe);
    } else {
      const testUnsubscribe = firestoreDb.collection(COLLECTIONS.TEST_CATALOG)
        .where("candidateId", "==", cloudCandidateAuthId)
        .onSnapshot(() => {
          if (ignoreInitial()) return;
          queueCloudRefresh("Assessment list updated.");
        }, (error) => console.warn("Assessment listener failed", error));
      const resultUnsubscribe = firestoreDb.collection(COLLECTIONS.RESULTS)
        .where("candidateId", "==", cloudCandidateAuthId)
        .onSnapshot(() => {
          if (ignoreInitial()) return;
          queueCloudRefresh("A new or updated result is available.");
        }, (error) => console.warn("Result listener failed", error));
      cloudUnsubscribers.push(testUnsubscribe, resultUnsubscribe);
    }
  }

  async function refreshCloudData(options = {}) {
    if (!isCloudMode() || !cloudProfile) {
      toast("Firebase is not configured", "Complete the Firebase setup to use the same data across devices.");
      return;
    }
    try {
      await loadCloudWorkspace(cloudProfile);
      currentUser = data.users.find((user) => user.role === cloudProfile.role) || currentUser;
      render();
      if (!options.silent) toast("Workspace refreshed", "Latest tests, submissions, and results loaded from Firebase.");
    } catch (error) {
      console.error(error);
      toast("Unable to refresh", error.message || "Firebase data could not be loaded.");
    }
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function derivePasswordHash(password, saltValue = null) {
    const salt = saltValue ? base64ToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16));
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      material,
      256
    );
    return { passwordHash: bytesToBase64(new Uint8Array(bits)), passwordSalt: bytesToBase64(salt) };
  }

  async function verifyPassword(user, password) {
    if (user.passwordHash && user.passwordSalt) {
      const derived = await derivePasswordHash(password, user.passwordSalt);
      return derived.passwordHash === user.passwordHash;
    }
    return typeof user.password === "string" && user.password === password;
  }

  function addActivity(type, text) {
    data.activity = data.activity || [];
    data.activity.unshift({ id: uid("act"), type, text, at: nowIso() });
    data.activity = data.activity.slice(0, 30);
  }

  function toast(title, message = "") {
    const element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
    toastRoot.appendChild(element);
    window.setTimeout(() => element.remove(), 3600);
  }

  function clearTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function applyTheme(theme = currentTheme()) {
    const next = ALLOWED_THEMES.includes(theme) ? theme : "light";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", next === "dark" ? "#12101b" : "#6d3bf2");
    applyPalette();
  }

  function applyUserAppearance() {
    const preferences = appearancePreferences();
    applyTheme(preferences.theme);
    applyPalette(preferences.palette);
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    saveAppearancePreferences({ theme: next });
    applyTheme(next);
    render();
  }

  async function waitForFirebaseUser() {
    if (!firebaseAuth) return null;
    await firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    return new Promise((resolve, reject) => {
      const unsubscribe = firebaseAuth.onAuthStateChanged((user) => {
        unsubscribe();
        resolve(user || null);
      }, (error) => {
        unsubscribe();
        reject(error);
      });
    });
  }

  async function restoreSession() {
    try {
      if (!CLOUD_ENABLED || !firebaseAuth || !firestoreDb) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(LEGACY_SESSION_KEY);
        return;
      }
      const authUser = await waitForFirebaseUser();
      if (!authUser) return;
      const profile = await loadUserProfile(authUser);
      await loadCloudWorkspace(profile);
      currentUser = data.users.find((user) => user.role === profile.role) || null;
      if (!currentUser) throw new Error("Account profile is incomplete.");
      applyUserAppearance();
      localStorage.setItem(SESSION_KEY, currentUser.id);
      route = "dashboard";
      subscribeCloudUpdates();
    } catch (error) {
      console.warn("Unable to restore Firebase session", error);
      currentUser = null;
      cloudAuthenticated = false;
      stopCloudSubscriptions();
      if (firebaseAuth?.currentUser) await firebaseAuth.signOut().catch(() => {});
    }
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const username = String(form.get("username") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const submitButton = event.submitter || event.target.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Signing in…";
    }

    try {
      if (!CLOUD_ENABLED || !firebaseAuth || !firestoreDb) throw new Error("Firebase configuration required");
      const email = CLOUD_EMAILS[username];
      if (!email) throw new Error("Invalid login");
      await firebaseAuth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
      const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
      const profile = await loadUserProfile(credential.user);
      await loadCloudWorkspace(profile);
      currentUser = data.users.find((user) => user.role === profile.role) || null;
      if (!currentUser) throw new Error("Account profile is incomplete.");
      applyUserAppearance();

      localStorage.setItem(SESSION_KEY, currentUser.id);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      route = "dashboard";
      routeParams = {};
      subscribeCloudUpdates();
      toast(`Welcome, ${currentUser.name}`);
      render();
    } catch (error) {
      console.warn("Login failed", error);
      toast("Login failed", CLOUD_ENABLED ? "The username or password is incorrect." : "Add your Firebase web configuration in config.js first.");
      if (firebaseAuth?.currentUser) await firebaseAuth.signOut().catch(() => {});
    } finally {
      if (submitButton && !currentUser) {
        submitButton.disabled = false;
        submitButton.textContent = "Sign in";
      }
    }
  }

  async function logout() {
    clearTimer();
    clearTimeout(cloudSaveHandle);
    stopCloudSubscriptions();
    if (firebaseAuth?.currentUser) await firebaseAuth.signOut().catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    currentUser = null;
    cloudProfile = null;
    cloudAuthenticated = false;
    cloudCandidateAuthId = null;
    cloudAdminAuthId = null;
    resetCloudCache();
    route = "login";
    routeParams = {};
    builderDraft = null;
    pendingConfirm = null;
    integrityDeparturePending = false;
    modalRoot.innerHTML = "";
    data = migrateData(createEmptyData(), false);
    applyUserAppearance();
    render();
  }

  function togglePassword() {
    const input = document.getElementById("login-password");
    const button = document.querySelector(".password-toggle");
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Show" : "Hide";
  }

  function go(nextRoute, params = {}) {
    if (currentUser) {
      const adminRoutes = new Set(["dashboard", "tests", "submissions", "progress", "settings", "review", "result_detail"]);
      const candidateRoutes = new Set(["dashboard", "assessments", "results", "progress", "settings", "assessment_details", "test_runner", "result_detail"]);
      const allowed = isAdmin() ? adminRoutes.has(nextRoute) : candidateRoutes.has(nextRoute);
      if (!allowed) {
        toast("Access denied", "Your account does not have permission to open that area.");
        nextRoute = "dashboard";
        params = {};
      }
    }
    clearTimer();
    route = nextRoute;
    routeParams = params;
    currentQuestionIndex = params.questionIndex || 0;
    sidebarOpen = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
  }

  function pageMeta() {
    const labels = {
      dashboard: ["Dashboard", currentUser?.role === "ADMIN" ? "Review the platform at a glance" : "Continue your developer journey"],
      tests: ["Assessments", "Create, publish, and manage developer tests"],
      submissions: ["Submissions", "Review answers and publish combined results"],
      progress: ["Progress", currentUser?.role === "ADMIN" ? "Track Aaki’s development over time" : "See how your skills are developing"],
      settings: ["Settings", "Appearance, account, and local data controls"],
      assessments: ["Assessments", "Available, active, and completed tests"],
      results: ["Results", "Published scores and detailed review notes"]
    };
    return labels[route] || ["Aaki's Developer Journey", "Learn. Build. Review. Grow."];
  }

  function navItems() {
    if (currentUser.role === "ADMIN") {
      return [
        ["dashboard", "Overview"],
        ["tests", "Assessments"],
        ["submissions", "Submissions"],
        ["progress", "Aaki’s Progress"],
        ["settings", "Settings"]
      ];
    }
    return [
      ["dashboard", "Overview"],
      ["assessments", "Assessments"],
      ["results", "Results"],
      ["progress", "My Progress"],
      ["settings", "Settings"]
    ];
  }

  function renderLayout(content) {
    const [title, subtitle] = pageMeta();
    const themeLabel = document.documentElement.dataset.theme === "dark" ? "Light" : "Dark";
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar ${sidebarOpen ? "open" : ""}">
          <div class="brand">${brandLogoMarkup("brand-logo")}<span>Aaki's Developer Journey</span></div>
          <nav class="sidebar-nav" aria-label="Primary navigation">
            ${navItems().map(([value, label]) => `
              <button class="nav-item ${route === value ? "active" : ""}" onclick="AakiJourney.go('${value}')">
                <span class="nav-dot"></span>${escapeHtml(label)}
              </button>
            `).join("")}
          </nav>
          <div class="sidebar-footer">
            <div class="user-mini">
              ${avatarMarkup(currentUser)}
              <div><strong>${escapeHtml(currentUser.name)}</strong><span>${escapeHtml(currentUser.title)}</span></div>
            </div>
            <button class="nav-item" onclick="AakiJourney.logout()"><span class="nav-dot"></span>Sign out</button>
          </div>
        </aside>
        <main class="main-shell">
          <header class="topbar">
            <div style="display:flex;align-items:center;gap:12px;min-width:0">
              <button class="icon-btn mobile-menu" aria-label="Open navigation" onclick="AakiJourney.toggleSidebar()">☰</button>
              <div class="topbar-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
            </div>
            <div class="topbar-actions">
              <span class="sync-pill ${isCloudMode() ? "is-cloud" : "is-local"}"><i></i>${cloudStatusLabel()}</span>
              ${isCloudMode() ? `<button class="btn btn-ghost btn-sm" onclick="AakiJourney.refreshCloudData()">Refresh</button>` : ""}
              <button class="btn btn-ghost btn-sm" onclick="AakiJourney.toggleTheme()">${themeLabel} mode</button>
              ${currentUser.role === "ADMIN" ? `<button class="btn btn-primary btn-sm" onclick="AakiJourney.openTestBuilder()">Create test</button>` : ""}
            </div>
          </header>
          ${content}
        </main>
      </div>
    `;
  }

  function renderLogin() {
    const cloudReady = CLOUD_ENABLED || !CLOUD_REQUIRED;
    app.innerHTML = `
      <section class="auth-shell">
        <div class="auth-visual">
          <div class="brand">${brandLogoMarkup("brand-logo")}<span>Aaki's Developer Journey</span></div>
          <div class="auth-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="auth-copy">
            <span class="auth-kicker">A private coding journey</span>
            <h1>Practice boldly.<br>Review thoughtfully.<br>Grow visibly.</h1>
            <p>Assessments, project previews, code execution, personal feedback, and progress connected securely to each account ID.</p>
            <div class="auth-feature-row"><span>Code challenges</span><span>Manual review</span><span>Progress stories</span></div>
          </div>
        </div>
        <div class="auth-panel">
          ${cloudReady ? `
            <form class="auth-card" onsubmit="AakiJourney.login(event)">
              <div class="auth-card-logo">${brandLogoMarkup("auth-card-logo-image")}</div>
              <h2>Welcome back</h2>
              <p>Sign in to your private journey workspace.</p>
              <div class="field">
                <label for="login-username">Username</label>
                <input id="login-username" name="username" type="text" autocomplete="username" placeholder="Enter username" required />
              </div>
              <div class="field">
                <label for="login-password">Password</label>
                <div class="password-wrap">
                  <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Enter password" required />
                  <button class="password-toggle" type="button" onclick="AakiJourney.togglePassword()">Show</button>
                </div>
              </div>
              <button class="btn btn-primary btn-block" type="submit">Enter journey</button>
              <div class="secure-signin"><span></span>Firebase ID based access</div>
            </form>
          ` : `
            <div class="auth-card cloud-setup-card">
              <div class="auth-card-logo">${brandLogoMarkup("auth-card-logo-image")}</div>
              <h2>Connect the cloud workspace</h2>
              <p>Add the Firebase web configuration in <code>config.js</code>, then create the two Auth users and Firestore role documents described in the README.</p>
            </div>
          `}
        </div>
      </section>
    `;
  }

  function renderAdminDashboard() {
    const candidate = data.users.find((user) => user.role === "CANDIDATE");
    const publishedTests = data.tests.filter((test) => test.status === "PUBLISHED");
    const pending = data.attempts.filter((attempt) => ["SUBMITTED", "UNDER_REVIEW", "REVIEWED"].includes(attempt.status));
    const publishedAttempts = data.attempts.filter((attempt) => attempt.status === "RESULT_PUBLISHED");
    const average = publishedAttempts.length
      ? Math.round(publishedAttempts.reduce((sum, attempt) => sum + (attempt.finalScore?.percentage || 0), 0) / publishedAttempts.length)
      : 0;
    const recentTests = [...data.tests].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 4);
    const recentActivity = (data.activity || []).slice(0, 5);

    renderLayout(`
      <div class="page">
        <div class="page-head">
          <div class="welcome-copy"><div class="welcome-avatar-wrap">${avatarMarkup(currentUser, "avatar avatar-xl")}</div><div><span class="eyebrow">Admin workspace</span><h1>Welcome, ${escapeHtml(currentUser.name)}.</h1><p>Create meaningful challenges, review ${escapeHtml(candidate?.name || "the candidate")}’s work, and turn every result into a clear next step.</p></div></div>
          <div class="page-actions"><button class="btn btn-primary" onclick="AakiJourney.openTestBuilder()">Create a new test</button></div>
        </div>
        <div class="grid grid-4">
          <article class="card metric-card" style="--metric-soft:var(--primary-soft)"><span class="metric-label">Published tests</span><strong class="metric-value">${publishedTests.length}</strong><span class="metric-note">Ready or assigned to Aaki</span></article>
          <article class="card metric-card" style="--metric-soft:var(--amber-soft)"><span class="metric-label">Waiting for review</span><strong class="metric-value">${pending.length}</strong><span class="metric-note">Submitted or draft reviewed</span></article>
          <article class="card metric-card" style="--metric-soft:var(--green-soft)"><span class="metric-label">Published results</span><strong class="metric-value">${publishedAttempts.length}</strong><span class="metric-note">Visible to Aaki</span></article>
          <article class="card metric-card" style="--metric-soft:var(--rose-soft)"><span class="metric-label">Average score</span><strong class="metric-value">${average}%</strong><span class="metric-note">Across published results</span></article>
        </div>

        <div class="grid grid-2" style="margin-top:20px">
          <section class="card section-card">
            <div class="section-head"><div><h3>Assessments</h3><p>Recently edited tests</p></div><button class="btn btn-ghost btn-sm" onclick="AakiJourney.go('tests')">Manage all</button></div>
            <div class="list">
              ${recentTests.map((test) => `
                <div class="list-row">
                  <div class="list-main"><strong>${escapeHtml(test.title)}</strong><span>${getTestQuestionCount(test)} questions · ${getTestTotal(test)} marks · ${escapeHtml(test.technology)}</span></div>
                  <div style="display:flex;align-items:center;gap:8px">${statusBadge(test.status)}<button class="btn btn-secondary btn-sm" onclick="AakiJourney.openTestBuilder('${test.id}')">Edit</button></div>
                </div>
              `).join("") || renderEmpty("No tests yet", "Create the first assessment to begin.")}
            </div>
          </section>

          <section class="card section-card">
            <div class="section-head"><div><h3>Review queue</h3><p>Submissions requiring attention</p></div><button class="btn btn-ghost btn-sm" onclick="AakiJourney.go('submissions')">Open queue</button></div>
            <div class="list">
              ${pending.length ? pending.slice(0, 4).map((attempt) => {
                const test = getTest(attempt.testId);
                return `<div class="list-row"><div class="list-main"><strong>${escapeHtml(test?.title || "Assessment")}</strong><span>${escapeHtml(candidate?.name || "Candidate")} · Submitted ${formatDate(attempt.submittedAt, true)}</span></div><div style="display:flex;align-items:center;gap:8px">${statusBadge(attempt.status)}<button class="btn btn-primary btn-sm" onclick="AakiJourney.openReview('${attempt.id}')">Review</button></div></div>`;
              }).join("") : renderEmpty("Review queue is clear", "New submissions will appear here.")}
            </div>
          </section>
        </div>

        <section class="card section-card" style="margin-top:20px">
          <div class="section-head"><div><h3>Recent activity</h3><p>Latest changes across the workspace</p></div></div>
          <div class="list">
            ${recentActivity.length ? recentActivity.map((activity) => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(activity.text)}</strong><span>${formatDate(activity.at, true)}</span></div><span class="badge badge-primary">${escapeHtml(activity.type)}</span></div>`).join("") : renderEmpty("No activity yet", "Creating the first assessment will start the workspace timeline.")}
          </div>
        </section>
      </div>
    `);
  }

  function renderCandidateDashboard() {
    const assigned = data.tests.filter((test) => test.status === "PUBLISHED" && test.assignedTo.includes(currentUser.id));
    const unattempted = assigned.filter((test) => !getAttempt(test.id));
    const available = unattempted.filter((test) => !isTestLocked(test));
    const scheduled = unattempted.filter((test) => isTestLocked(test)).sort((a, b) => new Date(a.opensAt) - new Date(b.opensAt));
    const inProgress = assigned.filter((test) => getAttempt(test.id)?.status === "IN_PROGRESS");
    const underReview = data.attempts.filter((attempt) => attempt.userId === currentUser.id && ["SUBMITTED", "UNDER_REVIEW", "REVIEWED"].includes(attempt.status));
    const results = data.attempts.filter((attempt) => attempt.userId === currentUser.id && attempt.status === "RESULT_PUBLISHED");
    const average = results.length ? Math.round(results.reduce((sum, attempt) => sum + attempt.finalScore.percentage, 0) / results.length) : 0;
    const latest = [...results].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
    const nextAssessment = inProgress[0] || available[0] || scheduled[0];

    renderLayout(`
      <div class="page">
        <div class="page-head">
          <div class="welcome-copy"><div class="welcome-avatar-wrap">${avatarMarkup(currentUser, "avatar avatar-xl")}</div><div><span class="eyebrow">Developer in progress</span><h1>Welcome back, ${escapeHtml(currentUser.name)}.</h1><p>Take one challenge at a time. Every submission becomes feedback, progress, and proof of growth.</p></div></div>
          <div class="page-actions"><button class="btn btn-primary" onclick="AakiJourney.go('assessments')">View assessments</button></div>
        </div>

        <div class="grid grid-5">
          <article class="card metric-card"><span class="metric-label">Ready to attempt</span><strong class="metric-value">${available.length}</strong><span class="metric-note">Unlocked assessments</span></article>
          <article class="card metric-card" style="--metric-soft:var(--blue-soft)"><span class="metric-label">Scheduled</span><strong class="metric-value">${scheduled.length}</strong><span class="metric-note">Locked until opening time</span></article>
          <article class="card metric-card" style="--metric-soft:var(--primary-soft)"><span class="metric-label">In progress</span><strong class="metric-value">${inProgress.length}</strong><span class="metric-note">Answers are autosaved</span></article>
          <article class="card metric-card" style="--metric-soft:var(--amber-soft)"><span class="metric-label">Under review</span><strong class="metric-value">${underReview.length}</strong><span class="metric-note">Results remain private</span></article>
          <article class="card metric-card" style="--metric-soft:var(--green-soft)"><span class="metric-label">Average result</span><strong class="metric-value">${average}%</strong><span class="metric-note">Published reviews only</span></article>
        </div>

        <div class="grid grid-2" style="margin-top:20px">
          <section class="card section-card">
            <div class="section-head"><div><h3>Continue learning</h3><p>Your next assessment</p></div></div>
            ${renderCandidateNextAssessment(nextAssessment)}
          </section>

          <section class="card section-card">
            <div class="section-head"><div><h3>Latest feedback</h3><p>Your most recently published review</p></div>${latest ? `<button class="btn btn-ghost btn-sm" onclick="AakiJourney.viewResult('${latest.id}')">Full result</button>` : ""}</div>
            ${latest ? renderLatestFeedback(latest) : renderEmpty("No published feedback yet", "Your detailed review will appear here after a result is published.")}
          </section>
        </div>

        <section class="card section-card" style="margin-top:20px">
          <div class="section-head"><div><h3>Progress snapshot</h3><p>Published results only</p></div><button class="btn btn-ghost btn-sm" onclick="AakiJourney.go('progress')">View progress</button></div>
          ${renderProgressBars(results)}
        </section>
      </div>
    `);
  }

  function renderCandidateNextAssessment(test) {
    if (!test) return renderEmpty("You are all caught up", "A new assessment will appear here when it is published.");
    const attempt = getAttempt(test.id);
    const locked = !attempt && isTestLocked(test);
    const button = attempt?.status === "IN_PROGRESS"
      ? `<button class="btn btn-primary" onclick="AakiJourney.continueAttempt('${attempt.id}')">Continue test</button>`
      : `<button class="btn ${locked ? "btn-ghost" : "btn-primary"}" onclick="AakiJourney.openAssessment('${test.id}')">${locked ? "View schedule & instructions" : "View instructions"}</button>`;
    return `
      <div class="test-card card" style="box-shadow:none">
        <div class="test-card-top"><div class="tech-mark">${escapeHtml(test.technology.slice(0, 4).toUpperCase())}</div>${attempt ? statusBadge(attempt.status) : (locked ? statusBadge("LOCKED") : difficultyBadge(test.difficulty))}</div>
        <h3>${escapeHtml(test.title)}</h3>
        <p>${escapeHtml(test.description)}</p>
        <div class="test-meta"><span class="badge">${getTestQuestionCount(test)} questions</span><span class="badge">${getTestTotal(test)} marks</span><span class="badge">${test.durationMinutes} minutes</span>${testScheduleBadge(test)}</div>
        <div class="test-card-actions">${button}</div>
      </div>
    `;
  }

  function renderLatestFeedback(attempt) {
    const test = getTest(attempt.testId);
    const review = attempt.review || {};
    return `
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px">
          <div><strong>${escapeHtml(test?.title || "Assessment")}</strong><p class="muted small" style="margin:5px 0 0">Published ${formatDate(attempt.publishedAt)}</p></div>
          <span class="badge badge-green">${attempt.finalScore.percentage}%</span>
        </div>
        <div class="progress"><span style="width:${attempt.finalScore.percentage}%"></span></div>
        <p class="muted" style="margin:16px 0 0;line-height:1.65">${escapeHtml(review.encouragement || review.overallNotes || "Review published.")}</p>
      </div>
    `;
  }

  function renderAdminTests() {
    const tests = [...data.tests].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><h1>Assessment library</h1><p>Create tests manually or import one assessment JSON file at a time. Existing assessments are never replaced by assessment imports.</p></div><div class="page-actions"><input id="assessment-json-import" type="file" accept="application/json,.json" hidden onchange="AakiJourney.importAssessmentJson(event)" /><button class="btn btn-ghost" onclick="AakiJourney.downloadAssessmentTemplate()">JSON template</button><button class="btn btn-secondary" onclick="document.getElementById('assessment-json-import').click()">Import assessment JSON</button><button class="btn btn-primary" onclick="AakiJourney.openTestBuilder()">Create assessment</button></div></div>
        ${tests.length ? `
          <div class="test-grid">
            ${tests.map((test) => {
              const attemptCount = data.attempts.filter((attempt) => attempt.testId === test.id).length;
              return `<article class="card test-card">
                <div class="test-card-top"><div class="tech-mark">${escapeHtml(test.technology.slice(0, 4).toUpperCase())}</div>${statusBadge(test.status)}</div>
                <h3>${escapeHtml(test.title)}</h3><p>${escapeHtml(test.description)}</p>
                <div class="test-meta">${difficultyBadge(test.difficulty)}<span class="badge">${getTestQuestionCount(test)} questions</span><span class="badge">${getTestTotal(test)} marks</span><span class="badge">${attemptCount} attempt${attemptCount === 1 ? "" : "s"}</span>${testScheduleBadge(test)}</div>
                <div class="test-card-actions">
                  <button class="btn btn-primary btn-sm" onclick="AakiJourney.openTestBuilder('${test.id}')">Edit</button>
                  <button class="btn btn-secondary btn-sm" onclick="AakiJourney.toggleTestStatus('${test.id}')">${test.status === "PUBLISHED" ? "Unpublish" : "Publish"}</button>
                  <button class="btn btn-ghost btn-sm" onclick="AakiJourney.duplicateTest('${test.id}')">Duplicate</button>
                  <button class="btn btn-danger btn-sm" onclick="AakiJourney.deleteTest('${test.id}')">Delete</button>
                </div>
              </article>`;
            }).join("")}
          </div>
        ` : renderEmpty("No assessments created", "Create the first assessment and add MCQ or coding questions.", `<button class="btn btn-primary" onclick="AakiJourney.openTestBuilder()">Create assessment</button>`)}
      </div>
    `);
  }

  function renderSubmissions() {
    const attempts = [...data.attempts].sort((a, b) => new Date(b.submittedAt || b.startedAt) - new Date(a.submittedAt || a.startedAt));
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><h1>Submission review</h1><p>MCQ scoring is calculated internally. Coding marks and remarks remain entirely under your control.</p></div></div>
        ${attempts.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Assessment</th><th>Candidate</th><th>Submitted</th><th>Integrity</th><th>Status</th><th>Score</th><th>Action</th></tr></thead>
          <tbody>${attempts.map((attempt) => {
            const test = getTest(attempt.testId);
            const candidate = getUser(attempt.userId);
            const score = attempt.status === "RESULT_PUBLISHED" ? `${attempt.finalScore.obtained}/${attempt.finalScore.total}` : "Hidden";
            const tabSwitches = Number(attempt.tabSwitchCount) || 0;
            return `<tr><td><strong>${escapeHtml(test?.title || "Deleted assessment")}</strong><div class="muted small">${escapeHtml(test?.technology || "Unknown")}</div></td><td>${escapeHtml(candidate?.name || "Unknown")}</td><td>${formatDate(attempt.submittedAt || attempt.startedAt, true)}</td><td><span class="badge ${tabSwitches ? "badge-rose" : "badge-green"}">${tabSwitches} tab switch${tabSwitches === 1 ? "" : "es"}</span></td><td>${statusBadge(attempt.status)}</td><td>${score}</td><td><div class="table-actions"><button class="btn ${attempt.status === "RESULT_PUBLISHED" ? "btn-ghost" : "btn-primary"} btn-sm" onclick="AakiJourney.openReview('${attempt.id}')">${attempt.status === "RESULT_PUBLISHED" ? "View review" : "Review"}</button></div></td></tr>`;
          }).join("")}</tbody>
        </table></div>` : renderEmpty("No submissions yet", "Submitted tests will appear here for manual review.")}
      </div>
    `);
  }

  function renderCandidateAssessments() {
    const tests = data.tests.filter((test) => test.status === "PUBLISHED" && test.assignedTo.includes(currentUser.id));
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><h1>Your assessments</h1><p>MCQs lock after confirmation. Coding answers are reviewed manually, and every result is released only after the full review.</p></div></div>
        ${tests.length ? `<div class="test-grid">${tests.map((test) => renderCandidateTestCard(test)).join("")}</div>` : renderEmpty("No assessments available", "Published tests assigned to you will appear here.")}
      </div>
    `);
  }

  function renderCandidateTestCard(test) {
    const attempt = getAttempt(test.id);
    const locked = !attempt && isTestLocked(test);
    let button = `<button class="btn ${locked ? "btn-ghost" : "btn-primary"} btn-sm" onclick="AakiJourney.openAssessment('${test.id}')">${locked ? "View schedule" : "View instructions"}</button>`;
    let status = locked ? statusBadge("LOCKED") : `<span class="badge badge-primary">Available</span>`;
    if (attempt?.status === "IN_PROGRESS") {
      button = `<button class="btn btn-primary btn-sm" onclick="AakiJourney.continueAttempt('${attempt.id}')">Continue</button>`;
      status = statusBadge("IN_PROGRESS");
    } else if (["SUBMITTED", "UNDER_REVIEW", "REVIEWED"].includes(attempt?.status)) {
      button = `<button class="btn btn-ghost btn-sm" onclick="AakiJourney.showUnderReview('${attempt.id}')">View status</button>`;
      status = statusBadge(attempt.status);
    } else if (attempt?.status === "RESULT_PUBLISHED") {
      button = `<button class="btn btn-success btn-sm" onclick="AakiJourney.viewResult('${attempt.id}')">View result</button>`;
      status = statusBadge("RESULT_PUBLISHED");
    }
    return `<article class="card test-card">
      <div class="test-card-top"><div class="tech-mark">${escapeHtml(test.technology.slice(0, 4).toUpperCase())}</div>${status}</div>
      <h3>${escapeHtml(test.title)}</h3><p>${escapeHtml(test.description)}</p>
      <div class="test-meta">${difficultyBadge(test.difficulty)}<span class="badge">${getTestQuestionCount(test)} questions</span><span class="badge">${getTestTotal(test)} marks</span><span class="badge">${test.durationMinutes} min</span>${testScheduleBadge(test)}</div>
      <div class="test-card-actions">${button}</div>
    </article>`;
  }

  function renderCandidateResults() {
    const attempts = data.attempts
      .filter((attempt) => attempt.userId === currentUser.id && attempt.status === "RESULT_PUBLISHED")
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><h1>Published results</h1><p>Your MCQ score, coding marks, and review notes are always released together.</p></div></div>
        ${attempts.length ? `<div class="test-grid">${attempts.map((attempt) => {
          const test = getTest(attempt.testId);
          const passed = attempt.finalScore.percentage >= (test?.passPercentage || 0);
          return `<article class="card test-card">
            <div class="test-card-top"><div class="tech-mark">${escapeHtml((test?.technology || "DEV").slice(0, 4).toUpperCase())}</div><span class="badge ${passed ? "badge-green" : "badge-amber"}">${passed ? "Completed" : "Keep practising"}</span></div>
            <h3>${escapeHtml(test?.title || "Assessment")}</h3><p>Published ${formatDate(attempt.publishedAt)} · ${escapeHtml(test?.difficulty || "")}</p>
            <div class="result-score" style="color:var(--text);margin:16px 0"><strong style="font-size:2.7rem">${attempt.finalScore.percentage}%</strong><span style="color:var(--muted)">${attempt.finalScore.obtained}/${attempt.finalScore.total}</span></div>
            <div class="progress"><span style="width:${attempt.finalScore.percentage}%"></span></div>
            <div class="test-card-actions" style="margin-top:20px"><button class="btn btn-primary btn-sm" onclick="AakiJourney.viewResult('${attempt.id}')">Open detailed review</button></div>
          </article>`;
        }).join("")}</div>` : renderEmpty("No published results yet", "Results will appear after Aayush completes and publishes the full review.")}
      </div>
    `);
  }

  function renderProgressPage() {
    const candidate = currentUser.role === "CANDIDATE" ? currentUser : data.users.find((user) => user.role === "CANDIDATE");
    const attempts = data.attempts.filter((attempt) => attempt.userId === candidate.id && attempt.status === "RESULT_PUBLISHED");
    const average = attempts.length ? Math.round(attempts.reduce((sum, item) => sum + item.finalScore.percentage, 0) / attempts.length) : 0;
    const best = attempts.length ? Math.max(...attempts.map((item) => item.finalScore.percentage)) : 0;
    const totalMarks = attempts.reduce((sum, item) => sum + item.finalScore.obtained, 0);
    const technologyStats = {};
    attempts.forEach((attempt) => {
      const test = getTest(attempt.testId);
      if (!test) return;
      technologyStats[test.technology] = technologyStats[test.technology] || [];
      technologyStats[test.technology].push(attempt.finalScore.percentage);
    });
    const techRows = Object.entries(technologyStats).map(([technology, values]) => ({
      technology,
      average: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    }));

    renderLayout(`
      <div class="page">
        <div class="page-head"><div><h1>${currentUser.role === "ADMIN" ? "Aaki’s progress" : "Your progress"}</h1><p>Only published reviews contribute to progress metrics, keeping unfinished or private evaluations out of the record.</p></div></div>
        <div class="grid grid-4">
          <article class="card metric-card"><span class="metric-label">Completed tests</span><strong class="metric-value">${attempts.length}</strong><span class="metric-note">Published results</span></article>
          <article class="card metric-card" style="--metric-soft:var(--green-soft)"><span class="metric-label">Average</span><strong class="metric-value">${average}%</strong><span class="metric-note">Overall performance</span></article>
          <article class="card metric-card" style="--metric-soft:var(--rose-soft)"><span class="metric-label">Best result</span><strong class="metric-value">${best}%</strong><span class="metric-note">Highest published score</span></article>
          <article class="card metric-card" style="--metric-soft:var(--blue-soft)"><span class="metric-label">Marks earned</span><strong class="metric-value">${totalMarks}</strong><span class="metric-note">Across all reviews</span></article>
        </div>
        <div class="grid grid-2" style="margin-top:20px">
          <section class="card section-card"><div class="section-head"><div><h3>Technology performance</h3><p>Average percentage by subject</p></div></div>
            ${techRows.length ? `<div class="bar-chart">${techRows.map((row) => `<div class="bar-row"><strong>${escapeHtml(row.technology)}</strong><div class="bar-track"><div class="bar-fill" style="width:${row.average}%"></div></div><span>${row.average}%</span></div>`).join("")}</div>` : renderEmpty("No progress data", "Complete and publish an assessment to begin tracking performance.")}
          </section>
          <section class="card section-card"><div class="section-head"><div><h3>Recent development</h3><p>Result history</p></div></div>
            ${attempts.length ? `<div class="list">${[...attempts].sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt)).map((attempt) => { const test=getTest(attempt.testId); return `<div class="list-row"><div class="list-main"><strong>${escapeHtml(test?.title || "Assessment")}</strong><span>${formatDate(attempt.publishedAt)} · ${escapeHtml(test?.technology || "")}</span></div><span class="badge badge-primary">${attempt.finalScore.percentage}%</span></div>`; }).join("")}</div>` : renderEmpty("No result history", "Published results will create a visible learning timeline.")}
          </section>
        </div>
        <section class="card section-card" style="margin-top:20px"><div class="section-head"><div><h3>Achievement milestones</h3><p>Simple confidence-building markers</p></div></div>
          <div class="grid grid-3">
            ${achievementCard("First Review", "Complete one manually reviewed assessment.", attempts.length >= 1)}
            ${achievementCard("Consistent Learner", "Publish three assessment results.", attempts.length >= 3)}
            ${achievementCard("Strong Foundation", "Achieve 80% or more in one assessment.", best >= 80)}
          </div>
        </section>
      </div>
    `);
  }

  function achievementCard(title, description, earned) {
    return `<div class="answer-box ${earned ? "correct" : ""}"><span class="badge ${earned ? "badge-green" : ""}">${earned ? "Earned" : "Locked"}</span><h3 style="margin:14px 0 7px">${escapeHtml(title)}</h3><p class="muted small" style="margin:0;line-height:1.55">${escapeHtml(description)}</p></div>`;
  }

  function renderProgressBars(attempts) {
    if (!attempts.length) return renderEmpty("Progress begins with the first result", "Complete an assessment and wait for the review to be published.");
    const latest = [...attempts].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt)).slice(-5);
    return `<div class="bar-chart">${latest.map((attempt) => { const test=getTest(attempt.testId); return `<div class="bar-row"><strong>${escapeHtml(test?.technology || "Test")}</strong><div class="bar-track"><div class="bar-fill" style="width:${attempt.finalScore.percentage}%"></div></div><span>${attempt.finalScore.percentage}%</span></div>`; }).join("")}</div>`;
  }

  function renderSettings() {
    const isDark = document.documentElement.dataset.theme === "dark";
    const admin = data.users.find((user) => user.role === "ADMIN");
    const candidate = data.users.find((user) => user.role === "CANDIDATE");
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><span class="eyebrow">Personalise the journey</span><h1>Settings</h1><p>Account identity, profile pictures, colour energy, and secure cloud access.</p></div></div>
        <div class="grid grid-2">
          <section class="card section-card profile-summary-card">
            <div class="section-head"><div><h3>Signed-in profile</h3><p>Your account identity</p></div>${isAdmin() ? `<span class="badge badge-primary">Administrator</span>` : `<span class="badge badge-rose">Candidate</span>`}</div>
            <div class="profile-hero-mini">${avatarMarkup(currentUser, "avatar avatar-xxl")}<div><strong>${escapeHtml(currentUser.name)}</strong><span>@${escapeHtml(currentUser.username)}</span><p>${escapeHtml(currentUser.title)}</p></div></div>
          </section>
          <section class="card section-card">
            <div class="section-head"><div><h3>Display mode</h3><p>Choose the most comfortable contrast</p></div></div>
            <div class="appearance-choice"><div class="appearance-preview ${isDark ? "dark" : "light"}"><i></i><i></i><i></i></div><div><strong>${isDark ? "Dark mode" : "Light mode"}</strong><span>${isDark ? "Deep, focused surfaces" : "Bright, colourful surfaces"}</span></div><button class="btn btn-secondary" onclick="AakiJourney.toggleTheme()">Use ${isDark ? "light" : "dark"}</button></div>
          </section>
        </div>

        <section class="card section-card palette-studio" style="margin-top:20px">
          <div class="section-head"><div><h3>Your colour palette</h3><p>This preference belongs only to the signed in account on this device.</p></div><span class="badge badge-primary">${escapeHtml(currentPalette())}</span></div>
          <div class="palette-grid">
            ${[
              ["aurora", "Aurora Pop", "Violet, coral, cyan"],
              ["ocean", "Digital Ocean", "Blue, teal, electric lime"],
              ["sunset", "Code Sunset", "Magenta, orange, gold"],
              ["candy", "Candy Nebula", "Hot pink, violet, aqua"]
            ].map(([value, label, note]) => `<button class="palette-option ${currentPalette() === value ? "active" : ""}" onclick="AakiJourney.setPalette('${value}')"><span class="palette-swatch palette-${value}"><i></i><i></i><i></i></span><strong>${label}</strong><small>${note}</small></button>`).join("")}
          </div>
        </section>

        ${isAdmin() ? `
          <section class="card section-card profile-studio" style="margin-top:20px">
            <div class="section-head"><div><h3>Brand and profile image paths</h3><p>Place image files in the listed folders, then edit only these paths when you replace them.</p></div><span class="badge badge-green">Admin controlled</span></div>
            <div class="brand-path-editor">
              <div class="brand-path-preview">${brandLogoMarkup("brand-logo brand-logo-large")}</div>
              <div class="field"><label for="app-logo-path">Application logo path or URL</label><input id="app-logo-path" type="text" value="${escapeAttr(data.branding?.logoPath || "assets/branding/app-logo.png")}" placeholder="assets/branding/app-logo.png" /></div>
              <button class="btn btn-primary btn-sm" onclick="AakiJourney.updateLogoPath(document.getElementById('app-logo-path').value)">Save logo path</button>
            </div>
            <div class="profile-editor-grid">
              ${[admin, candidate].filter(Boolean).map((user) => `
                <article class="profile-editor-card">
                  ${avatarMarkup(user, "avatar avatar-profile-editor")}
                  <div class="profile-editor-copy"><span>${user.role === "ADMIN" ? "Administrator" : "Candidate"}</span><h3>${escapeHtml(user.name)}</h3><p>${escapeHtml(user.title)}</p></div>
                  <div class="field profile-path-field"><label for="profile-path-${escapeAttr(user.id)}">Image path or URL</label><input id="profile-path-${escapeAttr(user.id)}" type="text" value="${escapeAttr(user.avatarData || "")}" placeholder="${user.role === "ADMIN" ? "assets/profiles/aayush.jpg" : "assets/profiles/aaki.jpg"}" /></div>
                  <div class="profile-editor-actions">
                    <button class="btn btn-primary btn-sm" onclick="AakiJourney.updateProfilePath('${escapeAttr(user.id)}', document.getElementById('profile-path-${escapeAttr(user.id)}').value)">Save path</button>
                    <button class="btn btn-ghost btn-sm" onclick="AakiJourney.removeProfileImage('${escapeAttr(user.id)}')">Use initials</button>
                  </div>
                </article>
              `).join("")}
            </div>
            <div class="lock-note">No image is bundled in this project. Add your own files at <code>assets/branding/</code> and <code>assets/profiles/</code>, or paste a direct HTTPS image URL.</div>
          </section>


          <section class="card section-card persistence-card" style="margin-top:20px"><div class="section-head"><div><h3>Account-ID cloud workspace</h3><p>Aayush and Aaki each authenticate with a separate Firebase user ID</p></div><span class="badge ${isCloudMode() ? "badge-green" : "badge-amber"}">${cloudStatusLabel()}</span></div>
            <div class="persistence-grid">
              <div class="answer-box"><strong>Aayush ID</strong><p class="muted small">Owns the complete private workspace, test builder, reviews, branding, and backups.</p></div>
              <div class="answer-box"><strong>Aaki ID</strong><p class="muted small">Receives assigned test snapshots, owns her attempts, and reads published result snapshots.</p></div>
              <div class="answer-box"><strong>Browser privacy</strong><p class="muted small">Cloud-mode assessment data is not kept as a shared localStorage workspace. The browser retains only the Firebase sign-in session and temporary offline cache.</p></div>
            </div>
          </section>

          <section class="card section-card" style="margin-top:20px"><div class="section-head"><div><h3>Workspace protection</h3><p>Private backup controls</p></div><span class="badge badge-green">Schema v${SCHEMA_VERSION}</span></div>
            <div class="list">
              <div class="list-row"><div class="list-main"><strong>Export complete backup</strong><span>Download tests, attempts, reviews, images, profiles, and branding.</span></div><button class="btn btn-secondary" onclick="AakiJourney.exportData()">Export JSON</button></div>
              <div class="list-row"><div class="list-main"><strong>Restore entire workspace backup</strong><span>Replaces every assessment, attempt, review, and result. This is not used for importing a single assessment.</span></div><div><input id="workspace-import" type="file" accept="application/json,.json" hidden onchange="AakiJourney.importData(event)" /><button class="btn btn-danger" onclick="document.getElementById('workspace-import').click()">Choose workspace backup</button></div></div>
            </div>
          </section>
        ` : `
          <section class="card section-card" style="margin-top:20px"><div class="section-head"><div><h3>Your protected account</h3><p>Personal access without administrator controls</p></div><span class="badge badge-green">ID secured</span></div>
            <div class="profile-readonly-grid"><div class="answer-box"><strong>Your data</strong><p class="muted small">Your assigned tests, autosaved attempts, published results, and profile picture follow your Aaki account ID across devices.</p></div><div class="answer-box"><strong>Admin controls</strong><p class="muted small">Only Aayush can edit profile photos, tests, marks, reviews, and result publication. Your theme and colour palette remain your own.</p></div></div>
          </section>
        `}
      </div>
    `);
  }

  function updateProfilePath(userId, pathValue) {
    if (!requireAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    user.avatarData = String(pathValue || "").trim();
    data.branding.updatedAt = nowIso();
    addActivity("PROFILE", `${user.name}'s profile image path updated`);
    saveData();
    renderSettings();
    toast("Profile image path saved", `${user.name}'s image will update anywhere this path is reachable.`);
  }

  function updateLogoPath(pathValue) {
    if (!requireAdmin()) return;
    data.branding = data.branding && typeof data.branding === "object" ? data.branding : {};
    data.branding.logoPath = String(pathValue || "").trim();
    data.branding.updatedAt = nowIso();
    addActivity("BRANDING", "Application logo path updated");
    saveData();
    renderSettings();
    toast("Logo path saved");
  }

  function removeProfileImage(userId) {
    if (!requireAdmin()) return;
    const user = getUser(userId);
    if (!user) return;
    requestConfirm("Use initials instead?", `${user.name}'s photo path will be cleared.`, () => {
      user.avatarData = "";
      data.branding.updatedAt = nowIso();
      addActivity("PROFILE", `${user.name}'s profile image path cleared`);
      saveData();
      renderSettings();
      toast("Profile image cleared");
    }, { danger: false, confirmLabel: "Use initials" });
  }

  function setPalette(palette) {
    if (!currentUser || !ALLOWED_PALETTES.includes(palette)) return;
    saveAppearancePreferences({ palette });
    applyPalette(palette);
    renderSettings();
    toast("Colour palette updated", "This account now uses its own palette preference.");
  }

  async function ensureCandidateTestContent(testId) {
    const test = getTest(testId);
    if (!isCandidate() || !test || getTestQuestionCount(test) === (test.questions || []).length && (test.questions || []).length > 0) return test;
    if (isTestLocked(test) || !firestoreDb) return test;
    try {
      const snapshot = await firestoreDb.collection(COLLECTIONS.TEST_CONTENT).doc(testId).get();
      if (!snapshot.exists) return test;
      const fullTest = migrateData({ tests: [stripCloudFields({ id: snapshot.id, ...snapshot.data() })] }, false).tests[0];
      const index = data.tests.findIndex((item) => item.id === testId);
      if (index >= 0) data.tests[index] = fullTest;
      else data.tests.push(fullTest);
      return fullTest;
    } catch (error) {
      if (error?.code === "permission-denied") {
        toast("Assessment still locked", "Firebase has not reached the scheduled opening time yet.");
        return test;
      }
      console.warn("Unable to load assessment questions", error);
      toast("Questions unavailable", "Refresh and try again after the scheduled opening time.");
      return test;
    }
  }

  async function openAssessment(testId) {
    if (!requireCandidate()) return;
    let test = getTest(testId);
    if (!test || test.status !== "PUBLISHED" || !test.assignedTo.includes(currentUser.id)) {
      toast("Assessment unavailable", "This assessment is not assigned to your account.");
      return;
    }
    const attempt = getAttempt(testId);
    if (attempt?.status === "IN_PROGRESS") {
      continueAttempt(attempt.id);
      return;
    }
    if (["SUBMITTED", "UNDER_REVIEW", "REVIEWED"].includes(attempt?.status)) {
      showUnderReview(attempt.id);
      return;
    }
    if (attempt?.status === "RESULT_PUBLISHED") {
      viewResult(attempt.id);
      return;
    }
    if (!isTestLocked(test)) test = await ensureCandidateTestContent(testId);
    if (!isTestLocked(test) && !(test.questions || []).length) {
      toast("Assessment content unavailable", "Refresh the page and try again.");
      return;
    }
    go("assessment_details", { testId });
  }

  function renderAssessmentDetails(testId) {
    const test = getTest(testId);
    if (!isCandidate() || !test || test.status !== "PUBLISHED" || !test.assignedTo.includes(currentUser.id)) return go("assessments");
    const mcqCount = getTestMcqCount(test);
    const codeCount = getTestCodeCount(test);
    const locked = isTestLocked(test);
    app.innerHTML = `
      <div class="focus-shell">
        <header class="focus-topbar"><div class="brand" style="color:var(--text)">${brandLogoMarkup("brand-logo")}<span>Aaki's Developer Journey</span></div><button class="btn btn-ghost" onclick="AakiJourney.go('assessments')">Back to assessments</button></header>
        <main class="page" style="max-width:1040px;padding-top:48px">
          <section class="card card-pad assessment-instructions-card" style="padding:32px">
            <div class="test-card-top"><div class="tech-mark">${escapeHtml(test.technology.slice(0,4).toUpperCase())}</div>${locked ? statusBadge("LOCKED") : difficultyBadge(test.difficulty)}</div>
            <h1 style="font-size:clamp(2rem,4vw,3.3rem);margin-bottom:12px">${escapeHtml(test.title)}</h1>
            <p class="muted" style="font-size:1rem;line-height:1.7">${escapeHtml(test.description)}</p>
            <div class="grid grid-4" style="margin:26px 0">
              <div class="answer-box"><strong>${getTestQuestionCount(test)}</strong><span class="muted small" style="display:block;margin-top:5px">Questions</span></div>
              <div class="answer-box"><strong>${getTestTotal(test)}</strong><span class="muted small" style="display:block;margin-top:5px">Total marks</span></div>
              <div class="answer-box"><strong>${test.durationMinutes} min</strong><span class="muted small" style="display:block;margin-top:5px">Duration</span></div>
              <div class="answer-box"><strong>${test.opensAt ? formatDate(test.opensAt, true) : "Immediately"}</strong><span class="muted small" style="display:block;margin-top:5px">Opening time</span></div>
            </div>
            <div class="grid grid-2">
              <div class="answer-box"><span class="badge badge-primary">${mcqCount} MCQ</span><h3 style="margin:12px 0 6px">One confirmed attempt</h3><p class="muted small" style="margin:0;line-height:1.6">An MCQ can be changed until you confirm it. Once confirmed, it locks permanently.</p></div>
              <div class="answer-box"><span class="badge badge-rose">${codeCount} coding</span><h3 style="margin:12px 0 6px">Manual review</h3><p class="muted small" style="margin:0;line-height:1.6">Code is saved automatically and checked personally by the administrator.</p></div>
            </div>
            <div class="answer-box" style="margin-top:18px"><h3>Assessment instructions</h3><p class="muted" style="white-space:pre-wrap;line-height:1.7;margin:0">${escapeHtml(test.instructions)}</p></div>
            <section class="integrity-instructions">
              <div class="section-head"><div><h3>Test integrity instructions</h3><p>Read these rules before starting</p></div><span class="badge badge-rose">Tab activity recorded</span></div>
              <div class="instruction-list">
                <div><strong>Stay on the assessment tab.</strong><span>Switching tabs, minimising the browser, or moving to another app makes the page hidden and records a timestamped integrity event.</span></div>
                <div><strong>The timer continues outside the tab.</strong><span>Leaving, refreshing, or returning later does not pause or restart the assessment timer.</span></div>
                <div><strong>Every departure is visible to the reviewer.</strong><span>The administrator sees the total tab-switch count, time, and question open at that moment.</span></div>
                <div><strong>Submit only when finished.</strong><span>After final submission, answers cannot be reopened and results stay hidden until the full review is published.</span></div>
              </div>
            </section>
            <div class="lock-note">Your MCQ result and coding result remain hidden until the complete review and remarks are published.</div>
            ${locked ? `
              <div class="scheduled-lock-panel"><span class="scheduled-lock-icon">⌛</span><div><strong>This assessment is scheduled.</strong><p>It will unlock automatically on ${escapeHtml(formatDate(test.opensAt, true))}, based on this device’s time zone.</p></div></div>
              <div style="display:flex;justify-content:flex-end;margin-top:24px"><button class="btn btn-ghost" disabled>Locked until opening time</button></div>
            ` : `
              <label class="integrity-ack"><input id="integrity-ack" type="checkbox" onchange="document.getElementById('start-assessment-btn').disabled=!this.checked" /><span><strong>I have read and understood the instructions.</strong><small>I understand that leaving this tab during the assessment will be recorded and shown to the administrator.</small></span></label>
              <div style="display:flex;justify-content:flex-end;margin-top:24px"><button id="start-assessment-btn" class="btn btn-primary" disabled onclick="AakiJourney.startAttempt('${test.id}')">Start assessment</button></div>
            `}
          </section>
        </main>
      </div>
    `;
  }

  async function startAttempt(testId) {
    if (!requireCandidate()) return;
    let test = getTest(testId);
    if (!test || test.status !== "PUBLISHED" || !test.assignedTo.includes(currentUser.id)) return;
    if (isTestLocked(test)) {
      toast("Assessment locked", `This test opens on ${formatDate(test.opensAt, true)}.`);
      renderAssessmentDetails(testId);
      return;
    }
    test = await ensureCandidateTestContent(testId);
    if (!(test?.questions || []).length) {
      toast("Assessment content unavailable", "Firebase has not released the questions yet.");
      return;
    }
    const acknowledgement = document.getElementById("integrity-ack");
    if (!acknowledgement?.checked) {
      toast("Read the instructions", "Confirm the integrity instructions before starting.");
      return;
    }
    const existing = getAttempt(testId);
    if (existing) {
      openAssessment(testId);
      return;
    }
    const responses = {};
    test.questions.forEach((question) => {
      if (question.type === "MCQ") {
        responses[question.id] = { selectedOptionId: null, locked: false };
      } else if (isWebPreviewQuestion(question)) {
        responses[question.id] = { code: "", files: getStarterFiles(question) };
      } else {
        responses[question.id] = { code: question.starterCode || "" };
      }
    });
    const startedAt = nowIso();
    const attempt = {
      id: uid("attempt"),
      testId,
      userId: currentUser.id,
      status: "IN_PROGRESS",
      startedAt,
      submittedAt: null,
      expiresAt: new Date(Date.now() + test.durationMinutes * 60000).toISOString(),
      remainingSeconds: test.durationMinutes * 60,
      lastSavedAt: startedAt,
      integrityAcknowledgedAt: startedAt,
      integrityEvents: [],
      tabSwitchCount: 0,
      responses,
      review: { questionReviews: {}, overallNotes: "", strengths: "", improvements: "", nextSteps: "", encouragement: "" }
    };
    data.attempts.push(attempt);
    addActivity("ATTEMPT", `${currentUser.name} started ${test.title}`);
    saveData();
    await syncCloudData();
    continueAttempt(attempt.id);
  }

  function continueAttempt(attemptId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS") return;
    go("test_runner", { attemptId });
  }

  function renderTestRunner(attemptId) {
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!isCandidate() || !attempt || !test || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS") {
      go("assessments");
      return;
    }
    if (!attempt.expiresAt) attempt.expiresAt = new Date(Date.now() + (Number(attempt.remainingSeconds) || 0) * 1000).toISOString();
    attempt.remainingSeconds = Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000));
    if (attempt.remainingSeconds <= 0) {
      submitAttempt(attempt.id, true);
      return;
    }
    currentQuestionIndex = clamp(currentQuestionIndex, 0, test.questions.length - 1);
    const question = test.questions[currentQuestionIndex];
    const response = attempt.responses[question.id];
    const answeredCount = test.questions.filter((item) => {
      const value = attempt.responses[item.id];
      return item.type === "MCQ" ? value?.locked : hasCodeResponse(item, value);
    }).length;

    app.innerHTML = `
      <div class="focus-shell">
        <header class="focus-topbar">
          <div class="focus-title"><strong>${escapeHtml(test.title)}</strong><span>${answeredCount}/${test.questions.length} answered · Autosaved ${formatDate(attempt.lastSavedAt, true)}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><div class="integrity-counter" title="Tab departures recorded during this attempt"><span>Tab switches</span><strong id="tab-switch-counter">${Number(attempt.tabSwitchCount) || 0}</strong></div><div id="timer-display" class="timer">${formatTimer(attempt.remainingSeconds)}</div><button class="btn btn-danger btn-sm" onclick="AakiJourney.requestSubmit('${attempt.id}')">Submit test</button></div>
        </header>
        <div class="runner-layout">
          <aside class="card question-palette">
            <div class="section-head"><div><h3>Questions</h3><p>${answeredCount} of ${test.questions.length} answered</p></div></div>
            <div class="progress"><span style="width:${Math.round((answeredCount/test.questions.length)*100)}%"></span></div>
            <div class="palette-grid">
              ${test.questions.map((item, index) => {
                const value = attempt.responses[item.id];
                const answered = item.type === "MCQ" ? value?.locked : hasCodeResponse(item, value);
                return `<button class="palette-btn ${index === currentQuestionIndex ? "current" : ""} ${answered ? "answered" : ""} ${value?.locked ? "locked" : ""}" onclick="AakiJourney.jumpQuestion(${index})">${index + 1}</button>`;
              }).join("")}
            </div>
            <div class="legend"><span><i style="background:var(--primary)"></i>Current</span><span><i style="background:var(--green-soft);border:1px solid var(--green)"></i>Answered</span><span><i></i>Not answered</span></div>
            <div class="lock-note" style="margin-top:18px">MCQ selections lock only after confirmation. Leaving or hiding this tab is recorded for the reviewer.</div>
          </aside>
          <main class="runner-main">
            <section class="card question-card">
              <div class="question-kicker"><div style="display:flex;gap:8px"><span class="badge badge-primary">Question ${currentQuestionIndex + 1}</span><span class="badge">${question.type === "MCQ" ? "MCQ" : escapeHtml(question.language || test.technology)}</span></div><span class="badge badge-rose">${question.marks} mark${question.marks === 1 ? "" : "s"}</span></div>
              <h2>${escapeHtml(question.prompt)}</h2>
              <p class="question-description">${escapeHtml(question.description || "")}</p>
              ${renderQuestionImage(question)}
              ${question.type === "MCQ" ? renderMcqQuestion(question, response) : renderCodeQuestion(question, response, attempt.id)}
            </section>
            <div class="runner-footer">
              <span class="autosave" id="autosave-label">Saved ${formatDate(attempt.lastSavedAt, true)}</span>
              <div class="runner-footer-group">
                <button class="btn btn-ghost" ${currentQuestionIndex === 0 ? "disabled" : ""} onclick="AakiJourney.previousQuestion()">Previous</button>
                <button class="btn btn-primary" ${currentQuestionIndex === test.questions.length - 1 ? "disabled" : ""} onclick="AakiJourney.nextQuestion()">Next</button>
              </div>
            </div>
          </main>
        </div>
      </div>
    `;

    setTimeout(() => {
      initializeCandidateCodeEditors(question);
      if (isWebPreviewQuestion(question)) updatePreview(question.id);
    }, 0);
    startTimer(attempt);
  }

  function renderMcqQuestion(question, response) {
    return `
      <div class="mcq-options">
        ${question.options.map((option) => `<label class="mcq-option ${response.selectedOptionId === option.id ? "selected" : ""} ${response.locked ? "disabled" : ""}">
          <input type="radio" name="mcq-option" value="${escapeAttr(option.id)}" ${response.selectedOptionId === option.id ? "checked" : ""} ${response.locked ? "disabled" : ""} onchange="AakiJourney.selectMcq('${question.id}','${option.id}')" />
          <span>${escapeHtml(option.text)}</span>
        </label>`).join("")}
      </div>
      ${response.locked
        ? `<div class="lock-note" style="color:var(--green);background:var(--green-soft)">Answer confirmed and locked. Correctness will be revealed only with the published result.</div>`
        : `<div class="lock-note">One attempt: check your choice carefully before confirming it.</div><div style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn btn-primary" ${!response.selectedOptionId ? "disabled" : ""} onclick="AakiJourney.confirmMcq('${question.id}')">Confirm and lock answer</button></div>`}
    `;
  }

  function renderCodeQuestion(question, response, attemptId) {
    const webPreview = isWebPreviewQuestion(question);
    if (webPreview) {
      const files = getResponseFiles(question, response);
      const activeFile = activeWebFileByQuestion[question.id]
        || (String(question.language || "").toUpperCase() === "CSS" ? "css" : String(question.language || "").toUpperCase() === "JAVASCRIPT" ? "javascript" : "html");
      activeWebFileByQuestion[question.id] = activeFile;
      return `
        <div class="code-workspace">
          <div class="editor-panel">
            <div class="panel-bar">
              <span>Web project editor</span>
              <div class="panel-actions">
                <button class="btn btn-secondary btn-sm" onclick="AakiJourney.openCodeEditorOverlay('${attemptId}','${question.id}')">Focus editor</button>
                <button class="btn btn-ghost btn-sm editor-reset-btn" onclick="AakiJourney.resetCode('${question.id}')">Reset starter</button>
              </div>
            </div>
            <div class="code-file-tabs" role="tablist" aria-label="Project files">
              ${WEB_FILE_KEYS.map((key) => `<button type="button" class="code-file-tab ${activeFile === key ? "active" : ""}" data-code-tab="${key}" onclick="AakiJourney.setWebFileTab('${question.id}','${key}')">${key === "html" ? "HTML" : key === "css" ? "CSS" : "JavaScript"}</button>`).join("")}
            </div>
            ${WEB_FILE_KEYS.map((key) => `<textarea id="code-editor-${key}" data-cm-context="candidate" data-question-id="${escapeAttr(question.id)}" data-file-key="${key}" data-language="${key}" data-code-file="${key}" class="code-editor code-editor-file" spellcheck="false">${escapeHtml(files[key] || "")}</textarea>`).join("")}
          </div>
          <div class="preview-panel">
            <div class="panel-bar">
              <span>Live project preview</span>
              <div class="panel-actions">
                <span class="badge">Sandboxed</span>
                <button class="btn btn-secondary btn-sm" onclick="AakiJourney.openPreviewOverlay('${attemptId}','${question.id}')">Focus preview</button>
              </div>
            </div>
            <iframe id="preview-frame" class="preview-frame" title="Live web project preview" sandbox="allow-scripts allow-forms allow-modals"></iframe>
          </div>
        </div>
        <div class="lock-note">HTML, CSS, and JavaScript are autosaved as separate project files. The focused preview stays inside this website and this test tab.</div>
      `;
    }

    return `
      <div class="code-workspace">
        <div class="editor-panel">
          <div class="panel-bar"><span>${escapeHtml(question.language || "Code")} editor</span><div class="panel-actions"><button class="btn btn-secondary btn-sm" onclick="AakiJourney.openCodeEditorOverlay('${attemptId}','${question.id}')">Focus editor</button><button class="btn btn-ghost btn-sm editor-reset-btn" onclick="AakiJourney.resetCode('${question.id}')">Reset starter</button></div></div>
          <textarea id="code-editor" data-cm-context="candidate" data-question-id="${escapeAttr(question.id)}" data-language="${escapeAttr(question.language || "Other")}" class="code-editor" spellcheck="false">${escapeHtml(response.code || "")}</textarea>
        </div>
        <div class="preview-panel test-case-panel">
          <div class="panel-bar"><span>${isTestCaseQuestion(question) ? "Test cases" : "Submission notes"}</span><div class="panel-actions">${renderHiddenCaseBadge(question)}${isTestCaseQuestion(question) ? `<button id="run-tests-${question.id}" class="btn btn-primary btn-sm" onclick="AakiJourney.runQuestionTests('${attemptId}','${question.id}',false)">▶ Run public tests</button>` : ""}</div></div>
          ${isTestCaseQuestion(question) ? renderCandidateTestCases(question, response) : `<div class="test-case-empty"><strong>Manual review question</strong><span>Write and submit the source code. No automated test cases are configured.</span></div>`}
        </div>
      </div>
      <div class="lock-note">Your source code is autosaved. Public tests can be run before submission; private tests remain hidden for admin review.</div>
    `;
  }

  function renderHiddenCaseBadge(question) {
    const hiddenCount = (question.testCases || []).filter((item) => item.visibility === "HIDDEN").length;
    return hiddenCount ? `<span class="badge">${hiddenCount} hidden</span>` : `<span class="badge">Public cases</span>`;
  }

  function renderCandidateTestCases(question, response = {}) {
    const publicCases = (question.testCases || []).filter((item) => item.visibility !== "HIDDEN");
    const results = response.testRunResults || {};
    if (!publicCases.length) {
      return `<div class="test-case-empty"><strong>No public test cases</strong><span>Follow the problem statement and submit your implementation.</span></div>`;
    }
    return `<div class="test-case-list">
      ${publicCases.map((item, index) => {
        const result = results[item.id];
        const state = result?.status || "NOT_RUN";
        const badge = state === "PASSED" ? "badge-green" : state === "FAILED" ? "badge-rose" : state === "RUNNING" ? "badge-blue" : "";
        const label = state === "PASSED" ? "Passed" : state === "FAILED" ? "Failed" : state === "RUNNING" ? "Running" : "Not run";
        return `<article class="test-case-card ${state === "PASSED" ? "case-passed" : state === "FAILED" ? "case-failed" : ""}">
          <div class="test-case-head"><strong>Public case ${index + 1}</strong><span class="badge ${badge}">${label}</span></div>
          <div class="test-case-grid">
            <div><span>Input</span><pre>${escapeHtml(item.input || "No input")}</pre></div>
            <div><span>Expected output</span><pre>${escapeHtml(item.expectedOutput || "No output specified")}</pre></div>
          </div>
          ${result ? `<div class="test-run-output"><span>Actual output</span><pre>${escapeHtml(result.actualOutput || result.error || "No output")}</pre>${result.runtimeStatus ? `<small>${escapeHtml(result.runtimeStatus)}</small>` : ""}</div>` : ""}
          ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
        </article>`;
      }).join("")}
    </div>`;
  }

  function judge0Headers() {
    const headers = { "Content-Type": "application/json" };
    if (APP_CONFIG.judge0AuthToken) headers["X-Auth-Token"] = APP_CONFIG.judge0AuthToken;
    return headers;
  }

  async function executeJudge0Case(language, sourceCode, input) {
    const languageId = JUDGE0_LANGUAGE_IDS[String(language || "").toUpperCase()];
    if (!languageId) throw new Error(`${language} execution is not configured.`);
    const baseUrl = String(APP_CONFIG.judge0Url || "https://ce.judge0.com").replace(/\/$/, "");
    const createResponse = await fetch(`${baseUrl}/submissions?base64_encoded=false&wait=false`, {
      method: "POST",
      headers: judge0Headers(),
      body: JSON.stringify({ language_id: languageId, source_code: sourceCode, stdin: input || "" })
    });
    if (!createResponse.ok) throw new Error(`Code runner returned ${createResponse.status}.`);
    const created = await createResponse.json();
    if (!created.token) throw new Error("The code runner did not return a submission token.");

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 550));
      const resultResponse = await fetch(`${baseUrl}/submissions/${created.token}?base64_encoded=false&fields=stdout,stderr,compile_output,message,status`, {
        headers: judge0Headers()
      });
      if (!resultResponse.ok) throw new Error(`Unable to read runner result (${resultResponse.status}).`);
      const result = await resultResponse.json();
      const statusId = Number(result.status?.id);
      if (![1, 2].includes(statusId)) {
        return {
          actualOutput: result.stdout || "",
          error: result.compile_output || result.stderr || result.message || "",
          runtimeStatus: result.status?.description || "Completed"
        };
      }
    }
    throw new Error("Code execution timed out while waiting for the runner.");
  }

  function formatSqlOutput(value) {
    const result = Array.isArray(value) && value.length === 1 ? value[0] : value;
    if (Array.isArray(result)) {
      if (result.length && result.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        const keys = Object.keys(result[0]);
        const lines = [keys.join(" | "), ...result.map((row) => keys.map((key) => row[key] ?? "NULL").join(" | "))];
        return lines.join("\n");
      }
      return result.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("\n");
    }
    if (result && typeof result === "object") return JSON.stringify(result, null, 2);
    return String(result ?? "");
  }

  async function executeSqlCase(sourceCode, setupSql) {
    if (!window.alasql?.Database) throw new Error("The SQL runner could not be loaded.");
    const database = new window.alasql.Database();
    if (String(setupSql || "").trim()) database.exec(setupSql);
    const result = database.exec(sourceCode);
    return { actualOutput: formatSqlOutput(result), error: "", runtimeStatus: "SQL completed" };
  }

  async function executeTestCase(question, sourceCode, testCase) {
    const execution = String(question.language || "").toUpperCase() === "SQL"
      ? await executeSqlCase(sourceCode, testCase.input)
      : await executeJudge0Case(question.language, sourceCode, testCase.input);
    const actual = normaliseOutput(execution.actualOutput);
    const expected = normaliseOutput(testCase.expectedOutput);
    const passed = !execution.error && actual === expected;
    return {
      status: passed ? "PASSED" : "FAILED",
      actualOutput: execution.actualOutput || "",
      error: execution.error || "",
      runtimeStatus: execution.runtimeStatus || "Completed",
      ranAt: nowIso()
    };
  }

  async function runQuestionTests(attemptId, questionId, includePrivate = false) {
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    const question = test?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || !ownsAttempt(attempt) || !isTestCaseQuestion(question)) return;
    if (isCandidate() && (attempt.status !== "IN_PROGRESS" || includePrivate)) return;
    const response = attempt.responses?.[questionId] || {};
    const sourceCode = String(response.code || "");
    if (!sourceCode.trim()) {
      toast("Write code first", "The test runner needs source code to execute.");
      return;
    }
    const cases = (question.testCases || []).filter((item) => includePrivate || item.visibility !== "HIDDEN");
    if (!cases.length) {
      toast("No test cases", includePrivate ? "No cases are configured for this question." : "No public cases are available.");
      return;
    }

    const stateKey = `${attemptId}:${questionId}:${includePrivate ? "all" : "public"}`;
    if (testRunState[stateKey]) return;
    testRunState[stateKey] = true;
    const button = document.getElementById(includePrivate ? `review-run-tests-${question.id}` : `run-tests-${question.id}`);
    if (button) {
      button.disabled = true;
      button.textContent = "Running…";
    }

    try {
      if (isAdmin()) {
        attempt.review = attempt.review || { questionReviews: {} };
        attempt.review.questionReviews = attempt.review.questionReviews || {};
        const review = attempt.review.questionReviews[questionId] = attempt.review.questionReviews[questionId] || {};
        review.testCaseResults = review.testCaseResults || {};
        for (const item of cases) {
          review.testCaseResults[item.id] = { ...(review.testCaseResults[item.id] || {}), status: "RUNNING" };
          try {
            review.testCaseResults[item.id] = await executeTestCase(question, sourceCode, item);
          } catch (error) {
            review.testCaseResults[item.id] = { status: "FAILED", actualOutput: "", error: error.message || String(error), runtimeStatus: "Runner error", ranAt: nowIso() };
          }
        }
      } else {
        response.testRunResults = response.testRunResults || {};
        for (const item of cases) {
          response.testRunResults[item.id] = { status: "RUNNING" };
          try {
            response.testRunResults[item.id] = await executeTestCase(question, sourceCode, item);
          } catch (error) {
            response.testRunResults[item.id] = { status: "FAILED", actualOutput: "", error: error.message || String(error), runtimeStatus: "Runner error", ranAt: nowIso() };
          }
        }
        attempt.responses[questionId] = response;
        attempt.lastSavedAt = nowIso();
      }
      saveData();
      toast("Test run complete", `${cases.filter((item) => {
        const result = isAdmin()
          ? attempt.review?.questionReviews?.[questionId]?.testCaseResults?.[item.id]
          : response.testRunResults?.[item.id];
        return result?.status === "PASSED";
      }).length}/${cases.length} test cases passed.`);
      render();
    } finally {
      delete testRunState[stateKey];
    }
  }

  function formatTimer(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function startTimer(attempt) {
    clearTimer();
    timerHandle = setInterval(() => {
      const expiresAt = new Date(attempt.expiresAt).getTime();
      attempt.remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      const display = document.getElementById("timer-display");
      if (display) {
        display.textContent = formatTimer(attempt.remainingSeconds);
        display.classList.toggle("warning", attempt.remainingSeconds <= 300);
      }
      if (attempt.remainingSeconds % 10 === 0) saveData();
      if (attempt.remainingSeconds <= 0) {
        clearTimer();
        submitAttempt(attempt.id, true);
      }
    }, 1000);
  }

  function jumpQuestion(index) {
    if (!requireCandidate()) return;
    currentQuestionIndex = index;
    render();
  }

  function previousQuestion() {
    if (!requireCandidate()) return;
    currentQuestionIndex = Math.max(0, currentQuestionIndex - 1);
    render();
  }

  function nextQuestion() {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    const test = getTest(attempt?.testId);
    currentQuestionIndex = Math.min((test?.questions.length || 1) - 1, currentQuestionIndex + 1);
    render();
  }

  function selectMcq(questionId, optionId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    const response = attempt?.responses?.[questionId];
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS" || !response || response.locked) return;
    response.selectedOptionId = optionId;
    attempt.lastSavedAt = nowIso();
    saveData();
    render();
  }

  function confirmMcq(questionId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    const response = attempt?.responses?.[questionId];
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS" || !response?.selectedOptionId || response.locked) return;
    requestConfirm(
      "Lock this MCQ answer?",
      "After confirmation, this answer cannot be changed. Correctness will remain hidden until the full result is published.",
      () => {
        response.locked = true;
        attempt.lastSavedAt = nowIso();
        saveData();
        closeModal();
        toast("Answer locked", "This MCQ is now final.");
        render();
      }
    );
  }

  let codeSaveDebounce = null;
  function updateCode(questionId, value, fileKey = null) {
    if (!isCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS") return;
    const question = getTest(attempt.testId)?.questions.find((item) => item.id === questionId);
    if (!question) return;

    attempt.responses[questionId] = attempt.responses[questionId] || {};
    if (isWebPreviewQuestion(question)) {
      const files = getResponseFiles(question, attempt.responses[questionId]);
      const targetFile = WEB_FILE_KEYS.includes(fileKey) ? fileKey : "html";
      files[targetFile] = value;
      attempt.responses[questionId].files = files;
      attempt.responses[questionId].code = "";
      updatePreview(questionId);
    } else {
      attempt.responses[questionId].code = value;
    }

    attempt.lastSavedAt = nowIso();
    const label = document.getElementById("autosave-label");
    if (label) label.textContent = "Saving…";
    clearTimeout(codeSaveDebounce);
    codeSaveDebounce = setTimeout(() => {
      saveData();
      const currentLabel = document.getElementById("autosave-label");
      if (currentLabel) currentLabel.textContent = `Saved ${formatDate(attempt.lastSavedAt, true)}`;
    }, 350);
  }

  function setWebFileTab(questionId, fileKey) {
    if (!WEB_FILE_KEYS.includes(fileKey)) return;
    activeWebFileByQuestion[questionId] = fileKey;
    document.querySelectorAll("[data-code-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.codeTab === fileKey);
    });
    document.querySelectorAll("[data-code-file]").forEach((textarea) => {
      const active = textarea.dataset.codeFile === fileKey;
      const instance = codeMirrorInstances.get(textarea);
      const wrapper = instance?.getWrapperElement();
      if (wrapper) {
        wrapper.classList.toggle("is-hidden", !active);
        if (active) {
          requestAnimationFrame(() => {
            instance.refresh();
            instance.focus();
          });
        }
      } else {
        textarea.classList.toggle("is-hidden", !active);
        if (active) textarea.focus();
      }
    });
  }

  function updatePreview(questionId, frameId = "preview-frame") {
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    const question = getTest(attempt?.testId)?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || !isWebPreviewQuestion(question)) return;
    const frame = document.getElementById(frameId);
    renderWebPreview(frame, getResponseFiles(question, attempt.responses?.[question.id] || {}));
  }

  function resetCode(questionId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    const test = getTest(attempt?.testId);
    const question = test?.questions.find((item) => item.id === questionId);
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS" || !question) return;
    requestConfirm("Reset this answer?", "Your current work will be replaced with the original starter code.", () => {
      attempt.responses[questionId] = isWebPreviewQuestion(question)
        ? { code: "", files: getStarterFiles(question) }
        : { code: question.starterCode || "" };
      attempt.lastSavedAt = nowIso();
      saveData();
      closeModal();
      render();
    });
  }

  function setFocusCodeFileTab(questionId, fileKey) {
    if (!WEB_FILE_KEYS.includes(fileKey)) return;
    activeWebFileByQuestion[questionId] = fileKey;
    modalRoot.querySelectorAll("[data-focus-code-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.focusCodeTab === fileKey);
    });
    modalRoot.querySelectorAll("[data-focus-code-file]").forEach((textarea) => {
      const active = textarea.dataset.focusCodeFile === fileKey;
      const instance = codeMirrorInstances.get(textarea);
      const wrapper = instance?.getWrapperElement();
      if (wrapper) {
        wrapper.classList.toggle("is-hidden", !active);
        if (active) {
          requestAnimationFrame(() => {
            instance.refresh();
            instance.focus();
          });
        }
      } else {
        textarea.classList.toggle("is-hidden", !active);
      }
    });
  }

  function openCodeEditorOverlay(attemptId, questionId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    const question = test?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS" || question.type !== "CODE") return;

    const response = attempt.responses?.[question.id] || {};
    const webPreview = isWebPreviewQuestion(question);
    const activeFile = activeWebFileByQuestion[question.id]
      || (String(question.language || "").toUpperCase() === "CSS" ? "css" : String(question.language || "").toUpperCase() === "JAVASCRIPT" ? "javascript" : "html");
    const files = webPreview ? getResponseFiles(question, response) : null;

    modalRoot.innerHTML = `
      <section class="code-focus-overlay" role="dialog" aria-modal="true" aria-label="Focused code editor">
        <header class="code-focus-bar">
          <div class="code-focus-heading">
            <strong>${escapeHtml(question.prompt || `${question.language || "Code"} editor`)}</strong>
            <span>${webPreview ? "HTML · CSS · JavaScript" : escapeHtml(question.language || "Source code")} · Changes autosave to this assessment</span>
          </div>
          <div class="code-focus-actions">
            <span class="badge badge-green">Autosave active</span>
            <button class="btn btn-primary" onclick="AakiJourney.closeModal()">Return to assessment</button>
          </div>
        </header>
        ${webPreview ? `
          <div class="code-focus-tabs" role="tablist" aria-label="Focused project files">
            ${WEB_FILE_KEYS.map((key) => `<button type="button" class="code-file-tab ${activeFile === key ? "active" : ""}" data-focus-code-tab="${key}" onclick="AakiJourney.setFocusCodeFileTab('${question.id}','${key}')">${key === "html" ? "HTML" : key === "css" ? "CSS" : "JavaScript"}</button>`).join("")}
          </div>
          <div class="code-focus-editor-stage">
            ${WEB_FILE_KEYS.map((key) => `<textarea data-cm-context="focus" data-focus-code-file="${key}" data-question-id="${escapeAttr(question.id)}" data-file-key="${key}" data-language="${key}" class="code-focus-textarea" spellcheck="false">${escapeHtml(files[key] || "")}</textarea>`).join("")}
          </div>
        ` : `
          <div class="code-focus-editor-stage code-focus-editor-stage-single">
            <textarea data-cm-context="focus" data-question-id="${escapeAttr(question.id)}" data-language="${escapeAttr(question.language || "Other")}" class="code-focus-textarea" spellcheck="false">${escapeHtml(response.code || "")}</textarea>
          </div>
        `}
      </section>
    `;

    requestAnimationFrame(() => {
      modalRoot.querySelectorAll('textarea[data-cm-context="focus"]').forEach((textarea) => {
        const fileKey = textarea.dataset.fileKey || null;
        createCodeEditor(textarea, {
          language: textarea.dataset.language || question.language,
          height: "100%",
          onChange: (value) => updateCode(question.id, value, fileKey)
        });
      });
      if (webPreview) setFocusCodeFileTab(question.id, activeFile);
      else {
        const textarea = modalRoot.querySelector('textarea[data-cm-context="focus"]');
        const editor = textarea ? codeMirrorInstances.get(textarea) : null;
        requestAnimationFrame(() => {
          editor?.refresh();
          editor?.focus();
        });
      }
    });
  }

  function openPreviewOverlay(attemptId, questionId) {
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    const question = test?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || !ownsAttempt(attempt) || !isWebPreviewQuestion(question)) return;

    const response = attempt.responses?.[question.id] || {};
    modalRoot.innerHTML = `
      <section class="preview-focus-overlay" role="dialog" aria-modal="true" aria-label="Focused project preview">
        <header class="preview-focus-bar">
          <div>
            <strong>${escapeHtml(question.prompt || "Project preview")}</strong>
            <span>HTML · CSS · JavaScript</span>
          </div>
          <button class="btn btn-primary" onclick="AakiJourney.closeModal()">Return to assessment</button>
        </header>
        <iframe id="preview-focus-frame" class="preview-focus-frame" title="Focused web project preview" sandbox="allow-scripts allow-forms allow-modals"></iframe>
      </section>
    `;
    renderWebPreview(document.getElementById("preview-focus-frame"), getResponseFiles(question, response));
  }

  function requestSubmit(attemptId) {
    if (!requireCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS" || !test) return;
    const unanswered = test.questions.filter((question) => {
      const response = attempt.responses[question.id];
      return question.type === "MCQ" ? !response?.locked : !hasCodeResponse(question, response);
    }).length;
    requestConfirm(
      "Submit the complete assessment?",
      unanswered ? `${unanswered} question${unanswered === 1 ? " is" : "s are"} not fully answered. Submission cannot be reopened.` : "All answers will be final and sent for manual review.",
      () => submitAttempt(attemptId, false)
    );
  }

  async function submitAttempt(attemptId, timedOut = false) {
    if (!isCandidate()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || attempt.userId !== currentUser.id || !test || attempt.status !== "IN_PROGRESS") return;
    clearTimer();
    attempt.status = "SUBMITTED";
    attempt.submittedAt = nowIso();
    attempt.lastSavedAt = nowIso();
    addActivity("SUBMISSION", `${currentUser.name} submitted ${test.title}${timedOut ? " when time ended" : ""}`);
    saveData();
    await syncCloudData();
    closeModal();
    showUnderReview(attempt.id, timedOut);
  }

  function showUnderReview(attemptId, timedOut = false) {
    if (!requireCandidate()) return;
    clearTimer();
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || attempt.userId !== currentUser.id || !test) return;
    app.innerHTML = `
      <div class="focus-shell">
        <header class="focus-topbar"><div class="brand" style="color:var(--text)">${brandLogoMarkup("brand-logo")}<span>Aaki's Developer Journey</span></div><button class="btn btn-ghost" onclick="AakiJourney.go('assessments')">Back to assessments</button></header>
        <main class="page" style="max-width:820px;padding-top:70px">
          <section class="card card-pad" style="padding:42px;text-align:center">
            <div class="empty-icon" style="width:72px;height:72px;margin:0 auto 20px;font-size:1.8rem">✓</div>
            <span class="badge badge-amber">${timedOut ? "Time completed" : "Submitted successfully"}</span>
            <h1 style="font-size:clamp(2rem,4vw,3rem);margin:18px 0 12px">Your work is under review.</h1>
            <p class="muted" style="max-width:620px;margin:0 auto;line-height:1.75">${escapeHtml(test.title)} has been submitted. ${escapeHtml(data.users.find((user) => user.role === "ADMIN")?.name || "The administrator")} will review the coding answers, award marks, and add detailed remarks. MCQ correctness and the complete result remain hidden until publication.</p>
            <div class="grid grid-3" style="margin:28px 0;text-align:left">
              <div class="answer-box"><strong>${test.questions.length}</strong><span class="muted small" style="display:block;margin-top:5px">Questions submitted</span></div>
              <div class="answer-box"><strong>${getTestTotal(test)}</strong><span class="muted small" style="display:block;margin-top:5px">Maximum marks</span></div>
              <div class="answer-box"><strong>${formatDate(attempt.submittedAt)}</strong><span class="muted small" style="display:block;margin-top:5px">Submission date</span></div>
            </div>
            <button class="btn btn-primary" onclick="AakiJourney.go('dashboard')">Return to dashboard</button>
          </section>
        </main>
      </div>
    `;
  }

  function openReview(attemptId) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    if (!attempt) return;
    if (attempt.status === "SUBMITTED") attempt.status = "UNDER_REVIEW";
    saveData();
    route = "review";
    routeParams = { attemptId };
    render();
  }

  function renderReview(attemptId) {
    if (!isAdmin()) return go("dashboard");
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    const candidate = getUser(attempt?.userId);
    if (!attempt || !test || !candidate) return go("submissions");
    const published = attempt.status === "RESULT_PUBLISHED";
    const readOnly = false;
    const score = calculateAttemptScore(test, attempt);
    const scoreAngle = Math.round((score.percentage / 100) * 360);

    renderLayout(`
      <div class="page">
        <div class="page-head"><div><button class="btn btn-ghost btn-sm" onclick="AakiJourney.go('submissions')" style="margin-bottom:14px">← Back to submissions</button><h1>${escapeHtml(test.title)}</h1><p>${escapeHtml(candidate.name)} · Submitted ${formatDate(attempt.submittedAt, true)} · ${escapeHtml(test.technology)}</p></div>${statusBadge(attempt.status)}</div>
        <div class="review-layout">
          <div>
            ${renderIntegrityReview(attempt, test)}
            ${test.questions.map((question, index) => renderReviewQuestion(question, index, attempt, readOnly)).join("")}
            <section class="card review-question">
              <div class="section-head"><div><h3>Overall remarks</h3><p>These notes appear on ${escapeHtml(candidate.name)}’s published result page.</p></div></div>
              ${reviewField("Overall review", "overallNotes", attempt.review?.overallNotes, "Summarise the complete attempt...", readOnly)}
              ${reviewField("Strongest areas", "strengths", attempt.review?.strengths, "What was done particularly well?", readOnly)}
              ${reviewField("Areas to improve", "improvements", attempt.review?.improvements, "Which concepts or habits need attention?", readOnly)}
              ${reviewField("Recommended next step", "nextSteps", attempt.review?.nextSteps, "What should she practise next?", readOnly)}
              ${reviewField("Encouragement note", "encouragement", attempt.review?.encouragement, "End with a specific, constructive confidence-building note.", readOnly)}
            </section>
          </div>
          <aside class="card review-sidebar">
            <div class="score-ring" style="--score-angle:${scoreAngle}deg"><div class="score-ring-content"><strong id="review-total-score">${score.obtained}/${score.total}</strong><span id="review-percentage">${score.percentage}%</span></div></div>
            <div class="review-summary-list">
              <div class="review-summary-row"><span>MCQ score</span><strong id="review-mcq-score">${score.mcqScore}</strong></div>
              <div class="review-summary-row"><span>Coding score</span><strong id="review-code-score">${score.codingScore}</strong></div>
              <div class="review-summary-row"><span>Reference pass</span><strong>${test.passPercentage}%</strong></div>
              <div class="review-summary-row"><span>Result status</span><strong id="review-result-state">${score.percentage >= test.passPercentage ? "Meets level" : "Needs practice"}</strong></div>
            </div>
            <button class="btn btn-secondary btn-block" onclick="AakiJourney.saveReview('${attempt.id}')">${published ? "Save published changes" : "Save review draft"}</button>
            <button class="btn btn-primary btn-block" style="margin-top:9px" onclick="AakiJourney.requestPublishResult('${attempt.id}')">${published ? "Update published result" : "Publish complete result"}</button>
            ${published ? `<button class="btn btn-ghost btn-block" style="margin-top:9px" onclick="AakiJourney.viewResult('${attempt.id}')">View candidate result</button>` : ""}
            <p class="muted small" style="margin:13px 0 0;line-height:1.55">${published ? "Saved changes update Aaki’s visible result after you confirm publication." : "Publishing reveals MCQ correctness, coding marks, and all remarks together."}</p>
          </aside>
        </div>
      </div>
    `);

    test.questions.filter(isWebPreviewQuestion).forEach((question) => {
      const frame = document.getElementById(`review-preview-${question.id}`);
      renderWebPreview(frame, getResponseFiles(question, attempt.responses?.[question.id] || {}));
    });
  }

  function renderIntegrityReview(attempt, test) {
    const events = Array.isArray(attempt.integrityEvents) ? attempt.integrityEvents : [];
    const tabEvents = events.filter((event) => event.type === "TAB_SWITCH");
    return `<section class="card review-question integrity-review-card">
      <div class="section-head"><div><h3>Assessment integrity</h3><p>Recorded automatically while the candidate’s attempt was active</p></div><span class="badge ${tabEvents.length ? "badge-rose" : "badge-green"}">${tabEvents.length} tab switch${tabEvents.length === 1 ? "" : "es"}</span></div>
      ${tabEvents.length ? `<div class="integrity-timeline">${tabEvents.map((event, index) => {
        const questionIndex = Number.isInteger(event.questionIndex) ? event.questionIndex : test.questions.findIndex((question) => question.id === event.questionId);
        const questionLabel = questionIndex >= 0 ? `Question ${questionIndex + 1}` : "Question unavailable";
        return `<div class="integrity-event"><span class="integrity-event-number">${index + 1}</span><div><strong>Assessment tab hidden</strong><p>${escapeHtml(formatDate(event.occurredAt, true))} · ${escapeHtml(questionLabel)}</p></div></div>`;
      }).join("")}</div>` : `<div class="answer-box correct"><strong>No tab departures recorded</strong><p class="muted small" style="margin:6px 0 0">The assessment page did not become hidden during this attempt.</p></div>`}
      <div class="lock-note" style="margin-top:14px">A tab-switch record indicates that the assessment page became hidden. It is an integrity signal for your review, not an automatic cheating verdict.</div>
    </section>`;
  }

  function renderReviewQuestion(question, index, attempt, readOnly) {
    const response = attempt.responses?.[question.id] || {};
    const questionReview = attempt.review?.questionReviews?.[question.id] || {};
    if (question.type === "MCQ") {
      const selected = question.options.find((option) => option.id === response.selectedOptionId);
      const correct = question.options.find((option) => option.id === question.correctOptionId);
      const isCorrect = response.locked && response.selectedOptionId === question.correctOptionId;
      return `<section class="card review-question">
        <div class="review-question-head"><div><span class="badge badge-primary">Question ${index + 1} · MCQ</span><h3 style="margin:12px 0 0">${escapeHtml(question.prompt)}</h3></div><span class="badge ${isCorrect ? "badge-green" : "badge-rose"}">${isCorrect ? "1/1" : "0/1"}</span></div>
        ${renderQuestionImage(question, "question-media review-media")}
        <div class="grid grid-2"><div class="answer-box ${isCorrect ? "correct" : "incorrect"}"><span class="muted small">Aaki’s answer</span><strong style="display:block;margin-top:7px">${escapeHtml(selected?.text || "Not confirmed")}</strong></div><div class="answer-box correct"><span class="muted small">Correct answer</span><strong style="display:block;margin-top:7px">${escapeHtml(correct?.text || "")}</strong></div></div>
        <div class="field" style="margin-top:16px;margin-bottom:0"><label>Question remark</label><textarea ${readOnly ? "disabled" : ""} oninput="AakiJourney.updateQuestionReview('${attempt.id}','${question.id}','remark',this.value)" placeholder="Optional explanation or revision note...">${escapeHtml(questionReview.remark || "")}</textarea></div>
      </section>`;
    }

    const submission = isWebPreviewQuestion(question)
      ? renderWebSubmissionFiles(question, response)
      : `<pre class="code-readonly">${escapeHtml(response.code || "No code submitted")}</pre>`;

    return `<section class="card review-question">
      <div class="review-question-head"><div><span class="badge badge-rose">Question ${index + 1} · ${escapeHtml(question.language || "Code")}</span><h3 style="margin:12px 0 6px">${escapeHtml(question.prompt)}</h3><p class="muted small" style="line-height:1.6;margin:0">${escapeHtml(question.description || "")}</p></div><span class="badge">${question.marks} marks</span></div>
      ${renderQuestionImage(question, "question-media review-media")}
      ${submission}
      ${isWebPreviewQuestion(question) ? `<div class="preview-panel" style="margin-top:12px"><div class="panel-bar"><span>Submitted project output</span><div class="panel-actions"><span class="badge">Sandboxed</span><button class="btn btn-secondary btn-sm" onclick="AakiJourney.openPreviewOverlay('${attempt.id}','${question.id}')">Focus preview</button></div></div><iframe id="review-preview-${question.id}" class="preview-frame" sandbox="allow-scripts allow-forms allow-modals" title="Submitted web project preview"></iframe></div>` : ""}
      ${isTestCaseQuestion(question) ? renderReviewerTestCases(question, questionReview, attempt.id, readOnly) : ""}
      <div class="score-input">
        <div class="field" style="margin:0"><label>Marks awarded</label><input type="number" min="0" max="${question.marks}" step="0.5" value="${questionReview.awardedMarks ?? ""}" ${readOnly ? "disabled" : ""} oninput="AakiJourney.updateAwardedMarks('${attempt.id}','${question.id}',this)" /></div>
        <div class="field" style="margin:0"><label>Question remark</label><textarea ${readOnly ? "disabled" : ""} oninput="AakiJourney.updateQuestionReview('${attempt.id}','${question.id}','remark',this.value)" placeholder="Explain what worked and what should improve...">${escapeHtml(questionReview.remark || "")}</textarea></div>
      </div>
    </section>`;
  }

  function renderWebSubmissionFiles(question, response) {
    const files = getResponseFiles(question, response);
    return `<div class="submitted-file-list">
      ${WEB_FILE_KEYS.map((key) => `<details class="submitted-file" ${key === "html" ? "open" : ""}>
        <summary>${key === "html" ? "HTML" : key === "css" ? "CSS" : "JavaScript"}</summary>
        <pre class="code-readonly">${escapeHtml(files[key] || `No ${key} submitted`)}</pre>
      </details>`).join("")}
    </div>`;
  }

  function renderReviewerTestCases(question, questionReview, attemptId, readOnly) {
    const cases = question.testCases || [];
    if (!cases.length) return `<div class="test-case-empty review-test-case-empty"><strong>No test cases configured</strong><span>Review the submitted source directly.</span></div>`;
    const results = questionReview.testCaseResults || {};
    return `<section class="review-test-cases">
      <div class="section-head"><div><h3>Test-case review</h3><p>Run the submitted code against public and private cases, then adjust any status manually when needed.</p></div><div class="panel-actions"><span class="badge">${cases.length} cases</span><button id="review-run-tests-${question.id}" class="btn btn-primary btn-sm" onclick="AakiJourney.runQuestionTests('${attemptId}','${question.id}',true)">▶ Run all tests</button></div></div>
      <div class="test-case-list">
        ${cases.map((item, index) => {
          const result = results[item.id] || {};
          return `<article class="test-case-card">
            <div class="test-case-head"><strong>${item.visibility === "HIDDEN" ? "Hidden" : "Public"} case ${index + 1}</strong><span class="badge ${item.visibility === "HIDDEN" ? "badge-rose" : "badge-green"}">${item.visibility === "HIDDEN" ? "Hidden from Aaki" : "Visible to Aaki"}</span></div>
            <div class="test-case-grid">
              <div><span>Input</span><pre>${escapeHtml(item.input || "No input")}</pre></div>
              <div><span>Expected output</span><pre>${escapeHtml(item.expectedOutput || "No output specified")}</pre></div>
            </div>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
            ${result.actualOutput || result.error ? `<div class="test-run-output"><span>Actual output</span><pre>${escapeHtml(result.actualOutput || result.error || "No output")}</pre>${result.runtimeStatus ? `<small>${escapeHtml(result.runtimeStatus)}</small>` : ""}</div>` : ""}
            <div class="test-case-review-controls">
              <div class="field" style="margin:0"><label>Reviewer status</label><select ${readOnly ? "disabled" : ""} onchange="AakiJourney.updateTestCaseReview('${attemptId}','${question.id}','${item.id}','status',this.value)">
                <option value="NOT_CHECKED" ${(result.status || "NOT_CHECKED") === "NOT_CHECKED" ? "selected" : ""}>Not checked</option>
                <option value="PASSED" ${result.status === "PASSED" ? "selected" : ""}>Passed</option>
                <option value="FAILED" ${result.status === "FAILED" ? "selected" : ""}>Failed</option>
              </select></div>
              <div class="field" style="margin:0"><label>Case note</label><input ${readOnly ? "disabled" : ""} value="${escapeAttr(result.note || "")}" oninput="AakiJourney.updateTestCaseReview('${attemptId}','${question.id}','${item.id}','note',this.value)" placeholder="Optional reviewer note" /></div>
            </div>
          </article>`;
        }).join("")}
      </div>
    </section>`;
  }

  function reviewField(label, key, value, placeholder, readOnly) {
    return `<div class="field"><label>${escapeHtml(label)}</label><textarea ${readOnly ? "disabled" : ""} oninput="AakiJourney.updateOverallReview('${key}',this.value)" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value || "")}</textarea></div>`;
  }

  function updateQuestionReview(attemptId, questionId, field, value) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    const question = test?.questions.find((item) => item.id === questionId);
    if (!attempt || !question) return;
    attempt.review = attempt.review || { questionReviews: {} };
    attempt.review.questionReviews = attempt.review.questionReviews || {};
    attempt.review.questionReviews[questionId] = attempt.review.questionReviews[questionId] || {};
    attempt.review.questionReviews[questionId][field] = field === "awardedMarks"
      ? (value === "" ? "" : clamp(value, 0, question.marks))
      : value;
    attempt.reviewedAt = nowIso();
    saveData();
    updateReviewScoreDisplay(test, attempt);
  }

  function updateAwardedMarks(attemptId, questionId, input) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const question = getTest(attempt?.testId)?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || !input) return;
    const typed = Number(input.value);
    if (input.value === "") {
      updateQuestionReview(attemptId, questionId, "awardedMarks", "");
      return;
    }
    const clamped = clamp(Number.isFinite(typed) ? typed : 0, 0, question.marks);
    if (typed !== clamped) {
      input.value = clamped;
      toast("Marks adjusted", `This question carries a maximum of ${question.marks} marks.`);
    }
    updateQuestionReview(attemptId, questionId, "awardedMarks", clamped);
  }

  function updateTestCaseReview(attemptId, questionId, caseId, field, value) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const question = getTest(attempt?.testId)?.questions.find((item) => item.id === questionId);
    if (!attempt || !question || !(question.testCases || []).some((item) => item.id === caseId)) return;
    attempt.review = attempt.review || { questionReviews: {} };
    attempt.review.questionReviews = attempt.review.questionReviews || {};
    const questionReview = attempt.review.questionReviews[questionId] = attempt.review.questionReviews[questionId] || {};
    questionReview.testCaseResults = questionReview.testCaseResults || {};
    questionReview.testCaseResults[caseId] = questionReview.testCaseResults[caseId] || {};
    questionReview.testCaseResults[caseId][field] = value;
    attempt.reviewedAt = nowIso();
    saveData();
  }

  function updateOverallReview(key, value) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    if (!attempt) return;
    attempt.review = attempt.review || { questionReviews: {} };
    attempt.review[key] = value;
    attempt.reviewedAt = nowIso();
    saveData();
  }

  function updateReviewScoreDisplay(test, attempt) {
    const score = calculateAttemptScore(test, attempt);
    const total = document.getElementById("review-total-score");
    const percentage = document.getElementById("review-percentage");
    const coding = document.getElementById("review-code-score");
    const state = document.getElementById("review-result-state");
    const ring = document.querySelector(".score-ring");
    if (total) total.textContent = `${score.obtained}/${score.total}`;
    if (percentage) percentage.textContent = `${score.percentage}%`;
    if (coding) coding.textContent = score.codingScore;
    if (state) state.textContent = score.percentage >= test.passPercentage ? "Meets level" : "Needs practice";
    if (ring) ring.style.setProperty("--score-angle", `${Math.round((score.percentage / 100) * 360)}deg`);
  }

  function saveReview(attemptId) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || !test) return;
    const wasPublished = attempt.status === "RESULT_PUBLISHED";
    attempt.status = wasPublished ? "RESULT_PUBLISHED" : "UNDER_REVIEW";
    attempt.reviewedAt = nowIso();
    if (wasPublished) attempt.finalScore = calculateAttemptScore(test, attempt);
    saveData();
    toast(wasPublished ? "Published review saved" : "Review draft saved", wasPublished ? "Use Update published result to confirm the revised result for Aaki." : "Aaki still cannot see marks or remarks.");
  }

  function requestPublishResult(attemptId) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || !test) return;
    const missingMarks = test.questions.filter((question) => question.type === "CODE" && (attempt.review?.questionReviews?.[question.id]?.awardedMarks === undefined || attempt.review?.questionReviews?.[question.id]?.awardedMarks === ""));
    if (missingMarks.length) {
      toast("Coding marks required", `Enter marks for ${missingMarks.length} coding question${missingMarks.length === 1 ? "" : "s"}.`);
      return;
    }
    const updating = attempt.status === "RESULT_PUBLISHED";
    requestConfirm(
      updating ? "Update the published result?" : "Publish the complete result?",
      updating
        ? "Aaki’s visible marks, test-case outcomes, and review notes will be replaced with these updated values."
        : "Aaki will immediately see MCQ correctness, coding marks, question remarks, and your overall review.",
      () => publishResult(attemptId),
      { confirmLabel: updating ? "Update result" : "Publish result" }
    );
  }

  function publishResult(attemptId) {
    if (!requireAdmin()) return;
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || !test) return;
    attempt.review = attempt.review && typeof attempt.review === "object" ? attempt.review : {};
    attempt.review.questionReviews = attempt.review.questionReviews && typeof attempt.review.questionReviews === "object" ? attempt.review.questionReviews : {};
    test.questions.filter((question) => question.type === "MCQ").forEach((question) => {
      attempt.review.questionReviews[question.id] = attempt.review.questionReviews[question.id] || {};
      attempt.review.questionReviews[question.id].awardedMarks = attempt.responses[question.id]?.selectedOptionId === question.correctOptionId && attempt.responses[question.id]?.locked ? 1 : 0;
    });
    attempt.finalScore = calculateAttemptScore(test, attempt);
    attempt.status = "RESULT_PUBLISHED";
    attempt.reviewedAt = attempt.reviewedAt || nowIso();
    const wasPublished = Boolean(attempt.publishedAt);
    attempt.publishedAt = attempt.publishedAt || nowIso();
    attempt.updatedAt = nowIso();
    addActivity("RESULT", `${test.title} result ${wasPublished ? "updated" : "published"} for ${getUser(attempt.userId)?.name || "the candidate"}`);
    saveData();
    closeModal();
    toast("Result saved", "Aaki can now see the latest MCQ, coding, and review details together.");
    render();
  }

  function viewResult(attemptId) {
    const attempt = data.attempts.find((item) => item.id === attemptId);
    if (!attempt || attempt.status !== "RESULT_PUBLISHED" || !ownsAttempt(attempt)) {
      toast("Result unavailable", "This result is not available to your account.");
      return;
    }
    go("result_detail", { attemptId });
  }

  function renderResultDetail(attemptId) {
    const attempt = data.attempts.find((item) => item.id === attemptId);
    const test = getTest(attempt?.testId);
    if (!attempt || !test || attempt.status !== "RESULT_PUBLISHED" || !ownsAttempt(attempt)) return go(isAdmin() ? "submissions" : "results");
    const score = attempt.finalScore || calculateAttemptScore(test, attempt);
    const review = attempt.review || { questionReviews: {}, overallNotes: "", strengths: "", improvements: "", nextSteps: "", encouragement: "" };
    const passed = score.percentage >= test.passPercentage;
    const backRoute = isAdmin() ? "submissions" : "results";
    renderLayout(`
      <div class="page">
        <div class="page-head"><div><button class="btn btn-ghost btn-sm" onclick="AakiJourney.go('${backRoute}')" style="margin-bottom:14px">← Back</button><h1>Detailed result</h1><p>Published ${formatDate(attempt.publishedAt, true)} · ${escapeHtml(test.technology)} · ${escapeHtml(test.difficulty)}</p></div></div>
        <section class="result-hero">
          <span class="badge" style="color:#fff;border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.1)">${passed ? "Foundation achieved" : "Practice plan recommended"}</span>
          <h2 style="font-size:clamp(1.9rem,4vw,3.2rem);margin:18px 0 0;position:relative;z-index:1">${escapeHtml(test.title)}</h2>
          <div class="result-score" style="position:relative;z-index:1"><strong>${score.percentage}%</strong><span>${score.obtained} of ${score.total} marks</span></div>
          <p style="color:rgba(255,255,255,.74);margin:14px 0 0;position:relative;z-index:1">MCQ: ${score.mcqScore} · Coding: ${score.codingScore}</p>
        </section>
        <div class="grid grid-2" style="margin-top:20px">
          ${feedbackResultBlock("Overall review", review.overallNotes)}
          ${feedbackResultBlock("Encouragement", review.encouragement)}
          ${feedbackResultBlock("Strongest areas", review.strengths)}
          ${feedbackResultBlock("Areas to improve", review.improvements)}
        </div>
        <section class="card feedback-block" style="margin-top:20px">${feedbackInner("Recommended next step", review.nextSteps)}</section>
        <section style="margin-top:24px">
          <div class="section-head"><div><h3>Question-by-question review</h3><p>Your answer, awarded marks, and specific remarks</p></div></div>
          <div class="list">${test.questions.map((question, index) => renderResultQuestion(question, index, attempt)).join("")}</div>
        </section>
      </div>
    `);
    test.questions.filter(isWebPreviewQuestion).forEach((question) => {
      const frame = document.getElementById(`result-preview-${question.id}`);
      renderWebPreview(frame, getResponseFiles(question, attempt.responses?.[question.id] || {}));
    });
  }

  function feedbackResultBlock(title, content) {
    return `<section class="card feedback-block">${feedbackInner(title, content)}</section>`;
  }

  function feedbackInner(title, content) {
    return `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(content || "No note added.")}</p>`;
  }

  function renderResultQuestion(question, index, attempt) {
    const response = attempt.responses?.[question.id] || {};
    const review = attempt.review?.questionReviews?.[question.id] || {};
    if (question.type === "MCQ") {
      const selected = question.options.find((option) => option.id === response.selectedOptionId);
      const correct = question.options.find((option) => option.id === question.correctOptionId);
      const isCorrect = review.awardedMarks === 1;
      return `<article class="card result-question">
        <div class="review-question-head"><div><span class="badge badge-primary">Question ${index + 1} · MCQ</span><h3 style="margin:11px 0 0">${escapeHtml(question.prompt)}</h3></div><span class="badge ${isCorrect ? "badge-green" : "badge-rose"}">${review.awardedMarks || 0}/1</span></div>
        ${renderQuestionImage(question, "question-media review-media")}
        <div class="grid grid-2"><div class="answer-box ${isCorrect ? "correct" : "incorrect"}"><span class="muted small">Your answer</span><strong style="display:block;margin-top:7px">${escapeHtml(selected?.text || "Not answered")}</strong></div><div class="answer-box correct"><span class="muted small">Correct answer</span><strong style="display:block;margin-top:7px">${escapeHtml(correct?.text || "")}</strong></div></div>
        <div class="answer-box" style="margin-top:12px"><span class="muted small">Review note</span><p style="margin:7px 0 0;line-height:1.65">${escapeHtml(review.remark || "No additional note.")}</p></div>
      </article>`;
    }

    return `<article class="card result-question">
      <div class="review-question-head"><div><span class="badge badge-rose">Question ${index + 1} · ${escapeHtml(question.language)}</span><h3 style="margin:11px 0 0">${escapeHtml(question.prompt)}</h3></div><span class="badge badge-primary">${review.awardedMarks || 0}/${question.marks}</span></div>
      ${renderQuestionImage(question, "question-media review-media")}
      ${isWebPreviewQuestion(question) ? renderWebSubmissionFiles(question, response) : `<pre class="code-readonly">${escapeHtml(response.code || "No code submitted")}</pre>`}
      ${isWebPreviewQuestion(question) ? `<div class="preview-panel" style="margin-top:12px"><div class="panel-bar"><span>Your submitted project output</span><div class="panel-actions"><span class="badge">Sandboxed</span><button class="btn btn-secondary btn-sm" onclick="AakiJourney.openPreviewOverlay('${attempt.id}','${question.id}')">Focus preview</button></div></div><iframe id="result-preview-${question.id}" class="preview-frame" sandbox="allow-scripts allow-forms allow-modals" title="Result web project preview"></iframe></div>` : ""}
      ${isTestCaseQuestion(question) ? renderResultTestCases(question, review) : ""}
      <div class="answer-box" style="margin-top:12px"><span class="muted small">Review note</span><p style="margin:7px 0 0;line-height:1.65;white-space:pre-wrap">${escapeHtml(review.remark || "No additional note.")}</p></div>
    </article>`;
  }

  function renderResultTestCases(question, review) {
    const cases = question.testCases || [];
    if (!cases.length) return "";
    const results = review.testCaseResults || {};
    const publicCases = cases.filter((item) => item.visibility !== "HIDDEN");
    const hiddenCases = cases.filter((item) => item.visibility === "HIDDEN");
    const hiddenChecked = hiddenCases.filter((item) => ["PASSED", "FAILED"].includes(results[item.id]?.status));
    const hiddenPassed = hiddenCases.filter((item) => results[item.id]?.status === "PASSED").length;

    return `<section class="review-test-cases result-test-cases">
      <div class="section-head"><div><h3>Test-case feedback</h3><p>Public cases are shown below. Hidden case inputs remain private.</p></div>${hiddenCases.length ? `<span class="badge">${hiddenPassed}/${hiddenChecked.length || hiddenCases.length} hidden passed</span>` : ""}</div>
      ${publicCases.length ? `<div class="test-case-list">${publicCases.map((item, index) => {
        const result = results[item.id] || {};
        const status = result.status || "NOT_CHECKED";
        return `<article class="test-case-card">
          <div class="test-case-head"><strong>Public case ${index + 1}</strong><span class="badge ${status === "PASSED" ? "badge-green" : status === "FAILED" ? "badge-rose" : ""}">${status === "PASSED" ? "Passed" : status === "FAILED" ? "Failed" : "Not checked"}</span></div>
          <div class="test-case-grid">
            <div><span>Input</span><pre>${escapeHtml(item.input || "No input")}</pre></div>
            <div><span>Expected output</span><pre>${escapeHtml(item.expectedOutput || "No output specified")}</pre></div>
          </div>
          ${result.note ? `<p><strong>Reviewer note:</strong> ${escapeHtml(result.note)}</p>` : ""}
        </article>`;
      }).join("")}</div>` : ""}
    </section>`;
  }

  function openTestBuilder(testId = null) {
    if (!requireAdmin()) return;
    const existing = testId ? getTest(testId) : null;
    builderDraft = existing ? { ...deepClone(existing), opensAt: existing.opensAt || null } : {
      id: uid("test"),
      title: "",
      description: "",
      technology: "HTML",
      difficulty: "Beginner",
      durationMinutes: 45,
      passPercentage: 50,
      opensAt: null,
      instructions: "MCQs allow one confirmed attempt. Coding answers are reviewed manually. Leaving the assessment tab is recorded. All results remain hidden until the complete review is published.",
      status: "DRAFT",
      assignedTo: data.users.filter((user) => user.role === "CANDIDATE").map((user) => user.id),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      questions: []
    };
    renderBuilderModal(Boolean(existing));
  }

  function renderBuilderModal(isEditing = false) {
    if (!isAdmin()) return;
    if (!builderDraft) return;
    destroyCodeEditors(modalRoot);
    modalRoot.innerHTML = `
      <div class="modal-backdrop" onclick="if(event.target===this) AakiJourney.closeModal()">
        <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="builder-title">
          <div class="modal-head"><div><h3 id="builder-title">${isEditing ? "Edit assessment" : "Create assessment"}</h3><p class="muted small" style="margin:4px 0 0">Live web projects · Reviewer test cases · Combined result publication</p></div><button class="icon-btn" onclick="AakiJourney.closeModal()">×</button></div>
          <div class="modal-body">
            <div class="builder-shell">
              <section class="card builder-section" style="box-shadow:none">
                <div class="section-head"><div><h3>Assessment details</h3><p>Core configuration and candidate instructions</p></div></div>
                <div class="field"><label>Test title</label><input value="${escapeAttr(builderDraft.title)}" oninput="AakiJourney.updateBuilderField('title',this.value)" placeholder="e.g. HTML Fundamentals - Level 2" /></div>
                <div class="field"><label>Description</label><textarea oninput="AakiJourney.updateBuilderField('description',this.value)" placeholder="Briefly explain what this assessment covers.">${escapeHtml(builderDraft.description)}</textarea></div>
                <div class="field-row">
                  <div class="field"><label>Technology</label><select onchange="AakiJourney.updateBuilderField('technology',this.value)">${TECHNOLOGIES.map((item) => `<option ${builderDraft.technology === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
                  <div class="field"><label>Difficulty</label><select onchange="AakiJourney.updateBuilderField('difficulty',this.value)">${DIFFICULTIES.map((item) => `<option ${builderDraft.difficulty === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
                  <div class="field"><label>Duration (minutes)</label><input type="number" min="5" max="300" value="${builderDraft.durationMinutes}" oninput="AakiJourney.updateBuilderField('durationMinutes',this.value)" /></div>
                  <div class="field"><label>Reference pass (%)</label><input type="number" min="0" max="100" value="${builderDraft.passPercentage}" oninput="AakiJourney.updateBuilderField('passPercentage',this.value)" /></div>
                </div>
                <div class="field"><label>Unlock date & time <span class="muted small">(optional)</span></label><input type="datetime-local" value="${escapeAttr(toLocalDateTimeInput(builderDraft.opensAt))}" onchange="AakiJourney.updateBuilderDateTime(this.value)" /><small class="field-help">Leave empty to make the test available immediately after publishing. The selected time uses your device’s time zone.</small></div>
                <div class="field" style="margin-bottom:0"><label>Instructions</label><textarea oninput="AakiJourney.updateBuilderField('instructions',this.value)">${escapeHtml(builderDraft.instructions)}</textarea></div>
              </section>

              <section class="card builder-section" style="box-shadow:none">
                <div class="section-head"><div><h3>Questions</h3><p>${builderDraft.questions.length} questions · ${getTestTotal(builderDraft)} total marks</p></div><div style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="AakiJourney.addBuilderQuestion('MCQ')">Add MCQ</button><button class="btn btn-primary btn-sm" onclick="AakiJourney.addBuilderQuestion('CODE')">Add code question</button></div></div>
                <div class="question-builder-list">
                  ${builderDraft.questions.length ? builderDraft.questions.map((question, index) => renderBuilderQuestion(question, index)).join("") : renderEmpty("No questions added", "Add an MCQ or coding question. MCQs always carry 1 mark; code questions can carry 5 to 50 marks.")}
                </div>
              </section>
            </div>
          </div>
          <div class="modal-foot"><button class="btn btn-ghost" onclick="AakiJourney.closeModal()">Cancel</button><button class="btn btn-secondary" onclick="AakiJourney.saveBuilder('DRAFT')">Save draft</button><button class="btn btn-primary" onclick="AakiJourney.saveBuilder('PUBLISHED')">Save and publish</button></div>
        </div>
      </div>
    `;
    requestAnimationFrame(() => initializeBuilderCodeEditors());
  }

  function renderBuilderQuestion(question, index) {
    return `<article class="question-builder-card" data-builder-question="${escapeAttr(question.id)}">
      <div class="question-builder-head"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="badge ${question.type === "MCQ" ? "badge-primary" : "badge-rose"}">Question ${index + 1} · ${question.type === "MCQ" ? "MCQ" : "Code"}</span><span class="badge">${question.marks} mark${question.marks === 1 ? "" : "s"}</span></div><button class="btn btn-danger btn-sm" onclick="AakiJourney.removeBuilderQuestion('${question.id}')">Remove</button></div>
      <div class="field"><label>Question title / prompt</label><input value="${escapeAttr(question.prompt)}" oninput="AakiJourney.updateBuilderQuestion('${question.id}','prompt',this.value)" placeholder="Write the question clearly" /></div>
      <div class="field"><label>Description or instructions</label><textarea oninput="AakiJourney.updateBuilderQuestion('${question.id}','description',this.value)" placeholder="Add context, requirements, or constraints">${escapeHtml(question.description || "")}</textarea></div>
      <section class="question-image-builder">
        <div class="section-head"><div><h3>Reference image</h3><p>Optional screenshot, diagram, UI design, database schema, or expected layout.</p></div>${question.imageData ? `<button class="btn btn-ghost btn-sm" onclick="AakiJourney.removeQuestionImage('${question.id}')">Remove image</button>` : ""}</div>
        <div class="image-builder-grid image-path-grid">
          <div class="field" style="margin:0"><label>Image path or direct HTTPS URL</label><input value="${escapeAttr(question.imageData || "")}" oninput="AakiJourney.updateQuestionImagePath('${question.id}',this.value)" placeholder="assets/questions/form-reference.png" /><small class="field-help">Add local files under <code>assets/questions/</code> and deploy them with the project.</small></div>
          ${question.imageData ? `<div class="image-builder-preview"><img src="${escapeAttr(question.imageData)}" alt="${escapeAttr(question.imageAlt || "Question preview")}" onerror="this.parentElement.innerHTML='<span>Image path not found</span>'" /></div>` : `<div class="image-builder-placeholder"><span>Image preview</span></div>`}
        </div>
        <div class="field" style="margin:12px 0 0"><label>Image description <span class="muted small">(accessibility)</span></label><input value="${escapeAttr(question.imageAlt || "")}" oninput="AakiJourney.updateBuilderQuestion('${question.id}','imageAlt',this.value)" placeholder="Describe what the image shows" /></div>
      </section>
      ${question.type === "MCQ" ? renderBuilderMcq(question) : renderBuilderCode(question)}
    </article>`;
  }

  function renderBuilderMcq(question) {
    return `<div><label style="display:block;font-size:.88rem;font-weight:700;margin-bottom:9px">Answer options</label>
      ${question.options.map((option) => `<div class="option-builder"><input type="radio" name="correct-${question.id}" ${question.correctOptionId === option.id ? "checked" : ""} onchange="AakiJourney.setCorrectOption('${question.id}','${option.id}')" title="Mark as correct" /><input value="${escapeAttr(option.text)}" oninput="AakiJourney.updateBuilderOption('${question.id}','${option.id}',this.value)" placeholder="Option text" /><button class="icon-btn" onclick="AakiJourney.removeBuilderOption('${question.id}','${option.id}')">×</button></div>`).join("")}
      <button class="btn btn-secondary btn-sm" onclick="AakiJourney.addBuilderOption('${question.id}')">Add option</button>
      <p class="muted small" style="margin:10px 0 0">Select the radio button beside the correct option. MCQs are fixed at 1 mark and one confirmed attempt.</p>
    </div>`;
  }

  function renderBuilderCode(question) {
    const mode = evaluationModeFor(question);
    question.evaluationMode = mode;
    question.starterFiles = getStarterFiles(question);
    question.testCases = Array.isArray(question.testCases) ? question.testCases : [];

    return `<div class="field-row">
      <div class="field"><label>Language / technology</label><select onchange="AakiJourney.updateBuilderQuestion('${question.id}','language',this.value)">${TECHNOLOGIES.map((item) => `<option ${question.language === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
      <div class="field"><label>Question workspace</label><select onchange="AakiJourney.updateBuilderQuestion('${question.id}','evaluationMode',this.value)">${EVALUATION_MODES.map((item) => `<option value="${item.value}" ${mode === item.value ? "selected" : ""}>${item.label}</option>`).join("")}</select></div>
      <div class="field"><label>Maximum marks (5–50)</label><input type="number" min="5" max="50" value="${question.marks}" oninput="AakiJourney.updateBuilderQuestion('${question.id}','marks',this.value)" /></div>
    </div>
    ${mode === "WEB_PREVIEW" ? renderBuilderWebFiles(question) : renderBuilderSourceCode(question)}
    ${mode === "TEST_CASES" ? renderBuilderTestCases(question) : ""}
    <p class="muted small" style="margin:10px 0 0">${mode === "WEB_PREVIEW"
      ? "The candidate receives separate HTML, CSS, and JavaScript files with an autosaved sandbox preview and in-site focused view."
      : mode === "TEST_CASES"
        ? "Public cases are visible during the assessment. Hidden cases appear only in your review workspace."
        : "The source answer is submitted without preview or test cases and is graded manually."}</p>`;
  }

  function renderBuilderWebFiles(question) {
    const files = getStarterFiles(question);
    return `<section class="builder-code-section">
      <div class="section-head"><div><h3>Starter project files</h3><p>Leave any file empty when it is not required.</p></div><span class="badge badge-primary">HTML · CSS · JS</span></div>
      <div class="builder-file-grid">
        ${WEB_FILE_KEYS.map((key) => `<div class="field" style="margin:0">
          <label>${key === "html" ? "HTML" : key === "css" ? "CSS" : "JavaScript"} starter</label>
          <textarea class="builder-code-editor" data-cm-context="builder" data-question-id="${escapeAttr(question.id)}" data-file-key="${key}" data-language="${key}" placeholder="${key === "html" ? "<main>...</main>" : key === "css" ? ".card { ... }" : "const app = ...;"}">${escapeHtml(files[key] || "")}</textarea>
        </div>`).join("")}
      </div>
    </section>`;
  }

  function renderBuilderSourceCode(question) {
    return `<div class="field" style="margin-bottom:0"><label>Starter code</label><textarea class="builder-code-editor" data-cm-context="builder" data-question-id="${escapeAttr(question.id)}" data-language="${escapeAttr(question.language || "Other")}" placeholder="Optional starter code">${escapeHtml(question.starterCode || "")}</textarea></div>`;
  }

  function renderBuilderTestCases(question) {
    const publicCount = question.testCases.filter((item) => item.visibility !== "HIDDEN").length;
    const privateCount = question.testCases.filter((item) => item.visibility === "HIDDEN").length;
    return `<section class="builder-test-cases">
      <div class="section-head"><div><h3>Test cases</h3><p>Public cases can be run by Aaki. Private cases are hidden and available only during admin review.</p></div><div class="test-case-add-actions"><button class="btn btn-success btn-sm" onclick="AakiJourney.addBuilderTestCase('${question.id}','PUBLIC')">＋ Public case</button><button class="btn btn-secondary btn-sm" onclick="AakiJourney.addBuilderTestCase('${question.id}','HIDDEN')">＋ Private case</button></div></div>
      <div class="test-case-summary"><span class="badge badge-green">${publicCount} public</span><span class="badge badge-rose">${privateCount} private</span></div>
      ${question.testCases.length ? `<div class="test-case-list">${question.testCases.map((item, index) => `<article class="test-case-card builder-test-case ${item.visibility === "HIDDEN" ? "private-case" : "public-case"}">
        <div class="test-case-head"><div><strong>${item.visibility === "HIDDEN" ? "Private" : "Public"} test case ${index + 1}</strong><span class="test-case-visibility-copy">${item.visibility === "HIDDEN" ? "Only Aayush can see and run it" : "Aaki can see and run it"}</span></div><button class="btn btn-danger btn-sm" onclick="AakiJourney.removeBuilderTestCase('${question.id}','${item.id}')">Remove</button></div>
        <div class="field-row">
          <div class="field"><label>Visibility</label><select onchange="AakiJourney.updateBuilderTestCase('${question.id}','${item.id}','visibility',this.value)">
            <option value="PUBLIC" ${item.visibility !== "HIDDEN" ? "selected" : ""}>Public test case</option>
            <option value="HIDDEN" ${item.visibility === "HIDDEN" ? "selected" : ""}>Private test case</option>
          </select></div>
          <div class="field"><label>Purpose <span class="muted small">(optional)</span></label><input value="${escapeAttr(item.note || "")}" oninput="AakiJourney.updateBuilderTestCase('${question.id}','${item.id}','note',this.value)" placeholder="What this case validates" /></div>
        </div>
        <div class="test-case-grid builder-case-grid">
          <div class="field" style="margin:0"><label>Program input / SQL setup</label><textarea oninput="AakiJourney.updateBuilderTestCase('${question.id}','${item.id}','input',this.value)" placeholder="Input passed to stdin, or SQL setup statements">${escapeHtml(item.input || "")}</textarea></div>
          <div class="field" style="margin:0"><label>Expected output</label><textarea oninput="AakiJourney.updateBuilderTestCase('${question.id}','${item.id}','expectedOutput',this.value)" placeholder="Exact expected output">${escapeHtml(item.expectedOutput || "")}</textarea></div>
        </div>
      </article>`).join("")}</div>` : `<div class="test-case-empty"><strong>No test cases yet</strong><span>Add a public case for guidance or a private case for hidden validation.</span></div>`}
    </section>`;
  }

  function rerenderBuilderModal({ anchorQuestionId = null, revealQuestionId = null } = {}) {
    const previousScroller = modalRoot.querySelector(".modal");
    const previousScrollTop = previousScroller?.scrollTop || 0;
    let anchorOffset = null;
    if (previousScroller && anchorQuestionId) {
      const previousCard = previousScroller.querySelector(`[data-builder-question="${CSS.escape(anchorQuestionId)}"]`);
      if (previousCard) anchorOffset = previousCard.getBoundingClientRect().top - previousScroller.getBoundingClientRect().top;
    }

    renderBuilderModal(Boolean(data.tests.some((test) => test.id === builderDraft?.id)));

    requestAnimationFrame(() => {
      const nextScroller = modalRoot.querySelector(".modal");
      if (!nextScroller) return;
      nextScroller.scrollTop = previousScrollTop;
      if (anchorQuestionId && anchorOffset !== null) {
        const nextCard = nextScroller.querySelector(`[data-builder-question="${CSS.escape(anchorQuestionId)}"]`);
        if (nextCard) {
          const nextOffset = nextCard.getBoundingClientRect().top - nextScroller.getBoundingClientRect().top;
          nextScroller.scrollTop += nextOffset - anchorOffset;
        }
      }
      if (revealQuestionId) {
        const card = nextScroller.querySelector(`[data-builder-question="${CSS.escape(revealQuestionId)}"]`);
        if (card) {
          const target = card.offsetTop - Math.max(24, (nextScroller.clientHeight - card.offsetHeight) / 2);
          nextScroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        }
      }
    });
  }

  function updateBuilderField(field, value) {
    if (!isAdmin() || !builderDraft) return;
    builderDraft[field] = ["durationMinutes", "passPercentage"].includes(field) ? Number(value) : value;
  }

  function updateBuilderDateTime(value) {
    if (!isAdmin() || !builderDraft) return;
    if (!value) {
      builderDraft.opensAt = null;
      return;
    }
    const date = new Date(value);
    builderDraft.opensAt = Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function addBuilderQuestion(type) {
    if (!isAdmin()) return;
    if (!builderDraft) return;
    let newQuestionId = "";
    if (type === "MCQ") {
      const qid = uid("q");
      newQuestionId = qid;
      const options = [1,2,3,4].map(() => ({ id: uid("opt"), text: "" }));
      builderDraft.questions.push({ id: qid, type: "MCQ", prompt: "", description: "", imageData: "", imageAlt: "", marks: 1, options, correctOptionId: options[0].id });
    } else {
      const language = builderDraft.technology || "HTML";
      newQuestionId = uid("q");
      builderDraft.questions.push({
        id: newQuestionId,
        type: "CODE",
        prompt: "",
        description: "",
        imageData: "",
        imageAlt: "",
        marks: 10,
        language,
        evaluationMode: defaultEvaluationMode(language),
        starterCode: "",
        starterFiles: { html: "", css: "", javascript: "" },
        testCases: []
      });
    }
    rerenderBuilderModal({ revealQuestionId: newQuestionId });
  }

  function removeBuilderQuestion(questionId) {
    if (!isAdmin()) return;
    builderDraft.questions = builderDraft.questions.filter((question) => question.id !== questionId);
    rerenderBuilderModal();
  }

  function updateBuilderQuestion(questionId, field, value) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;

    if (field === "marks") {
      question.marks = clamp(value, 5, 50);
      return;
    }

    question[field] = value;
    if (field === "language") {
      question.evaluationMode = defaultEvaluationMode(value);
      question.starterFiles = getStarterFiles(question);
      question.testCases = Array.isArray(question.testCases) ? question.testCases : [];
      rerenderBuilderModal({ anchorQuestionId: questionId });
    } else if (field === "evaluationMode") {
      question.starterFiles = getStarterFiles(question);
      question.testCases = Array.isArray(question.testCases) ? question.testCases : [];
      rerenderBuilderModal({ anchorQuestionId: questionId });
    }
  }

  function updateBuilderStarterFile(questionId, fileKey, value) {
    if (!isAdmin() || !WEB_FILE_KEYS.includes(fileKey)) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.starterFiles = getStarterFiles(question);
    question.starterFiles[fileKey] = value;
  }

  async function optimiseImageFile(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a valid image file.");
    if (file.size > 8 * 1024 * 1024) throw new Error("The image must be smaller than 8 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the image."));
      reader.readAsDataURL(file);
    });
    if (file.type === "image/gif") return source;
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to process the image."));
      element.src = source;
    });
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.84);
  }

  async function optimiseProfileImage(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Choose a valid image file.");
    if (file.size > 8 * 1024 * 1024) throw new Error("The image must be smaller than 8 MB.");
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read the image."));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to process the image."));
      element.src = source;
    });
    const side = Math.min(image.width, image.height);
    const sx = Math.max(0, (image.width - side) / 2);
    const sy = Math.max(0, (image.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    context.drawImage(image, sx, sy, side, side, 0, 0, 640, 640);
    return canvas.toDataURL("image/webp", 0.86);
  }

  function updateQuestionImagePath(questionId, value) {
    if (!requireAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.imageData = String(value || "").trim();
  }

  function removeQuestionImage(questionId) {
    if (!requireAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.imageData = "";
    question.imageAlt = "";
    rerenderBuilderModal({ anchorQuestionId: questionId });
  }

  function addBuilderTestCase(questionId, visibility = "PUBLIC") {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.testCases = Array.isArray(question.testCases) ? question.testCases : [];
    question.testCases.push({ id: uid("case"), input: "", expectedOutput: "", visibility: visibility === "HIDDEN" ? "HIDDEN" : "PUBLIC", note: "" });
    rerenderBuilderModal({ anchorQuestionId: questionId });
  }

  function updateBuilderTestCase(questionId, caseId, field, value) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    const testCase = question?.testCases?.find((item) => item.id === caseId);
    if (!testCase) return;
    testCase[field] = value;
  }

  function removeBuilderTestCase(questionId, caseId) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.testCases = (question.testCases || []).filter((item) => item.id !== caseId);
    rerenderBuilderModal({ anchorQuestionId: questionId });
  }

  function addBuilderOption(questionId) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question || question.type !== "MCQ") return;
    question.options.push({ id: uid("opt"), text: "" });
    rerenderBuilderModal({ anchorQuestionId: questionId });
  }

  function removeBuilderOption(questionId, optionId) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (!question || question.options.length <= 2) {
      toast("Two options required", "An MCQ must retain at least two choices.");
      return;
    }
    question.options = question.options.filter((option) => option.id !== optionId);
    if (question.correctOptionId === optionId) question.correctOptionId = question.options[0]?.id || null;
    rerenderBuilderModal({ anchorQuestionId: questionId });
  }

  function updateBuilderOption(questionId, optionId, value) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    const option = question?.options.find((item) => item.id === optionId);
    if (option) option.text = value;
  }

  function setCorrectOption(questionId, optionId) {
    if (!isAdmin()) return;
    const question = builderDraft?.questions.find((item) => item.id === questionId);
    if (question) question.correctOptionId = optionId;
  }

  function validateBuilder() {
    if (!isAdmin()) return "Administrator access required.";
    if (!builderDraft.title.trim()) return "Add a test title.";
    if (!builderDraft.description.trim()) return "Add a short test description.";
    if (builderDraft.opensAt && Number.isNaN(new Date(builderDraft.opensAt).getTime())) return "Choose a valid unlock date and time.";
    if (!builderDraft.questions.length) return "Add at least one question.";
    for (let index = 0; index < builderDraft.questions.length; index += 1) {
      const question = builderDraft.questions[index];
      if (!question.prompt.trim()) return `Question ${index + 1} needs a title or prompt.`;
      if (question.type === "MCQ") {
        if (question.options.length < 2 || question.options.some((option) => !option.text.trim())) return `Complete every option in MCQ ${index + 1}.`;
        if (!question.correctOptionId) return `Choose the correct answer for MCQ ${index + 1}.`;
        question.marks = 1;
      } else {
        if (question.marks < 5 || question.marks > 50) {
          return `Coding question ${index + 1} must carry between 5 and 50 marks.`;
        }
        question.evaluationMode = evaluationModeFor(question);
        question.starterFiles = getStarterFiles(question);
        question.testCases = Array.isArray(question.testCases) ? question.testCases : [];
        if (question.evaluationMode === "TEST_CASES") {
          if (!question.testCases.length) return `Add at least one test case to coding question ${index + 1}.`;
          if (question.testCases.some((item) => !String(item.expectedOutput || "").trim())) {
            return `Every test case in coding question ${index + 1} needs an expected output.`;
          }
        }
      }
    }
    return null;
  }

  function saveBuilder(status) {
    if (!isAdmin()) return;
    if (!builderDraft) return;
    const error = validateBuilder();
    if (error) {
      toast("Assessment incomplete", error);
      return;
    }
    builderDraft.status = status;
    builderDraft.durationMinutes = clamp(builderDraft.durationMinutes, 5, 300);
    builderDraft.passPercentage = clamp(builderDraft.passPercentage, 0, 100);
    builderDraft.updatedAt = nowIso();
    const index = data.tests.findIndex((test) => test.id === builderDraft.id);
    if (index >= 0) data.tests[index] = deepClone(builderDraft);
    else data.tests.unshift(deepClone(builderDraft));
    addActivity("TEST", `${builderDraft.title} ${status === "PUBLISHED" ? "published" : "saved as draft"}`);
    saveData();
    closeModal();
    toast(status === "PUBLISHED" ? "Assessment published" : "Draft saved", `${builderDraft.questions.length} questions · ${getTestTotal(builderDraft)} marks`);
    if (route === "tests" || route === "dashboard") render();
    else go("tests");
  }

  function toggleTestStatus(testId) {
    if (!isAdmin()) return;
    const test = getTest(testId);
    if (!test) return;
    test.status = test.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    test.updatedAt = nowIso();
    addActivity("TEST", `${test.title} ${test.status === "PUBLISHED" ? "published" : "unpublished"}`);
    saveData();
    toast(test.status === "PUBLISHED" ? "Assessment published" : "Assessment unpublished");
    render();
  }

  function duplicateTest(testId) {
    if (!isAdmin()) return;
    const test = getTest(testId);
    if (!test) return;
    const copy = deepClone(test);
    copy.id = uid("test");
    copy.title = `${copy.title} — Copy`;
    copy.status = "DRAFT";
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    copy.questions = copy.questions.map((question) => {
      const newQuestion = { ...question, id: uid("q") };
      if (question.type === "MCQ") {
        const optionMap = {};
        newQuestion.options = question.options.map((option) => {
          const newId = uid("opt");
          optionMap[option.id] = newId;
          return { ...option, id: newId };
        });
        newQuestion.correctOptionId = optionMap[question.correctOptionId];
      }
      return newQuestion;
    });
    data.tests.unshift(copy);
    saveData();
    toast("Assessment duplicated", "The copy was saved as a draft.");
    render();
  }

  function deleteTest(testId) {
    if (!isAdmin()) return;
    const test = getTest(testId);
    if (!test) return;
    const attemptCount = data.attempts.filter((attempt) => attempt.testId === testId).length;
    const historyText = attemptCount
      ? ` This also deletes ${attemptCount} linked submission${attemptCount === 1 ? "" : "s"}, marks, remarks, integrity records, and published results.`
      : "";
    requestConfirm(
      "Permanently delete assessment?",
      `${test.title} will be deleted immediately.${historyText} This cannot be undone.`,
      () => {
        data.tests = data.tests.filter((item) => item.id !== testId);
        data.attempts = data.attempts.filter((attempt) => attempt.testId !== testId);
        addActivity("DELETE", `${test.title} and its linked history were deleted`);
        saveData();
        if (isCloudMode()) syncCloudData(false, true).catch((error) => console.warn("Cloud delete sync failed", error));
        closeModal();
        toast("Assessment deleted", "The assessment and linked submission history were removed.");
        render();
      },
      { danger: true, confirmLabel: "Delete permanently" }
    );
  }

  function requestConfirm(title, message, callback, options = {}) {
    destroyCodeEditors(modalRoot);
    pendingConfirm = callback;
    const confirmClass = options.danger ? "btn-danger" : "btn-primary";
    const confirmLabel = options.confirmLabel || "Confirm";
    modalRoot.innerHTML = `
      <div class="modal-backdrop" onclick="if(event.target===this) AakiJourney.closeModal()">
        <div class="modal confirm-modal ${options.danger ? "confirm-danger" : ""}" role="dialog" aria-modal="true" style="max-width:520px">
          <div class="modal-head"><div><span class="confirm-icon">${options.danger ? "!" : "✓"}</span><h3>${escapeHtml(title)}</h3></div><button class="icon-btn" onclick="AakiJourney.closeModal()">×</button></div>
          <div class="modal-body"><p class="muted" style="margin:0;line-height:1.75">${escapeHtml(message)}</p></div>
          <div class="modal-foot"><button class="btn btn-ghost" onclick="AakiJourney.closeModal()">Cancel</button><button class="btn ${confirmClass}" onclick="AakiJourney.confirmPending()">${escapeHtml(confirmLabel)}</button></div>
        </div>
      </div>
    `;
  }

  function confirmPending() {
    if (typeof pendingConfirm === "function") pendingConfirm();
  }

  function closeModal() {
    destroyCodeEditors(modalRoot);
    pendingConfirm = null;
    modalRoot.innerHTML = "";
  }

  function normaliseImportedTechnology(value, fallback = "HTML") {
    const text = String(value || fallback).trim();
    const aliases = {
      JS: "JavaScript",
      JAVASCRIPT: "JavaScript",
      PY: "Python",
      CPP: "C++",
      "C PLUS PLUS": "C++",
      HTML5: "HTML",
      CSS3: "CSS"
    };
    const alias = aliases[text.toUpperCase()];
    if (alias) return alias;
    return TECHNOLOGIES.find((item) => item.toLowerCase() === text.toLowerCase()) || "Other";
  }

  function normaliseImportedEvaluationMode(value, language, type) {
    const mode = String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
    if (type === "WEB_PROJECT" || ["WEB_PREVIEW", "LIVE_PREVIEW", "WEB_PROJECT"].includes(mode)) return "WEB_PREVIEW";
    if (["TEST_CASES", "TESTCASE", "TEST_CASE", "SOURCE_CODE_TEST_CASES"].includes(mode)) return "TEST_CASES";
    if (["SOURCE_ONLY", "MANUAL", "MANUAL_REVIEW"].includes(mode)) return "SOURCE_ONLY";
    return defaultEvaluationMode(language);
  }

  function normaliseAssessmentJson(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The assessment JSON must contain one JSON object.");
    if (Array.isArray(parsed.tests) || Array.isArray(parsed.attempts) || Array.isArray(parsed.users)) {
      throw new Error("This is a workspace backup. Use Restore entire workspace backup in Settings, not Import assessment JSON.");
    }

    const title = String(parsed.title || "").trim();
    if (!title) throw new Error("Assessment title is required.");
    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (!rawQuestions.length) throw new Error("Add at least one question to the assessment JSON.");

    const questions = rawQuestions.map((rawQuestion, index) => {
      if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
        throw new Error(`Question ${index + 1} must be a JSON object.`);
      }
      const rawType = String(rawQuestion.type || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
      const isMcq = ["MCQ", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE_QUESTION"].includes(rawType);
      const isWebProject = ["WEB_PROJECT", "HTML_PROJECT", "WEB_PREVIEW"].includes(rawType);
      const isCode = isWebProject || ["CODE", "CODING", "PROGRAMMING"].includes(rawType);
      if (!isMcq && !isCode) throw new Error(`Question ${index + 1} has an unsupported type: ${rawQuestion.type || "missing"}.`);

      const prompt = String(rawQuestion.question || rawQuestion.prompt || rawQuestion.title || "").trim();
      if (!prompt) throw new Error(`Question ${index + 1} needs a question, prompt, or title.`);
      const description = String(rawQuestion.description || rawQuestion.instructions || "").trim();
      const imageData = String(rawQuestion.imagePath || rawQuestion.imageData || "").trim();
      const imageAlt = String(rawQuestion.imageAlt || rawQuestion.imageDescription || "").trim();

      if (isMcq) {
        const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
        if (rawOptions.length < 2) throw new Error(`MCQ ${index + 1} requires at least two options.`);
        const options = rawOptions.map((option, optionIndex) => {
          const text = String(typeof option === "string" ? option : option?.text ?? option?.label ?? "").trim();
          if (!text) throw new Error(`MCQ ${index + 1}, option ${optionIndex + 1} is empty.`);
          return { id: uid("opt"), text };
        });
        let correctIndex = Number(rawQuestion.correctOptionIndex);
        if (!Number.isInteger(correctIndex)) {
          const correctText = String(rawQuestion.correctAnswer || "").trim();
          correctIndex = correctText ? options.findIndex((option) => option.text === correctText) : -1;
        }
        if (correctIndex < 0 || correctIndex >= options.length) {
          throw new Error(`MCQ ${index + 1} has an invalid correctOptionIndex. Use a zero-based option index.`);
        }
        return {
          id: uid("q"),
          type: "MCQ",
          prompt,
          description,
          explanation: String(rawQuestion.explanation || "").trim(),
          imageData,
          imageAlt,
          marks: 1,
          options,
          correctOptionId: options[correctIndex].id
        };
      }

      const marks = Number(rawQuestion.marks);
      if (!Number.isFinite(marks) || marks < 5 || marks > 50) {
        throw new Error(`Coding question ${index + 1} must carry between 5 and 50 marks.`);
      }
      const language = normaliseImportedTechnology(rawQuestion.language || parsed.subject || parsed.technology || (isWebProject ? "HTML" : "Other"));
      const evaluationMode = normaliseImportedEvaluationMode(rawQuestion.workspaceMode || rawQuestion.evaluationMode, language, isWebProject ? "WEB_PROJECT" : "CODE");
      const rawStarterFiles = rawQuestion.starterFiles || (typeof rawQuestion.starterCode === "object" ? rawQuestion.starterCode : {});
      const starterFiles = {
        html: String(rawStarterFiles?.html || (evaluationMode === "WEB_PREVIEW" && typeof rawQuestion.starterCode === "string" ? rawQuestion.starterCode : "")),
        css: String(rawStarterFiles?.css || ""),
        javascript: String(rawStarterFiles?.javascript || rawStarterFiles?.js || "")
      };
      const starterCode = evaluationMode === "WEB_PREVIEW" ? "" : String(typeof rawQuestion.starterCode === "string" ? rawQuestion.starterCode : "");
      const rawCases = Array.isArray(rawQuestion.testCases) ? rawQuestion.testCases : [];
      const testCases = rawCases.map((item, caseIndex) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Question ${index + 1}, test case ${caseIndex + 1} must be a JSON object.`);
        const visibilityText = String(item.visibility || "PUBLIC").trim().toUpperCase();
        const visibility = ["PRIVATE", "HIDDEN"].includes(visibilityText) ? "HIDDEN" : "PUBLIC";
        const expectedOutput = String(item.expectedOutput ?? item.output ?? "");
        if (evaluationMode === "TEST_CASES" && !expectedOutput.trim()) {
          throw new Error(`Question ${index + 1}, test case ${caseIndex + 1} requires expectedOutput.`);
        }
        return {
          id: uid("case"),
          visibility,
          input: String(item.input ?? ""),
          expectedOutput,
          note: String(item.explanation || item.note || "")
        };
      });
      if (evaluationMode === "TEST_CASES" && !testCases.length) {
        throw new Error(`Coding question ${index + 1} uses TEST_CASES but contains no test cases.`);
      }
      return {
        id: uid("q"),
        type: "CODE",
        prompt,
        description,
        imageData,
        imageAlt,
        marks: Math.round(marks),
        language,
        evaluationMode,
        starterCode,
        starterFiles,
        testCases
      };
    });

    const totalMarks = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);
    let passPercentage = Number(parsed.passPercentage);
    if (!Number.isFinite(passPercentage) && Number.isFinite(Number(parsed.passingMarks)) && totalMarks > 0) {
      passPercentage = (Number(parsed.passingMarks) / totalMarks) * 100;
    }
    if (!Number.isFinite(passPercentage)) passPercentage = 50;

    let opensAt = null;
    if (parsed.opensAt) {
      const date = new Date(parsed.opensAt);
      if (Number.isNaN(date.getTime())) throw new Error("opensAt must be a valid ISO date and time.");
      opensAt = date.toISOString();
    }
    const durationMinutes = Number(parsed.durationMinutes ?? 45);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 300) {
      throw new Error("durationMinutes must be between 5 and 300.");
    }

    return {
      id: uid("test"),
      title,
      description: String(parsed.description || "Imported assessment").trim(),
      technology: normaliseImportedTechnology(parsed.subject || parsed.technology || questions.find((question) => question.type === "CODE")?.language || "HTML"),
      difficulty: DIFFICULTIES.find((item) => item.toLowerCase() === String(parsed.difficulty || "Beginner").toLowerCase()) || "Beginner",
      durationMinutes: Math.round(durationMinutes),
      passPercentage: clamp(Math.round(passPercentage), 0, 100),
      opensAt,
      instructions: Array.isArray(parsed.instructions) ? parsed.instructions.map((item) => String(item)).join("\n") : String(parsed.instructions || "MCQs allow one confirmed attempt. Coding answers are reviewed manually. Leaving the assessment tab is recorded. Results remain hidden until the complete review is published."),
      status: "DRAFT",
      assignedTo: data.users.filter((user) => user.role === "CANDIDATE").map((user) => user.id),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      questions
    };
  }

  async function importAssessmentJson(event) {
    if (!requireAdmin()) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const assessment = normaliseAssessmentJson(parsed);
      requestConfirm(
        "Import assessment as a new draft?",
        `${assessment.title} contains ${assessment.questions.length} question${assessment.questions.length === 1 ? "" : "s"} and ${getTestTotal(assessment)} marks. It will be added as a new draft. Existing assessments, attempts, reviews, and results will not be changed.`,
        () => {
          data.tests.unshift(assessment);
          addActivity("TEST", `${assessment.title} imported as a draft`);
          saveData();
          closeModal();
          toast("Assessment imported", "The JSON assessment was added as a new draft. Existing data was preserved.");
          render();
        },
        { confirmLabel: "Import as draft" }
      );
    } catch (error) {
      console.error(error);
      toast("Assessment import failed", error.message || "Choose a valid assessment JSON file.");
    }
  }

  function downloadAssessmentTemplate() {
    if (!requireAdmin()) return;
    const template = {
      title: "HTML Basics Test",
      description: "Assessment covering fundamental HTML concepts.",
      subject: "HTML",
      difficulty: "Beginner",
      durationMinutes: 60,
      passingMarks: 12,
      opensAt: "2026-08-05T18:00:00+05:30",
      instructions: [
        "Do not switch tabs during the assessment.",
        "MCQ answers are locked after confirmation.",
        "Submit the assessment before the timer expires."
      ],
      questions: [
        {
          id: "html-mcq-1",
          type: "MCQ",
          question: "Which tag creates the largest heading?",
          marks: 1,
          options: ["<heading>", "<h1>", "<head>", "<title>"],
          correctOptionIndex: 1,
          explanation: "The h1 element represents the highest-level heading.",
          imagePath: ""
        },
        {
          id: "html-code-1",
          type: "WEB_PROJECT",
          title: "Build a Registration Form",
          description: "Create a semantic registration form.",
          marks: 10,
          language: "HTML",
          workspaceMode: "WEB_PREVIEW",
          imagePath: "",
          starterCode: {
            html: "<main>\n\n</main>",
            css: "",
            javascript: ""
          }
        },
        {
          id: "python-code-1",
          type: "CODE",
          title: "Add Two Numbers",
          description: "Read two integers and print their sum.",
          marks: 10,
          language: "Python",
          workspaceMode: "TEST_CASES",
          starterCode: "a = int(input())\nb = int(input())\n",
          testCases: [
            { visibility: "PUBLIC", input: "2\n3", expectedOutput: "5", explanation: "Checks positive integers." },
            { visibility: "PRIVATE", input: "-5\n10", expectedOutput: "5", explanation: "Checks negative input handling." }
          ]
        }
      ]
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "assessment-template.json";
    link.click();
    URL.revokeObjectURL(url);
    toast("Template downloaded", "Edit the JSON file, then import it from Assessment library.");
  }

  function exportData() {
    if (!requireAdmin()) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aakis-developer-journey-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Backup exported", "The JSON file contains the complete private workspace.");
  }

  async function importData(event) {
    if (!requireAdmin()) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (Array.isArray(parsed?.questions) && !Array.isArray(parsed?.tests)) {
        throw new Error("This is an assessment JSON. Import it from Assessment library using Import assessment JSON.");
      }
      const imported = migrateData(parsed, false);
      if (!imported.tests.length && !imported.attempts.length) {
        throw new Error("This backup contains no assessments or attempts, so it was not restored.");
      }
      const importedAdmin = imported.users.find((user) => user.role === "ADMIN");
      const importedCandidate = imported.users.find((user) => user.role === "CANDIDATE");
      if (!importedAdmin || !importedCandidate) throw new Error("Both administrator and candidate accounts are required.");
      requestConfirm(
        "Restore this workspace backup?",
        `This backup contains ${imported.tests.length} assessment${imported.tests.length === 1 ? "" : "s"} and ${imported.attempts.length} attempt${imported.attempts.length === 1 ? "" : "s"}. It will replace the currently loaded workspace.`,
        () => {
          data = imported;
          saveData();
          closeModal();
          toast("Workspace restored", "Tests, attempts, integrity records, marks, and remarks were imported.");
          go("dashboard");
        },
        { danger: true, confirmLabel: "Replace entire workspace" }
      );
    } catch (error) {
      console.error(error);
      toast("Import failed", error.message || "Choose a valid Aaki's Developer Journey JSON backup.");
    }
  }

  function getActiveIntegrityAttempt() {
    if (!isCandidate() || route !== "test_runner") return null;
    const attempt = data.attempts.find((item) => item.id === routeParams.attemptId);
    if (!attempt || attempt.userId !== currentUser.id || attempt.status !== "IN_PROGRESS") return null;
    return attempt;
  }

  function handleVisibilityChange() {
    const attempt = getActiveIntegrityAttempt();
    if (document.hidden) {
      if (!attempt || integrityDeparturePending) return;
      const test = getTest(attempt.testId);
      const question = test?.questions?.[currentQuestionIndex];
      const event = {
        id: uid("integrity"),
        type: "TAB_SWITCH",
        occurredAt: nowIso(),
        questionId: question?.id || null,
        questionIndex: currentQuestionIndex
      };
      attempt.integrityEvents = Array.isArray(attempt.integrityEvents) ? attempt.integrityEvents : [];
      attempt.integrityEvents.push(event);
      attempt.tabSwitchCount = (Number(attempt.tabSwitchCount) || 0) + 1;
      attempt.lastSavedAt = nowIso();
      integrityDeparturePending = true;
      saveData();
      return;
    }

    if (integrityDeparturePending) {
      integrityDeparturePending = false;
      const activeAttempt = getActiveIntegrityAttempt();
      if (!activeAttempt) return;
      const counter = document.getElementById("tab-switch-counter");
      if (counter) counter.textContent = String(activeAttempt.tabSwitchCount || 0);
      toast("Tab switch recorded", "The time and current question are now visible in the administrator’s review.");
      if (activeAttempt.expiresAt) {
        activeAttempt.remainingSeconds = Math.max(0, Math.ceil((new Date(activeAttempt.expiresAt).getTime() - Date.now()) / 1000));
        if (activeAttempt.remainingSeconds <= 0) submitAttempt(activeAttempt.id, true);
      }
    }
  }

  function renderEmpty(title, description, action = "") {
    return `<div class="empty-state"><div class="empty-icon">◇</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${action}</div>`;
  }

  function render() {
    clearTimer();
    destroyCodeEditors(app);
    applyPalette();

    if (currentUser && !getUser(currentUser.id)) currentUser = null;
    if (!currentUser) {
      renderLogin();
      return;
    }

    if (route === "assessment_details") return isCandidate() ? renderAssessmentDetails(routeParams.testId) : go("dashboard");
    if (route === "test_runner") return isCandidate() ? renderTestRunner(routeParams.attemptId) : go("dashboard");
    if (route === "review") return isAdmin() ? renderReview(routeParams.attemptId) : go("dashboard");
    if (route === "result_detail") return renderResultDetail(routeParams.attemptId);

    if (isAdmin()) {
      if (route === "dashboard") return renderAdminDashboard();
      if (route === "tests") return renderAdminTests();
      if (route === "submissions") return renderSubmissions();
      if (route === "progress") return renderProgressPage();
      if (route === "settings") return renderSettings();
      return go("dashboard");
    }

    if (route === "dashboard") return renderCandidateDashboard();
    if (route === "assessments") return renderCandidateAssessments();
    if (route === "results") return renderCandidateResults();
    if (route === "progress") return renderProgressPage();
    if (route === "settings") return renderSettings();
    return go("dashboard");
  }

  window.AakiJourney = {
    login,
    logout,
    togglePassword,
    toggleTheme,
    toggleSidebar: () => { sidebarOpen = !sidebarOpen; render(); },
    go,
    openAssessment,
    startAttempt,
    continueAttempt,
    showUnderReview,
    jumpQuestion,
    previousQuestion,
    nextQuestion,
    selectMcq,
    confirmMcq,
    updateCode,
    setWebFileTab,
    setFocusCodeFileTab,
    openCodeEditorOverlay,
    openPreviewOverlay,
    resetCode,
    requestSubmit,
    openReview,
    updateQuestionReview,
    updateTestCaseReview,
    updateOverallReview,
    saveReview,
    requestPublishResult,
    viewResult,
    openTestBuilder,
    updateBuilderField,
    updateBuilderDateTime,
    addBuilderQuestion,
    removeBuilderQuestion,
    updateBuilderQuestion,
    updateBuilderStarterFile,
    addBuilderTestCase,
    updateBuilderTestCase,
    removeBuilderTestCase,
    addBuilderOption,
    removeBuilderOption,
    updateBuilderOption,
    setCorrectOption,
    saveBuilder,
    toggleTestStatus,
    duplicateTest,
    deleteTest,
    requestConfirm,
    confirmPending,
    closeModal,
    exportData,
    importData,
    importAssessmentJson,
    downloadAssessmentTemplate,
    refreshCloudData,
    updateAwardedMarks,
    runQuestionTests,
    updateProfilePath,
    updateLogoPath,
    removeProfileImage,
    setPalette,
    updateQuestionImagePath,
    removeQuestionImage
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("beforeunload", () => {
    const attempt = getActiveIntegrityAttempt();
    if (attempt) saveData();
  });

  async function boot() {
    applyUserAppearance();
    await restoreSession();
    applyUserAppearance();
    render();
  }

  boot();
})();
