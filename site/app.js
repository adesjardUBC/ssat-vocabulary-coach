const app = document.querySelector("#app");
if (!app) throw new Error("App root not found.");

let vocabulary = [];
let sessionWords = [];
let studyIndex = 0;
let quizWords = [];
let quizIndex = 0;
let score = 0;
let missedWords = [];
let currentMeaning = null;
let currentOptions = [];
let deferredInstallPrompt = null;

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function sample(items, count) { return shuffle(items).slice(0, count); }
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function shell(content, showHome = true) {
  return `<main class="app-shell"><header class="topbar"><div class="brand"><div class="brand-mark" aria-hidden="true">V</div><span>SSAT Vocabulary Coach</span></div>${showHome ? '<button class="icon-btn" id="home-button" type="button">Home</button>' : ""}</header><section class="card main-card">${content}</section><div class="footer-note">Vocabulary is loaded from the workbook stored with this site.</div></main>`;
}
function bindHomeButton() { document.querySelector("#home-button")?.addEventListener("click", renderHome); }
function progressMarkup(current, total) {
  const percentage = total === 0 ? 0 : Math.round((current / total) * 100);
  return `<div class="progress-row" aria-label="Progress: ${current} of ${total}"><div class="progress-track"><div class="progress-fill" style="width:${percentage}%"></div></div><div class="progress-label">${current} of ${total}</div></div>`;
}

function showSessionDialog() {
  document.querySelector(".modal-backdrop")?.remove();
  const remembered = Number(localStorage.getItem("preferredWordCount"));
  const suggested = Number.isFinite(remembered) && remembered >= 1 ? Math.min(remembered, vocabulary.length) : Math.min(20, vocabulary.length);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="session-title"><h2 id="session-title">Choose your word set</h2><p class="lead">How many words would you like to review this session?</p><form id="session-form"><div class="number-field"><label for="word-count">Number of words (1-${vocabulary.length})</label><input id="word-count" name="word-count" type="number" min="1" max="${vocabulary.length}" value="${suggested}" inputmode="numeric" required></div><button class="btn btn-primary" type="submit">Start session</button></form></div>`;
  document.body.append(overlay);
  const input = overlay.querySelector("#word-count");
  input?.focus(); input?.select();
  overlay.querySelector("#session-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const requested = Math.trunc(Number(input?.value));
    if (!Number.isFinite(requested) || requested < 1 || requested > vocabulary.length) {
      input?.setCustomValidity(`Please enter a number from 1 to ${vocabulary.length}.`); input?.reportValidity(); return;
    }
    input?.setCustomValidity("");
    localStorage.setItem("preferredWordCount", String(requested));
    sessionWords = sample(vocabulary, requested);
    overlay.remove();
    renderHome();
  });
}

function renderHome() {
  const wordCount = sessionWords.length;
  const installButton = deferredInstallPrompt ? '<button class="btn btn-quiet" id="install-button" type="button">Install app</button>' : "";
  app.innerHTML = shell(`<div class="hero"><h1>SSAT Vocabulary Coach</h1><p class="lead">Learn definitions in context, then test yourself with randomized four-choice questions.</p><div class="session-summary">${wordCount} ${wordCount === 1 ? "word" : "words"} selected for this session</div><div class="button-grid"><button class="btn btn-primary" id="study-button" type="button">Study words</button><button class="btn btn-primary" id="quiz-button" type="button">Start quiz</button><button class="btn btn-secondary" id="new-set-button" type="button">Choose a new word set</button>${installButton}</div></div>`, false);
  document.querySelector("#study-button")?.addEventListener("click", () => { studyIndex = 0; renderStudy(); });
  document.querySelector("#quiz-button")?.addEventListener("click", () => startQuiz(sessionWords));
  document.querySelector("#new-set-button")?.addEventListener("click", showSessionDialog);
  document.querySelector("#install-button")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; renderHome();
  });
}

function renderStudy() {
  const entry = sessionWords[studyIndex];
  if (!entry) { renderHome(); return; }
  const meanings = entry.meanings.map((meaning, index) => `<article class="meaning-card"><div class="meaning-number">Meaning ${index + 1}</div><div class="meaning-definition">${escapeHtml(meaning.definition)}</div>${meaning.example ? `<p class="example">${escapeHtml(meaning.example)}</p>` : ""}</article>`).join("");
  app.innerHTML = shell(`${progressMarkup(studyIndex + 1, sessionWords.length)}<div class="study-content"><div class="question-label">Study this word</div><h2 class="word-display">${escapeHtml(entry.word)}</h2><div class="meaning-list">${meanings}</div><div class="study-nav"><button class="btn btn-secondary" id="previous-word" type="button" ${studyIndex === 0 ? "disabled" : ""}>Previous</button><button class="btn btn-primary" id="next-word" type="button">${studyIndex === sessionWords.length - 1 ? "Finish" : "Next word"}</button><button class="btn btn-quiet" id="start-quiz-here" type="button">Start quiz</button></div></div>`);
  bindHomeButton();
  document.querySelector("#previous-word")?.addEventListener("click", () => { studyIndex = Math.max(0, studyIndex - 1); renderStudy(); });
  document.querySelector("#next-word")?.addEventListener("click", () => { if (studyIndex >= sessionWords.length - 1) renderHome(); else { studyIndex += 1; renderStudy(); } });
  document.querySelector("#start-quiz-here")?.addEventListener("click", () => startQuiz(sessionWords));
}

function startQuiz(words) { quizWords = shuffle(words); quizIndex = 0; score = 0; missedWords = []; renderQuizQuestion(); }
function renderQuizQuestion() {
  const entry = quizWords[quizIndex];
  if (!entry) { renderResults(); return; }
  currentMeaning = entry.meanings[Math.floor(Math.random() * entry.meanings.length)];
  currentOptions = shuffle([currentMeaning.definition, ...sample(entry.distractors, 3)]);
  app.innerHTML = shell(`${progressMarkup(quizIndex + 1, quizWords.length)}<div class="question-label">Which meaning matches this word?</div><h2 class="word-display">${escapeHtml(entry.word)}</h2><div class="answers" id="answers">${currentOptions.map((option, index) => `<button class="answer-btn" type="button" data-answer-index="${index}">${escapeHtml(option)}</button>`).join("")}</div><div id="feedback-area" aria-live="polite"></div>`);
  bindHomeButton();
  document.querySelectorAll(".answer-btn").forEach((button) => button.addEventListener("click", () => handleAnswer(Number(button.dataset.answerIndex))));
}

function handleAnswer(selectedIndex) {
  const entry = quizWords[quizIndex];
  if (!entry || !currentMeaning) return;
  const selectedAnswer = currentOptions[selectedIndex];
  const correctAnswer = currentMeaning.definition;
  const isCorrect = selectedAnswer === correctAnswer;
  if (isCorrect) score += 1; else if (!missedWords.some((item) => item.word === entry.word)) missedWords.push(entry);
  document.querySelectorAll(".answer-btn").forEach((button, index) => {
    button.disabled = true;
    const option = currentOptions[index];
    if (option === correctAnswer) button.classList.add("correct");
    if (index === selectedIndex && option !== correctAnswer) button.classList.add("incorrect");
  });
  const feedbackArea = document.querySelector("#feedback-area");
  if (!feedbackArea) return;
  feedbackArea.innerHTML = `<div class="feedback ${isCorrect ? "correct" : "incorrect"}"><div class="feedback-title">${isCorrect ? "Correct!" : "Not quite."} One meaning of ${escapeHtml(entry.word)} is: ${escapeHtml(correctAnswer)}</div>${currentMeaning.example ? `<p class="example">${escapeHtml(currentMeaning.example)}</p>` : ""}</div><div class="next-row"><button class="btn btn-primary" id="next-question" type="button">${quizIndex === quizWords.length - 1 ? "See results" : "Next question"}</button></div>`;
  document.querySelector("#next-question")?.focus();
  document.querySelector("#next-question")?.addEventListener("click", () => { quizIndex += 1; renderQuizQuestion(); });
}

function renderResults() {
  const total = quizWords.length;
  const percentage = total === 0 ? 0 : Math.round((score / total) * 100);
  localStorage.setItem("completedSessions", String(Number(localStorage.getItem("completedSessions") || "0") + 1));
  localStorage.setItem("lastScore", `${score}/${total}`);
  app.innerHTML = shell(`<div class="hero"><h2>Quiz complete</h2><div class="score-ring" style="--score-angle:${percentage * 3.6}deg"><div class="score-value">${percentage}%<small>${score} of ${total} correct</small></div></div><p class="lead">${missedWords.length === 0 ? "Excellent—every answer was correct." : `You have ${missedWords.length} ${missedWords.length === 1 ? "word" : "words"} to revisit.`}</p><div class="button-grid">${missedWords.length > 0 ? '<button class="btn btn-primary" id="retry-missed" type="button">Retry missed words</button>' : ""}<button class="btn btn-secondary" id="quiz-again" type="button">Quiz this set again</button><button class="btn btn-quiet" id="study-again" type="button">Return to Study mode</button><button class="btn btn-quiet" id="results-home" type="button">Home</button></div></div>`);
  bindHomeButton();
  document.querySelector("#retry-missed")?.addEventListener("click", () => startQuiz(missedWords));
  document.querySelector("#quiz-again")?.addEventListener("click", () => startQuiz(sessionWords));
  document.querySelector("#study-again")?.addEventListener("click", () => { studyIndex = 0; renderStudy(); });
  document.querySelector("#results-home")?.addEventListener("click", renderHome);
}

function renderLoading() { app.innerHTML = shell('<div class="hero"><h1>SSAT Vocabulary Coach</h1><p class="lead">Loading vocabulary…</p></div>', false); }
function renderError(message) { app.innerHTML = shell(`<div class="error-panel"><h2>Unable to load the vocabulary</h2><p class="lead">${escapeHtml(message)}</p><p>Check that the latest site deployment completed successfully and that <strong>data/vocabulary_words.xlsx</strong> follows the expected format.</p></div>`, false); }
async function loadVocabulary() {
  renderLoading();
  try {
    const response = await fetch("./vocabulary.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Vocabulary request failed with status ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload.entries) || payload.entries.length === 0) throw new Error("The generated vocabulary data is empty.");
    vocabulary = payload.entries; sessionWords = []; renderHome(); showSessionDialog();
  } catch (error) { renderError(error instanceof Error ? error.message : "An unknown error occurred."); }
}

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; if (sessionWords.length > 0) renderHome(); });
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; });
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => console.warn("Service worker registration failed:", error)));
}
loadVocabulary();
