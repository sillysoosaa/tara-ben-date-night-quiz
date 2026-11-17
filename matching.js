const energyLevels = { None: 0, Little: 1, Medium: 2, Lots: 3 };
const timeDurations = {
  "Under an hour": 59,
  "1–2 hours": 120,
  "3–6 hours": 360,
  "1 day": 1440
};
const budgets = { "$0": 0, "$25": 25, "$50": 50, "$100+": 100 };

function getIneligibilityReasons(activity, answers, personNumber) {
  const prefix = `Person ${personNumber}`;
  const reasons = [];
  const weather = answers.weather || [];
  const time = answers.time || [];
  const energy = answers.energy || [];
  const budget = answers.budget || [];

  if (!activity.weather.some(option => weather.includes(option))) {
    reasons.push(weather.length
      ? `${prefix} picked ${weather.join(" or ")} weather. This one needs ${activity.weather.join(" or ")}.`
      : `${prefix} didn't pick a weather. This one needs ${activity.weather.join(" or ")}.`);
  }
  if (!time.some(option => timeDurations[option] >= activity.minDuration)) {
    reasons.push(`${prefix}'s time window isn't long enough. This one takes at least ${formatDuration(activity.minDuration)}.`);
  }
  if (!energy.some(option => energyLevels[option] >= activity.minEnergy)) {
    reasons.push(`${prefix}'s energy level isn't quite enough. This one needs at least ${energyName(activity.minEnergy)}.`);
  }
  if (!budget.some(option => budgets[option] >= activity.minBudget)) {
    const maximumBudget = Math.max(-1, ...budget.map(option => budgets[option] ?? -1));
    const budgetCap = maximumBudget < 0 ? "hasn't picked a high enough budget" : `tops out at $${maximumBudget}`;
    reasons.push(`${prefix}'s budget ${budgetCap}. This one needs about $${activity.minBudget}.`);
  }
  return reasons;
}

function formatDuration(minutes) {
  if (minutes >= 1440) return "full day";
  if (minutes >= 60) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function energyName(level) {
  return Object.keys(energyLevels).find(name => energyLevels[name] === level) || "unknown";
}

function vibeCoverage(personVibes, activityVibes) {
  if (!personVibes.length) return 0.5;
  return personVibes.filter(vibe => activityVibes.includes(vibe)).length / personVibes.length;
}

function scoreActivity(activity, first, second) {
  const firstVibes = first.vibe || [];
  const secondVibes = second.vibe || [];
  const firstCoverage = vibeCoverage(firstVibes, activity.vibes);
  const secondCoverage = vibeCoverage(secondVibes, activity.vibes);
  const sharedVibes = firstVibes.filter(vibe => secondVibes.includes(vibe));
  const sharedCoverage = sharedVibes.length
    ? sharedVibes.filter(vibe => activity.vibes.includes(vibe)).length / sharedVibes.length
    : 0.5;
  const balance = 1 - Math.abs(firstCoverage - secondCoverage);
  const score = Math.round((0.55 * ((firstCoverage + secondCoverage) / 2) + 0.25 * sharedCoverage + 0.2 * balance) * 100);
  const matches = [...new Set([...firstVibes, ...secondVibes].filter(vibe => activity.vibes.includes(vibe)))];
  const missedFirst = firstVibes.filter(vibe => !activity.vibes.includes(vibe));
  const missedSecond = secondVibes.filter(vibe => !activity.vibes.includes(vibe));
  const compromises = [];

  if (missedFirst.length) compromises.push(`Person 1 also picked ${missedFirst.join(", ")}, which this one doesn't really cover.`);
  if (missedSecond.length) compromises.push(`Person 2 also picked ${missedSecond.join(", ")}, which this one doesn't really cover.`);
  if (!firstVibes.length || !secondVibes.length) compromises.push("One of us skipped the vibe question, so we can't tell if this one's a good mood fit.");

  return {
    score,
    agreement: score >= 80 ? "Strong agreement" : score >= 60 ? "Good agreement" : "Mixed preferences",
    reasons: matches.length
      ? `This one's got ${matches.join(", ")} in the mix, and the practical bits work for both of us.`
      : "The practical bits work for both of us, even if neither of us picked its vibe.",
    compromises
  };
}

export function rankActivities(activities, firstAnswers, secondAnswers) {
  const ranked = [];
  const eliminated = [];

  for (const activity of activities) {
    const reasons = [
      ...getIneligibilityReasons(activity, firstAnswers, 1),
      ...getIneligibilityReasons(activity, secondAnswers, 2)
    ];
    if (reasons.length) {
      eliminated.push({ activity, reasons });
      continue;
    }
    ranked.push({ activity, ...scoreActivity(activity, firstAnswers, secondAnswers) });
  }

  ranked.sort((first, second) => second.score - first.score || first.activity.name.localeCompare(second.activity.name));
  return { ranked, eliminated };
}

export const quizOptions = {
  weather: ["Sunny", "Rainy"],
  time: ["Under an hour", "1–2 hours", "3–6 hours", "1 day"],
  energy: ["None", "Little", "Medium", "Lots"],
  vibe: ["Adventure", "Cosy", "Exercise", "Outside", "Learning", "Romantic", "Playful", "Competitive", "Creative", "Connection"],
  budget: ["$0", "$25", "$50", "$100+"]
};

export const quizQuestions = [
  { key: "weather", kicker: "WEATHER CHECK", title: "What's the weather doing?" },
  { key: "time", kicker: "HOW MUCH TIME?", title: "How much time have we got?" },
  { key: "energy", kicker: "ENERGY CHECK", title: "How much energy have we got?" },
  { key: "vibe", kicker: "WHAT SOUNDS GOOD?", title: "What's our vibe today?" },
  { key: "budget", kicker: "WHAT FEELS COMFORTABLE?", title: "What are we happy to spend?" }
];

export function answersAreComplete(answers) {
  return quizQuestions.every(question => Array.isArray(answers[question.key]) && answers[question.key].length > 0);
}
