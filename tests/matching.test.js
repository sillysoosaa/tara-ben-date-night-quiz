import test from "node:test";
import assert from "node:assert/strict";
import { activities } from "../activities.js";
import { answersAreComplete, rankActivities } from "../matching.js";

const answers = (overrides = {}) => ({
  weather: ["Sunny", "Rainy"],
  time: ["Under an hour", "1–2 hours", "3–6 hours", "1 day"],
  energy: ["None", "Little", "Medium", "Lots"],
  vibe: ["Adventure", "Cosy"],
  budget: ["$0", "$25", "$50", "$100+"],
  ...overrides
});

test("keeps an activity when the selected alternatives meet each threshold", () => {
  const personOne = answers({ weather: ["Sunny"], time: ["Under an hour", "1–2 hours"], energy: ["Little", "Medium"], budget: ["$0", "$25"] });
  const personTwo = answers({ weather: ["Rainy", "Sunny"], time: ["3–6 hours"], energy: ["Lots"], budget: ["$100+"] });
  const { ranked, eliminated } = rankActivities(activities, personOne, personTwo);

  assert.ok(ranked.some(result => result.activity.id === "comedy-show"));
  assert.ok(ranked.some(result => result.activity.id === "fancy-car-test-drive"));
  assert.ok(eliminated.some(result => result.activity.id === "rottnest-island"));
});

test("treats time selections as available ranges, including the under-an-hour boundary", () => {
  const personOne = answers({ weather: ["Rainy"], time: ["Under an hour"], energy: ["None"], budget: ["$0"] });
  const personTwo = answers({ weather: ["Rainy"], time: ["1–2 hours"], energy: ["None"], budget: ["$0"] });
  const shortActivities = activities.filter(activity => ["surprise-art", "watch-tv", "comedy-show"].includes(activity.id));
  const { ranked, eliminated } = rankActivities(shortActivities, personOne, personTwo);

  assert.ok(ranked.some(result => result.activity.id === "surprise-art"));
  assert.ok(ranked.some(result => result.activity.id === "watch-tv"));
  assert.ok(eliminated.some(result => result.activity.id === "comedy-show"));
});

test("eliminates an idea with explicit person-specific weather, time, energy, and budget reasons", () => {
  const personOne = answers({ weather: ["Rainy"], time: ["Under an hour"], energy: ["None"], budget: ["$25"] });
  const personTwo = answers();
  const picnic = activities.find(activity => activity.id === "kings-park-picnic");
  const { eliminated } = rankActivities([picnic], personOne, personTwo);

  assert.deepEqual(eliminated[0].reasons.map(reason => reason.split(" ")[1]), ["1", "1", "1", "1"]);
  assert.match(eliminated[0].reasons.join(" "), /weather/);
  assert.match(eliminated[0].reasons.join(" "), /time window/);
  assert.match(eliminated[0].reasons.join(" "), /energy level/);
  assert.match(eliminated[0].reasons.join(" "), /budget/);
});

test("scores activities that suit both different vibe preferences above one-sided matches", () => {
  const personOne = answers({ vibe: ["Adventure"] });
  const personTwo = answers({ vibe: ["Cosy"] });
  const both = { ...activities[0], id: "both-vibes", vibes: ["Adventure", "Cosy"] };
  const one = { ...activities[0], id: "one-vibe", vibes: ["Adventure"] };
  const { ranked } = rankActivities([one, both], personOne, personTwo);

  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(ranked[0].activity.id, "both-vibes");
  assert.equal(ranked[0].agreement, "Strong agreement");
});

test("returns no recommendations when both people's selected answers rule everything out", () => {
  const personOne = answers({ weather: ["Sunny"], time: ["Under an hour"], energy: ["None"], budget: ["$0"] });
  const personTwo = answers({ weather: ["Sunny"], time: ["Under an hour"], energy: ["None"], budget: ["$0"] });
  const { ranked, eliminated } = rankActivities(activities, personOne, personTwo);

  assert.equal(ranked.length, 0);
  assert.equal(eliminated.length, activities.length);
});

test("accepts multiple checkbox answers and rejects an unanswered question", () => {
  assert.equal(answersAreComplete(answers()), true);
  assert.equal(answersAreComplete(answers({ vibe: [] })), false);
});
