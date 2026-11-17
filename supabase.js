import { supabaseConfig } from "./supabase-config.js";

const isConfigured = Boolean(
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  !supabaseConfig.url.includes("YOUR_") &&
  !supabaseConfig.anonKey.includes("YOUR_")
);

function createCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(12));
  const parts = Array.from(values, value => alphabet[value % alphabet.length]);
  return `${parts.slice(0, 4).join("")}-${parts.slice(4, 8).join("")}-${parts.slice(8).join("")}`;
}

function localSessionKey() {
  return "our-date-quiz-sessions";
}

function readLocalSessions() {
  const saved = localStorage.getItem(localSessionKey());
  if (!saved) return [];
  try {
    const sessions = JSON.parse(saved);
    if (!Array.isArray(sessions)) throw new Error("Saved date quiz sessions are not in the expected format.");
    return sessions;
  } catch (error) {
    throw new Error(`Couldn't read saved date quizzes: ${error.message}`);
  }
}

function writeLocalSessions(sessions) {
  localStorage.setItem(localSessionKey(), JSON.stringify(sessions));
}

export async function createSessionStore() {
  if (!isConfigured) return createLocalStore();

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const client = createClient(supabaseConfig.url, supabaseConfig.anonKey);
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error(`Supabase sign-in check failed: ${sessionError.message}`);
  if (!sessionData.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`Supabase anonymous sign-in failed. Enable anonymous sign-ins in Supabase Auth: ${error.message}`);
  }
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error(`Couldn't identify this quiz participant: ${userError?.message || "no user returned"}`);
  return createRemoteStore(client, userData.user.id);
}

function createLocalStore() {
  return {
    mode: "demo",
    async create() {
      const session = {
        id: crypto.randomUUID(),
        code: createCode(),
        createdAt: new Date().toISOString(),
        participants: 1,
        submittedUsers: [],
        answers: {}
      };
      const sessions = readLocalSessions();
      sessions.push(session);
      writeLocalSessions(sessions);
      return localState(session, 1);
    },
    async join(code) {
      const sessions = readLocalSessions();
      const session = sessions.find(item => item.code.toUpperCase() === code.trim().toUpperCase());
      if (!session) throw new Error("We couldn't find that session code in this browser. Check the code or configure Supabase to join across devices.");
      if (session.participants >= 2 && !session.answers.person2) throw new Error("Both places in this demo session are already taken.");
      session.participants = 2;
      writeLocalSessions(sessions);
      return localState(session, 2);
    },
    async restore(id, person) {
      const session = readLocalSessions().find(item => item.id === id);
      if (!session) return null;
      return localState(session, person);
    },
    async save(sessionId, person, answers) {
      const sessions = readLocalSessions();
      const session = sessions.find(item => item.id === sessionId);
      if (!session) throw new Error("This date quiz session no longer exists in this browser.");
      session.answers[`person${person}`] = answers;
      if (!session.submittedUsers.includes(person)) session.submittedUsers.push(person);
      writeLocalSessions(sessions);
      return localState(session, person);
    },
    async reopen(sessionId, person) {
      const sessions = readLocalSessions();
      const session = sessions.find(item => item.id === sessionId);
      if (!session) throw new Error("This date quiz session no longer exists in this browser.");
      session.submittedUsers = session.submittedUsers.filter(submittedPerson => submittedPerson !== person);
      writeLocalSessions(sessions);
      return localState(session, person);
    },
    async getRecent() {
      return readLocalSessions()
        .filter(session => session.completedAt && session.chosenActivity)
        .slice(-3)
        .reverse()
        .map(session => ({ date: session.completedAt, activity: session.chosenActivity }));
    },
    async finish(id, person, activityId, activityName) {
      const sessions = readLocalSessions();
      const session = sessions.find(item => item.id === id);
      if (!session) throw new Error("This date quiz session no longer exists.");
      session.completedAt = new Date().toISOString();
      session.chosenActivity = activityName;
      session.chosenActivityId = activityId;
      writeLocalSessions(sessions);
      return localState(session, person);
    }
  };
}

function localState(session, person) {
  const submittedPeople = session.submittedUsers || Object.keys(session.answers).map(key => Number(key.slice(-1)));
  return {
    id: session.id,
    code: session.code,
    person,
    mode: "demo",
    submittedCount: submittedPeople.length,
    myAnswers: session.answers[`person${person}`] || null,
    answers: session.answers.person1 && session.answers.person2
      ? { person1: session.answers.person1, person2: session.answers.person2 }
      : null,
    chosenActivityId: session.chosenActivityId || null
  };
}

function createRemoteStore(client, userId) {
  async function load(id) {
    const { data: session, error } = await client.from("date_sessions").select("id, code, participant_one, participant_two, submitted_users, chosen_activity_id").eq("id", id).single();
    if (error) throw new Error(`Couldn't load the shared quiz: ${error.message}`);
    const person = session.participant_one === userId ? 1 : session.participant_two === userId ? 2 : null;
    if (!person) throw new Error("This browser is not a participant in that quiz session.");
    const submittedUsers = session.submitted_users || [];
    let answers = null;
    let myAnswers = null;
    const { data: savedAnswers, error: ownError } = await client.rpc("get_my_date_answers", { p_session_id: id });
    if (ownError) throw new Error(`Couldn't load your saved answers: ${ownError.message}`);
    myAnswers = savedAnswers || null;
    if (submittedUsers.length >= 2) {
      const { data, error: answersError } = await client.from("date_submissions").select("user_id, answers").eq("session_id", id);
      if (answersError) throw new Error(`Couldn't load the shared results: ${answersError.message}`);
      answers = {};
      for (const submission of data || []) {
        const slot = submission.user_id === session.participant_one ? "person1" : "person2";
        answers[slot] = submission.answers;
      }
    }
    return { id: session.id, code: session.code, person, mode: "shared", submittedCount: submittedUsers.length, myAnswers, answers, chosenActivityId: session.chosen_activity_id };
  }

  return {
    mode: "shared",
    async create() {
      const { data, error } = await client.from("date_sessions").insert({ code: createCode(), participant_one: userId }).select("id").single();
      if (error) throw new Error(`Couldn't create a shared quiz: ${error.message}`);
      return load(data.id);
    },
    async join(code) {
      const { data, error } = await client.rpc("join_date_session", { p_code: code.trim().toUpperCase() });
      if (error) throw new Error(`Couldn't join that quiz: ${error.message}`);
      return load(data);
    },
    restore: load,
    async save(sessionId, person, answers) {
      const { error } = await client.rpc("submit_date_answers", { p_session_id: sessionId, p_answers: answers });
      if (error) throw new Error(`Couldn't save your answers: ${error.message}`);
      return load(sessionId);
    },
    async reopen(sessionId) {
      const { error } = await client.rpc("reopen_date_answers", { p_session_id: sessionId });
      if (error) throw new Error(`Couldn't reopen your answers: ${error.message}`);
      return load(sessionId);
    },
    async getRecent() {
      const { data, error } = await client.from("date_sessions").select("completed_at, chosen_activity_name").not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(3);
      if (error) throw new Error(`Couldn't load your date journal: ${error.message}`);
      return (data || []).map(item => ({ date: item.completed_at, activity: item.chosen_activity_name }));
    },
    async finish(sessionId, activityId, activityName) {
      const { error } = await client.rpc("record_completed_date", {
        p_session_id: sessionId,
        p_activity_id: activityId,
        p_activity_name: activityName
      });
      if (error) throw new Error(`Couldn't save your date to the journal: ${error.message}`);
      return load(sessionId);
    },
  };
}
