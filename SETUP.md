# Hall Pass setup

One website, one PIN screen:

- **Your PIN** opens your dashboard: classes, PINs, schedule, no-pass times, the day's log, settings.
- **No logins.** Your PIN is the only lock. Students can't see PINs or change anything except their own spot in line.
- **A student's PIN** opens their own screen: get in line, leave the line, "I'm leaving now," "I'm back."
- **The floating window** sits on top of everything on your computer. It shows "No passes until 9:10," "Maria L., you're up!" or "Maria L. is out · 3:12," with **Left**, **Back**, and **Skip** buttons.

The code goes on GitHub (public is fine, because there are no names in it). Names (first initial + last name, like *M. Lopez*) and passes live in Firebase, locked by the rules in `firestore.rules`.

There's no Google sign-in. The first time you set up, Hall Pass creates a hidden key for your computer. Your **backup file** holds that key, and it's how you get your dashboard back on a new computer, or after your browser data gets cleared. Download it once and keep it somewhere private, like your school OneDrive.

### The one thing to know

**Your computer does the PIN checking.** Students' PINs are never visible to anyone, not even scrambled. A student's computer sends a sealed request that only your screen can open, and your screen answers it. So keep Hall Pass open on your computer during class. Locking the dashboard or minimizing the tab is fine. If it's closed, students see: *"Your teacher's screen isn't answering."*

---

## Already set up an earlier version?

1. In Firebase → **Authentication → Sign-in method**, turn on **Email/Password** (step 3 below). Google sign-in can be turned off.
2. In your GitHub repo, **delete** `teacher.html`, `kiosk.html`, `kiosk.js`, `line.html`, and `line.js`. Upload every file from this folder, but keep your own `firebase-config.js` (or paste your settings into the new one).
3. In Firebase → Firestore Database → **Rules**, replace everything with the new `firestore.rules` and click **Publish**.
4. Open the site → **Teacher setup** → **Set up Hall Pass for the first time**, then re-add your classes. (Old rosters were tied to your Google sign-in, which this version doesn't use.)

## Starting fresh (about 20 minutes)

### 1. Make a Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Create a project** → name it `hall-pass` → Google Analytics can be off → Create.

### 2. Connect the site to it
1. On the project home page, click the **web icon `</>`**. Nickname it `hall-pass`. Leave "Firebase Hosting" unchecked. Register.
2. Copy the six values (`apiKey`, `authDomain`, …) into **firebase-config.js**, replacing each `PASTE_HERE`.

### 3. Turn on the hidden teacher key
**Build → Authentication** → Get started → **Sign-in method** → **Email/Password** → Enable (just the first switch) → Save.
You'll never type an email or password. Hall Pass makes its own, behind the scenes.

### 4. Create the database and lock it down
1. **Build → Firestore Database** → Create database → a US location → **Start in production mode**.
2. **Rules** tab → replace everything with **firestore.rules** → **Publish**.

### 5. Put it on GitHub Pages
1. New repository `hall-pass` → **Add file → Upload files** → every file in this folder → Commit.
2. **Settings → Pages** → Deploy from a branch → `main`, `/ (root)` → Save.
3. Your site: `https://mr-mccormack.github.io/hall-pass/`

---

## First time on your computer

1. Open the site and click **Teacher setup** (under the room code box) → **Set up Hall Pass for the first time**.
2. Create your **teacher PIN** (4–8 digits).
3. Click **Download backup** in the yellow bar. Keep the file somewhere private. Anyone with it could open your dashboard.
4. *Recommended:* In Firebase → **Authentication → Settings → User actions**, uncheck **Enable create (sign-up)** and save. That way nobody else can make their own Hall Pass in your project. (If you don't see that setting, skip this step. It only matters for your free usage limits, not your data.)
5. **Classes:** add each class and paste in names (one per line, like *Maria Lopez* or *Lopez, Maria*; only *M. Lopez* is kept). Type each student's PIN and press Enter. Two students in the same class can't share a PIN.
6. **Schedule:** add a period for each class with its days and times. Set **no passes at the start / end** (10 minutes each by default), and add other no-pass times if you need them.
7. **Settings:** time limit (default 8 minutes), how many students can be out at once, and when the dashboard locks itself.
8. **Live → Copy student link.** Post it for students. They open it once and their computer remembers the room.

**Using another computer** (like your Mac at home): open the site → **Teacher setup** → **Open backup file**. To take Hall Pass off a computer: Settings → **Remove Hall Pass from this computer**.

Testing at night? On **Live**, pick a class "by hand." Set it back to "Follow the schedule" when you're done.

## Every day

- Open the site on your computer and type your PIN, or just leave it open from yesterday.
- Click **⧉ Floating window** and drag it to a corner. In **Chrome or Edge** it stays on top of every app. Other browsers open a normal small window instead.
- Lock the dashboard whenever you like. Passes keep working, and the floating window stays up.
- In Chrome, turn off sleeping tabs for this site: Settings → Performance → *Always keep these sites active* → add `mr-mccormack.github.io`.

## How a pass works

1. Student types their PIN on their computer and taps **Get in line**. Students can join the line during no-pass times; it just waits.
2. When it's their turn, their screen says **"Maria, you're up!"** and your floating window shows the same, with a chime.
3. The student taps **I'm leaving now**, or you tap **Left** on the floating window.
4. When they get back, they tap **I'm back**, or you tap **Back**.
5. If they run over the time limit, the timer turns red everywhere and the pass is flagged in your **Log**.
6. The line clears itself when the next class starts. Sign-ins end at the end of the day.

**Students without a computer:** they can type their PIN on any computer, including yours while it's locked (it signs them out after 45 seconds). Or use **Live → Students without a computer** to add them to the line or send them yourself.

**End of day:** open **Log**. It shows today's passes, the average, and a red **Flagged** box for any that went over. **Download CSV** gives you a spreadsheet.

## Who can see what

| | You | Student (signed in) | Someone with only the link |
|---|---|---|---|
| Names of students out / in line (first + last initial) | ✓ | ✓ | ✓ |
| Rosters, PINs, schedule, log | ✓ | – | – |
| Change the line | ✓ | only themselves | – |

Someone with only the link sees the room, but they'd need a student's PIN to do anything. If the link spreads, click **New code** on Live or Settings. Five wrong PINs in a row locks that computer out for a minute.

Firebase's free plan is plenty for one classroom.
