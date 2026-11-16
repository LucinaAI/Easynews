# חדשות בקלות (Easy News)

Free, static Hebrew news reader for seniors. Large fonts, simple Hebrew, read aloud.
Stories come from ynet RSS, are simplified by Gemini, and saved to data/articles.json by a free hourly GitHub Action.

## Setup (about 10 minutes, free)
1. Create a free Gemini API key at https://aistudio.google.com/apikey (no card needed).
2. Create a new GitHub repository and upload everything in this folder (keep the .github folder).
3. Repo Settings > Secrets and variables > Actions > New repository secret. Name: GEMINI_API_KEY. Value: your key.
4. Repo Settings > Pages > Deploy from branch > main, folder /(root). Your site appears at https://USERNAME.github.io/REPO/
5. Actions tab > "Update news" > Run workflow, to fetch the first real stories. After that it runs every hour.

## Notes
- Open the site on a phone and use "Add to Home Screen" to install it.
- Every story links to the original on ynet. Check ynet's terms before a public launch.
- Change MAX_NEW_PER_RUN or the cron schedule in .github/workflows/update-news.yml if you hit free API limits.
