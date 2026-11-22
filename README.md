# Recipe Exchange

Recipe Exchange is a full-stack MERN project for sharing recipes with other home cooks. Guests can browse recipes and view ingredients. Members can create, edit, and delete their own recipes and like or unlike other members’ recipes. The community feed updates live when recipes or likes change.

## Run locally with Git Bash

Install Node.js 22.12 or newer and make sure MongoDB is running. The default connection uses the local `recipe_exchange` database at `127.0.0.1:27017`. If you use MongoDB Atlas, set `MONGODB_URI` in `.env` before starting the backend.

### Terminal 1 — backend

Open Git Bash and run these commands:

```bash
cd "$HOME/Desktop/FSWD/recipe-exchange"
npm install
if [ ! -f .env ]; then cp .env.example .env; fi
```

Once your database settings are ready, start the backend and leave this terminal open.

```bash
npm start
```

### Terminal 2 — frontend

Open a second Git Bash window and run:

```bash
cd "$HOME/Desktop/FSWD/recipe-exchange"
npm run dev
```

If you saved the project elsewhere, use its actual path in both terminals. Open the Local URL Vite prints, usually `http://localhost:5173`. The frontend forwards API requests to Express on port `4100` by default. If you change `PORT` in `.env`, restart both processes. Press `Ctrl+C` in each terminal to stop the app.

New usernames use 3–30 letters, numbers, or underscores. If you registered before the switch to usernames, enter your previous email address in the Username field and use your existing password.

## Data model and API

- **User** stores a display name, unique normalized username, and salted scrypt password hash.
- **Recipe** stores a title, an array of ingredients, an HTTP(S) image URL, an author reference, timestamps, and references to users who liked it.
- **Session** stores a hashed opaque token, its user reference, and an expiration timestamp. The browser receives the token in an HTTP-only cookie.

| Method and path | Behavior |
| --- | --- |
| POST /api/auth/signup | Register and start a session |
| POST /api/auth/login | Start a session |
| GET /api/auth/me | Get the current member |
| DELETE /api/auth/session | Log out |
| GET /api/recipes | Browse the community feed |
| GET /api/recipes/:id | Read one recipe |
| POST /api/recipes | Publish a recipe |
| PUT /api/recipes/:id | Edit a recipe you own |
| DELETE /api/recipes/:id | Delete a recipe you own |
| PUT /api/recipes/:id/like | Like another member’s recipe |
| DELETE /api/recipes/:id/like | Remove your like |
| GET /api/events | Subscribe to live feed updates |

The recipe form takes one ingredient per line. Images are loaded directly by the browser from their URLs. Express validates incoming fields and enforces recipe ownership on edits and deletes.

## Try the live feed

Open the app in two browser profiles or use a private window for the second account. Sign up in both. Publish a recipe from one window and confirm it appears in the other without reloading. Like it from the second account, then try editing and deleting it from the original account. The live feed uses Server-Sent Events from a single Express instance.
