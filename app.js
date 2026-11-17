import { activities } from "./activities.js";
import { answersAreComplete, quizOptions, quizQuestions, rankActivities } from "./matching.js";
import { createSessionStore } from "./supabase.js";

const $ = selector => document.querySelector(selector);
const views = [...document.querySelectorAll("[data-view]")];
const activeSessionKey = "our-date-quiz-active";
const questionSymbols = {
  weather: "☀︎ / ☂",
  time: "◷",
  energy: "⚡",
  vibe: "✧",
  budget: "$"
};
let store;
let session;
let answers = {};
let questionIndex = 0;
let resultsData;

function showView(name) {
  for (const view of views) view.hidden = view.dataset.view !== name;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setError(error) {
  $("#error-message").textContent = error.message || String(error);
  showView("error");
}

function saveActiveSession() {
  if (!session) return;
  localStorage.setItem(activeSessionKey, JSON.stringify({ id: session.id, person: session.person, code: session.code }));
}

function setSession(nextSession) {
  session = nextSession;
  saveActiveSession();
}

function inviteUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("code", session.code);
  return url.toString();
}

function initializeQuiz(existingAnswers) {
  clearTimeout(pollTimer);
  answers = Object.fromEntries(quizQuestions.map(question => [question.key, [...(existingAnswers?.[question.key] || [])]]));
  questionIndex = 0;
  renderQuestion();
  showView("quiz");
}

function renderQuestion() {
  const question = quizQuestions[questionIndex];
  const options = quizOptions[question.key];
  const selected = answers[question.key] || [];
  $("#question-number").textContent = `QUESTION ${questionIndex + 1} OF ${quizQuestions.length}`;
  $("#question-progress").textContent = `${Math.round(((questionIndex + 1) / quizQuestions.length) * 100)}%`;
  $("#progress-fill").style.width = `${((questionIndex + 1) / quizQuestions.length) * 100}%`;
  $("#question-kicker").textContent = question.kicker;
  $("#question-title").textContent = question.title;
  $(".question-help").textContent = "Choose all that sound good.";
  $("#question-symbol").textContent = questionSymbols[question.key];
  $("#person-label").textContent = "YOUR TURN";
  $("#session-code").textContent = session.code;
  $("#share-hint").textContent = session.mode === "demo"
    ? "Demo mode only works in this browser. Add Supabase if we want to use separate phones."
    : "Send this link or code to your person. No peeking at each other's picks.";
  $("#answer-grid").innerHTML = "";
  for (const option of options) {
    const label = document.createElement("label");
    const isSelected = selected.includes(option);
    label.className = `answer-card${isSelected ? " selected" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.className = "answer-checkbox";
    checkbox.type = "checkbox";
    checkbox.checked = isSelected;
    checkbox.addEventListener("change", () => toggleAnswer(question.key, option));
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    checkmark.setAttribute("aria-hidden", "true");
    checkmark.textContent = "✓";
    const text = document.createElement("span");
    text.textContent = option;
    label.append(checkbox, checkmark, text);
    $("#answer-grid").append(label);
  }
  $("#back-button").disabled = questionIndex === 0;
  $("#next-button").innerHTML = questionIndex === quizQuestions.length - 1
    ? 'See our ideas <span aria-hidden="true">→</span>'
    : 'Next <span aria-hidden="true">→</span>';
  $("#quiz-validation").textContent = selected.length ? "" : "Pick at least one first.";
}

function toggleAnswer(key, option) {
  const selected = answers[key];
  answers[key] = selected.includes(option) ? selected.filter(value => value !== option) : [...selected, option];
  renderQuestion();
}

async function submitAnswers() {
  if (!answersAreComplete(answers)) {
    $("#quiz-validation").textContent = "Pick something for every question before you send it.";
    return;
  }
  $("#next-button").disabled = true;
  try {
    setSession(await store.save(session.id, session.person, answers));
    if (session.answers) renderResults();
    else renderWaiting();
  } catch (error) {
    setError(error);
  } finally {
    $("#next-button").disabled = false;
  }
}

function renderWaiting() {
  showView("waiting");
  $("#waiting-code").textContent = session.code;
  $("#waiting-count").textContent = session.submittedCount >= 2
    ? "We're both done"
    : session.submittedCount === 1
      ? "One of us is done"
      : "Neither of us is done";
  $("#waiting-message").textContent = session.submittedCount >= 2
    ? "Both sets of answers are in. Here we go."
    : "Your answers stay private until we're both done. No peeking. We'll show the ideas when the other person has finished.";
  $(".waiting-progress .waiting-dot:last-child").classList.toggle("done", session.submittedCount >= 2);
  $(".demo-second-button").hidden = session.mode !== "demo" || session.person !== 1 || session.submittedCount >= 2;
  $(".waiting-code .button").textContent = session.mode === "demo" ? "Copy session code" : "Copy invite link";
  $("#demo-hint").textContent = session.mode === "demo"
    ? "For the demo, take turns in this browser. Choose “Continue as Person 2” to try the other set."
    : "We'll check in while the other person finishes.";
  if (session.mode === "shared" && session.submittedCount < 2) pollForPartner();
}

let pollTimer;
function pollForPartner() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!session || session.mode !== "shared" || session.answers) return;
    try {
      setSession(await store.restore(session.id));
      if (session.answers) renderResults();
      else renderWaiting();
    } catch (error) {
      setError(error);
    }
  }, 4000);
}

function renderResults() {
  clearTimeout(pollTimer);
  resultsData = rankActivities(activities, session.answers.person1, session.answers.person2);
  $("#match-count").textContent = `${resultsData.ranked.length} ${resultsData.ranked.length === 1 ? "idea" : "ideas"} for us`;
  $("#activity-grid").replaceChildren(...resultsData.ranked.map((result, index) => createActivityCard(result, index)));
  $("#empty-results").hidden = resultsData.ranked.length > 0;
  $("#activity-grid").hidden = resultsData.ranked.length === 0;
  $("#eliminated-count").textContent = `${resultsData.eliminated.length} ${resultsData.eliminated.length === 1 ? "activity" : "activities"}`;
  $("#eliminated-list").replaceChildren(...resultsData.eliminated.map(({ activity, reasons }) => {
    const item = document.createElement("div");
    item.className = "eliminated-item";
    const title = document.createElement("strong");
    title.textContent = activity.name;
    const details = document.createElement("p");
    details.textContent = reasons.join(" ");
    item.append(title, details);
    return item;
  }));
  showView("results");
}

function createActivityCard(result, index) {
  const { activity, score, agreement, reasons, compromises } = result;
  const card = document.createElement("article");
  card.className = "activity-card";
  card.style.animationDelay = `${Math.min(index, 7) * 45}ms`;
  const visual = document.createElement("div");
  visual.className = "activity-visual";
  const emoji = document.createElement("span");
  emoji.className = "activity-emoji";
  emoji.setAttribute("aria-hidden", "true");
  emoji.textContent = activity.image || "♡";
  const badge = document.createElement("span");
  badge.className = "match-badge";
  badge.textContent = `${score}% match`;
  visual.append(emoji, badge);
  const body = document.createElement("div");
  body.className = "activity-body";
  const titleRow = document.createElement("div");
  titleRow.className = "activity-title-row";
  const title = document.createElement("h2");
  title.textContent = activity.name;
  const agreementLabel = document.createElement("span");
  agreementLabel.className = "agreement";
  agreementLabel.textContent = agreement;
  titleRow.append(title, agreementLabel);
  const description = document.createElement("p");
  description.className = "activity-description";
  description.textContent = activity.description;
  const facts = document.createElement("div");
  facts.className = "activity-facts";
  for (const text of [`At least ${formatDuration(activity.minDuration)}`, `Est. $${activity.minBudget} minimum`]) {
    const pill = document.createElement("span");
    pill.className = "fact-pill";
    pill.textContent = text;
    facts.append(pill);
  }
  const reasonBlock = document.createElement("div");
  reasonBlock.className = "reason-block";
  const reasonTitle = document.createElement("strong");
  reasonTitle.textContent = "WHY THIS ONE";
  const reason = document.createElement("p");
  reason.textContent = reasons;
  reasonBlock.append(reasonTitle, reason);
  if (compromises.length) {
    const note = document.createElement("p");
    note.className = "compromise";
    note.textContent = `A little compromise: ${compromises.join(" ")}`;
    reasonBlock.append(note);
  }
  const recordButton = document.createElement("button");
  recordButton.type = "button";
  recordButton.className = "record-date-button";
  recordButton.dataset.action = "record-date";
  recordButton.dataset.activityId = activity.id;
  recordButton.dataset.activityName = activity.name;
  recordButton.textContent = session.chosenActivityId === activity.id ? "Added to your date journal ✓" : "We did this!";
  recordButton.disabled = session.chosenActivityId === activity.id;
  body.append(titleRow, description, facts, reasonBlock, recordButton);
  card.append(visual, body);
  return card;
}

function formatDuration(minutes) {
  if (minutes >= 1440) return "1 full day";
  if (minutes >= 60) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} minutes`;
}

async function createQuiz() {
  setSession(await store.create());
  initializeQuiz();
}

async function joinQuiz(code) {
  if (!code.trim()) throw new Error("Enter the code your person sent.");
  setSession(await store.join(code));
  initializeQuiz(session.myAnswers);
}

async function copyInvite() {
  const text = session.mode === "shared" ? inviteUrl() : `Session code: ${session.code}`;
  await navigator.clipboard.writeText(text);
  $("#share-hint").textContent = session.mode === "demo"
    ? "Code copied. It only works in this browser."
    : "Invite copied. Send it to your person.";
}

function renderSurprise() {
  if (!resultsData?.ranked.length) {
    $("#surprise-message").textContent = "Nothing works with those picks. Change an answer and we'll try again.";
    return;
  }
  const bestScore = resultsData.ranked[0].score;
  const topMatches = resultsData.ranked.filter(result => result.score >= bestScore - 5);
  const choice = topMatches[Math.floor(Math.random() * topMatches.length)];
  $("#surprise-message").textContent = `How about ${choice.activity.name}?`;
  document.querySelectorAll(".activity-card").forEach(card => card.classList.remove("surprise-pick"));
  const pickedCard = [...document.querySelectorAll(".activity-card")].find(card => card.querySelector("h2")?.textContent === choice.activity.name);
  if (pickedCard) {
    pickedCard.classList.add("surprise-pick");
    pickedCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function showRecentDates() {
  const recent = await store.getRecent();
  $("#recent-count").textContent = `${recent.length} ${recent.length === 1 ? "date" : "dates"}`;
  const container = $("#recent-dates");
  if (!recent.length) {
    container.className = "recent-card";
    container.innerHTML = '<span class="recent-icon" aria-hidden="true">♡</span><p>No dates in the journal yet.<br><span>Mark one “We did this!” after we go, and it’ll show up here.</span></p>';
    return;
  }
  container.className = "recent-list";
  container.replaceChildren(...recent.map(entry => {
    const item = document.createElement("div");
    item.className = "recent-item";
    const title = document.createElement("strong");
    title.textContent = entry.activity;
    const date = document.createElement("span");
    date.textContent = new Date(entry.date).toLocaleDateString();
    item.append(title, date);
    return item;
  }));
}

document.addEventListener("click", async event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  try {
    if (action === "home") showView("home");
    if (action === "create") await createQuiz();
    if (action === "copy-link") await copyInvite();
    if (action === "back" && questionIndex > 0) { questionIndex--; renderQuestion(); }
    if (action === "next") {
      if (!answers[quizQuestions[questionIndex].key]?.length) {
        $("#quiz-validation").textContent = "Pick at least one first.";
      } else if (questionIndex < quizQuestions.length - 1) {
        questionIndex++;
        renderQuestion();
      } else await submitAnswers();
    }
    if (action === "edit-answers") {
      setSession(await store.reopen(session.id, session.person));
      initializeQuiz(session.myAnswers);
    }
    if (action === "demo-second") {
      setSession(await store.join(session.code));
      initializeQuiz(session.myAnswers);
    }
    if (action === "new-quiz") {
      localStorage.removeItem(activeSessionKey);
      session = null;
      window.history.replaceState({}, "", window.location.pathname);
      showView("home");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (action === "surprise") renderSurprise();
    if (action === "record-date") {
      const button = event.target.closest("[data-action='record-date']");
      setSession(await store.finish(session.id, session.person, button.dataset.activityId, button.dataset.activityName));
      button.textContent = "Added to your date journal ✓";
      button.disabled = true;
      await showRecentDates();
    }
  } catch (error) {
    setError(error);
  }
});

$("#join-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await joinQuiz(new FormData(event.currentTarget).get("code"));
  } catch (error) {
    setError(error);
  }
});

async function startApp() {
  try {
    store = await createSessionStore();
    $("#mode-note").textContent = store.mode === "demo"
      ? "Demo mode is on. We can take turns in this browser."
      : "Shared sessions are ready. Send the link to your person.";
    await showRecentDates();
    const codeInUrl = new URLSearchParams(window.location.search).get("code");
    const saved = localStorage.getItem(activeSessionKey);
    if (saved) {
      let active;
      try { active = JSON.parse(saved); } catch { localStorage.removeItem(activeSessionKey); }
      if (active && (!codeInUrl || active.code.toUpperCase() === codeInUrl.toUpperCase())) {
        session = await store.restore(active.id, active.person);
      }
    }
    if (!session && codeInUrl) setSession(await store.join(codeInUrl));
    if (session?.answers) renderResults();
    else if (session?.myAnswers) renderWaiting();
    else if (session?.id) initializeQuiz(session.myAnswers);
  } catch (error) {
    setError(error);
  }
}

startApp();
