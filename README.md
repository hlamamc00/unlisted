# Unlisted

Unlisted helps recruiters find candidates, including the ones they can't find on LinkedIn. A recruiter says who they want in one line ("data analyst in Alpharetta, Georgia who worked at HP"), Unlisted shows the filters it understood, and on **Run search** it looks in two places: LinkedIn profiles through People Data Labs, a licensed data provider, and GitHub, for people found through their public work (many of them not on LinkedIn). Matches come back as profile cards with their work history and how they fit. The recruiter shortlists or hides each one, then drafts a first message that cites the person's work.

## What it does

- **Recruiter accounts:** sign up, log in and log out. Passwords are hashed with bcrypt and sessions are signed cookies.
- **Today:** one page showing what needs the recruiter across their roles: people to review, follow-ups due, people waiting to reply and questions from the agent.
- **One box to start a search,** five ways: describe who you want in a line, paste or upload a job description (PDF, Word or text), paste a Boolean string, paste the profile of someone to find more like, or set the filters by hand.
- **Filters you can check before searching:** job titles, places, employers the person works at or used to work at, minimum years of experience, and words that rule a job title out. Skills and other requirements are **criteria** that rank the matches, each marked must-have or nice to have. Both can be edited later, or changed in plain words ("only people who worked at Dell").
- **Any profession:** analysts, nurses and sales people are found through LinkedIn profiles; people who write code are also found through GitHub.
- **Candidates from three places:** LinkedIn profiles through People Data Labs, GitHub (people found through their public work), and people already found for other searches who fit this one. Anyone can also be added by pasting their GitHub or LinkedIn link.
- **Matches as cards:** who they are, how they fit each filter and requirement, and their work history with dates. **Hide** or **Shortlist** in one click; a reason for hiding is optional, and "wrong location" teaches the search. **Review** shows one person at a time with keyboard shortcuts (J/K, A, H then 1–4, M).
- **Calibration and the sourcing agent:** the first matches calibrate the search. Once the recruiter finishes calibrating, the agent (when it's switched on) looks for more people like the shortlist, shows live progress, asks before changing the search, and can keep searching every night. See below.
- **Shortlist:** shortlisted people move through To contact, Contacted, Replied, Interviewing, Offer and Hired, with private notes and a message history.
- **Messages:** Claude writes a first message from the person's work, signed with the recruiter's name and their scheduling link. With Resend set up it can be emailed from Unlisted (replies go to the recruiter's inbox); otherwise it's copied. A follow-up is suggested after 4 days without a reply, and a second 5 days later.
- **Hiring manager link:** a link to the shortlist that works without an account for two weeks. Their yes or no and comments show on each candidate and are given to the agent.
- **Export:** the pipeline as a CSV file.
- **Privacy:** a privacy notice at `/privacy` and an opt-out at `/opt-out` that deletes the person and stops them being found again.

## Run it locally

You need Node 22 and a Postgres database.

```bash
npm install
cp .env.example .env   # then fill in the values
npx prisma db push
npm run dev
```

Open http://localhost:3000 and create an account.

## Put it online with Netlify

1. Create a free Postgres database on [Neon](https://neon.tech) and copy its pooled connection string.
2. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick this repository. The build settings come from `netlify.toml`.
3. Under **Site configuration → Environment variables**, add:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon's pooled connection string |
| `DATABASE_URL_UNPOOLED` | Optional: Neon's direct connection string, used for schema changes during builds |
| `AUTH_SECRET` | At least 32 random characters. Generate one with `openssl rand -base64 48` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Lets Claude read job descriptions and draft messages |
| `GITHUB_TOKEN` | A GitHub personal access token with no scopes. Raises GitHub's limits from 60 to 5,000 requests an hour |
| `PDL_API_KEY` | A [People Data Labs](https://www.peopledatalabs.com) API key. Adds LinkedIn profiles to searches, and is needed for every search that isn't about people who publish code (an analyst, a nurse, anyone from a named employer). Each profile returned uses one credit (up to 10 per search); the free plan has about 100 a month |
| `APP_URL` | Your site's address, for example `https://unlisted.ai`. Used in the opt-out link in messages |
| `PRIVACY_EMAIL` | The address people write to about their data, shown on the privacy page |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional: lets recruiters email candidates from Unlisted, and emails them when the agent finds new people, through [Resend](https://resend.com). `EMAIL_FROM` must use a domain verified with Resend |

4. Deploy. Production builds run `prisma db push` first, so the database tables are created automatically.

## How the search works

What the recruiter types is read into a brief (`src/lib/brief.ts`): job titles, employers, places, minimum years, title words to leave out, ranking criteria and, for code roles, GitHub search terms. Claude does the reading when `ANTHROPIC_API_KEY` is set; without it a keyword reader handles one-line requests and simple job descriptions. Boolean strings are always read by code, so they mean exactly what was typed.

Each **Run search** or **Find more** runs a small batch, which keeps it inside a web request's time limit: up to 10 LinkedIn profiles from People Data Labs when `PDL_API_KEY` is set, and, for roles where people publish code, up to 3 GitHub searches and 12 people. People found but not yet looked at are kept for the next click. The LinkedIn search asks People Data Labs for people in the US whose current title contains one of the job titles, in the search's places, who work or used to work at the named employers, with at least the minimum years of experience. A search that names employers or isn't about code doesn't use GitHub, because GitHub profiles rarely say where someone has worked.

Unlisted never scrapes LinkedIn itself: LinkedIn sues scrapers, and Proxycurl shut down in 2025 after it was sued. Someone found on both GitHub and LinkedIn is stored once, and every candidate is marked **On LinkedIn** or **Not on LinkedIn**. Profiles are cached for a week. People who opted out are never fetched or shown.

Scores combine the job title, required employers, minimum years and must-have criteria (weight 3 each), nice-to-haves (weight 1) and location, plus a small bonus for GitHub stars and recent activity. Kept out of the matches: people outside the search's places (or outside the US for remote searches), people who never worked at a required employer, people whose title has a word the recruiter ruled out or is a different job, and people meeting fewer than half of the checkable must-haves. People found only through their code have no job title or work history on record, so those checks show as unknown rather than counting against them. A language counts when it's one of someone's main languages on GitHub or listed as a skill on their profile. Education and graduation dates are never collected.

## Messages and email

Messages always end with an opt-out line, and with the recruiter's business address when they've added one in **Settings** (US law expects a postal address in commercial email). When Unlisted sends the email, it goes from `EMAIL_FROM` under the recruiter's name with replies going to the recruiter. Each recruiter can send 40 emails a day, and a person gets at most a first message and two follow-ups. Replies arrive in the recruiter's own inbox, so the recruiter marks the person as Replied; follow-ups are never sent automatically.

## The sourcing agent

The agent is paused for every recruiter until they turn it on under **Settings**, because each run costs money; pausing it again stops a run that's already going. It also waits for calibration: a new search shows a **Calibrating** bar until the recruiter has shortlisted or hidden some of the first matches and clicks **Finish calibrating**. From then on, the agent starts in the background when the recruiter finishes calibrating or clicks **Find more**, while the quick search above shows people within seconds. It needs `ANTHROPIC_API_KEY`.

- **Where it runs:** a Netlify background function (`netlify/functions/agent-background.mts`), which may run for up to 15 minutes. It only drives the conversation with Claude; every step goes through the app's own agent API (`src/app/api/agent`), which does the searching, checking and saving. The two authenticate with a per-run token derived from `AUTH_SECRET`.
- **What it does:** it reads the brief and who the recruiter shortlisted and hid, plans searches on LinkedIn and (for code roles) GitHub, looks closely at promising people, and adds the best to the matches with a note on why they fit and an opening line for a message. The search page shows its progress live, and new candidates appear as they're added.
- **Its checks:** every candidate it adds is checked by code, not by the model. Their location, employers and job title must fit the search, they must meet enough of the must-haves, and every piece of evidence the agent cites must appear in their actual profile. Anything else is rejected and the agent is told why.
- **Questions:** when a choice would change the role, such as allowing remote, it asks instead of assuming. The recruiter answers Yes or No on the role page, and a Yes changes the brief.
- **Limits per run:** 12 minutes, 30 tool calls, 30 people looked at, 8 GitHub searches, 20 LinkedIn profiles and 10 people added, plus 6 manual runs per role a day. Its prompt is cached between steps to keep costs down.
- **Nightly top-up:** with "Keep searching every night" switched on under a search's Details (calibrated searches only), `netlify/functions/agent-nightly.mts` starts a run at 10:00 UTC each day, and the recruiter gets an email when there's someone new (with Resend set up).
- **What it never does:** send messages, decide for the recruiter, or use or guess age, gender, race, religion, national origin, disability or visa status.

## Before launching with real people's data

- Have a US privacy lawyer review the privacy notice and your obligations. Selling access to profiles of people you have no relationship with is likely to make you a data broker, which means registering in California, Texas, Vermont and Oregon and processing deletion requests from California's DROP system.
- Keep it a sourcing tool, not a screening tool. Your terms should forbid using profiles to decide someone's eligibility for a job, which would bring in the Fair Credit Reporting Act.
- Follow GitHub's terms for API use, and only send messages people can easily opt out of.
- Before emailing candidates from Unlisted, add your business address in **Settings** (US law expects one in commercial email) and verify your sending domain with Resend. Send from a domain you can afford to protect: complaints affect its reputation.

## Next

- More sources: research papers (OpenAlex), US patents (PatentsView) and professional directories.
- Sending from the recruiter's own Gmail or Outlook, with replies detected automatically.
- Calendar scheduling, and direct integrations with applicant tracking systems (Greenhouse, Lever, Ashby, Bullhorn).
- Teams: several recruiters sharing roles.
- The recruiter network and split board from the prototype.
