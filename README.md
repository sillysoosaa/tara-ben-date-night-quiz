# Tara & Ben's Date Night Quiz

A little help deciding what to do together. Take turns answering five questions, then see which ideas fit the day we're having.

## Run it locally

1. Open this folder in VS Code.
2. Serve the folder over HTTP using the VS Code **Live Server** extension, or run `python -m http.server 8000` in the terminal.
3. Visit the local address shown by Live Server (or [http://localhost:8000](http://localhost:8000) for Python).
4. Choose **Let's find something**, answer the questions, and submit. In demo mode choose **Continue as Person 2** to try the other set of answers in the same browser.

The demo saves sessions in this browser's local storage. Its codes and links do **not** work on another device. No account or build step is needed.

## Enable shared sessions on separate devices with Supabase

The frontend uses a public Supabase anon key, anonymous sign-in, and row-level security. The schema keeps each person's answers private until both people submit. Never put a Supabase service-role/secret key in this website.

1. Create a Supabase project and open **SQL Editor**.
2. Run the contents of [`supabase/schema.sql`](./supabase/schema.sql).
3. In **Authentication → Providers**, enable **Anonymous Sign-Ins**.
4. In **Project Settings → API**, copy the Project URL and the public `anon` key (not the service-role key) into [`supabase-config.js`](./supabase-config.js).
5. Serve the website over HTTP and open it on both devices. Person 1 starts a quiz and shares the invite link or code; Person 2 opens the link or enters the code on the homepage.

The app checks for the other submission every few seconds while waiting. If Supabase is configured but unreachable or misconfigured, it shows the error rather than silently switching modes. Keep the SQL policies in place when changing the schema.

The anon key is intended to be public. The database policies and functions, not secrecy of that key, restrict access. The invite code is the session's sharing credential, so share it only with the intended person.

## Publish for free

For static hosting, push this folder to a GitHub repository and enable **Settings → Pages** for the branch and folder you use. Add the Supabase project URL and public anon key to `supabase-config.js` before publishing if you want shared sessions. The local demo works on the deployed site too, but only within one browser. You can also use another static host.

## Add or change date ideas

Add one object to [`activities.js`](./activities.js). Each activity has a unique `id`, `name`, allowed `weather`, minimum duration in minutes, minimum energy (`None` 0 through `Lots` 3), `vibes`, estimated minimum `minBudget`, `description`, and an optional emoji `image`. The matching logic stays data-driven; budget figures are estimates and are easy to adjust.

## Swap or add photos

The homepage collage uses the five supplied photos in `images/`: `car.png`, `film.png`, `kalbarri.png`, `milford.png`, and `shadow.png`. To replace one, keep its filename and put the new photo in that folder; the collage will pick it up automatically. If you use a different filename, update that photo's `src` in `index.html`.

The quiz questions use small text symbols set in the `questionSymbols` map in `app.js`. They don't load image files.

## How matching works

- Activities are removed if **either** person can't meet their weather, minimum time, minimum energy, or estimated budget requirement.
- Remaining activities are scored equally for both people. The score weighs average vibe fit (55%), support for shared vibe preferences (25%), and how evenly well suited both people are (20%).
- Scores are relative suitability, not probabilities. A missing vibe preference is treated as neutral. Each result also explains its fit or any vibe compromise; eliminated ideas list the exact practical reason for each person.
- “Surprise us!” chooses randomly among matches within five points of the top score.
- Choose **We did this!** on an activity to save it to the date journal on the homepage.

Run the matching tests with `npm test` (install Node.js LTS first; the app itself has no package dependencies).
