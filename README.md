# Aaki's Developer Journey

A private developer assessment and progress platform built for Aaki's learning journey.

The application allows Aayush to create, schedule, review, and publish coding assessments while Aaki can attempt tests, write code, view project previews, run supported test cases, and receive detailed feedback.

---

## Project Purpose

Aaki's Developer Journey is designed to make developer learning more structured, personal, and confidence-focused.

The platform supports:

- Multiple programming languages
- MCQ and coding assessments
- Scheduled test availability
- Manual coding evaluation
- Public and private test cases
- HTML, CSS, and JavaScript live preview
- Tab-switch activity tracking
- Detailed remarks and review notes
- Progress and result history
- Separate administrator and candidate accounts

---

## User Roles

### Aayush — Administrator

Aayush can:

- Create, edit, publish, and delete assessments
- Add MCQ and coding questions
- Schedule assessment opening date and time
- Configure test duration and instructions
- Add public and private test cases
- Add optional question images
- Review Aaki's submissions
- View tab-switch activity
- Award marks within the allowed maximum
- Add question-wise remarks
- Add overall review notes
- Edit and republish results
- Manage application branding and profile image paths
- Choose a personal theme and colour palette

### Aaki — Candidate

Aaki can:

- Log in using her own Firebase account
- View available and scheduled assessments
- Read instructions before starting a test
- Attempt one-try MCQs
- Write code for supported programming languages
- Use HTML, CSS, and JavaScript live preview
- Open the project preview inside the website
- Run public test cases
- Submit assessments
- View published results and remarks
- Track progress over time
- Choose her own theme and colour palette

Aaki does not have access to administrator tools, answer keys, private test cases, draft reviews, or unpublished results.

---

## Assessment Types

### MCQ Questions

- Each MCQ carries 1 mark
- Only one confirmed attempt is allowed
- The selected answer is locked after confirmation
- Correct answers remain hidden until the result is published

### Coding Questions

Coding questions support configurable marks from 5 to 50.

Available workspace modes:

1. Live web project
2. Source code with test cases
3. Source code only

Supported languages include:

- HTML
- CSS
- JavaScript
- Python
- Java
- C
- C++
- SQL

---

## Live Web Preview

HTML, CSS, and JavaScript questions use a three-file coding workspace.

Features include:

- Separate HTML, CSS, and JavaScript editors
- Automatic combined preview
- In-website focus preview
- Runtime error display
- Autosave
- Relative asset path support
- Preview availability during test, review, and result viewing

The focus preview stays inside the same website and does not open another tab.

---

## Test Cases

Coding questions can contain:

- Public test cases
- Private test cases
- Input
- Expected output
- Optional explanation
- Reviewer notes
- Pass or fail status

Aaki can run public test cases.

Private test cases remain visible only to Aayush.

---

## Test Integrity

During an active assessment, the application records:

- Tab switches
- Window visibility changes
- Time of each event
- Question open at that moment
- Total integrity event count

Aaki receives the assessment instructions before starting.

The timer continues even when the page is refreshed or the tab becomes inactive.

---

## Review and Results

After submission, the assessment status moves through:

```text
Submitted
Under Review
Reviewed
Result Published
```

Aayush can:

- View MCQ answers
- Review submitted code
- Run supported test cases
- View live web project output
- Enter coding marks
- Add question-wise remarks
- Add overall feedback
- Save review drafts
- Publish results
- Reopen and edit published reviews

The application prevents marks above the maximum assigned to each question.

Aaki sees MCQ and coding results only after the complete review is published.

---

## Technology Stack

### Frontend

- HTML
- CSS
- JavaScript

### Authentication

- Firebase Authentication
- Email and password sign-in
- Separate Firebase UIDs for Aayush and Aaki

### Database

- Cloud Firestore

### Deployment

- GitHub
- Vercel

### Code Execution

- Browser sandbox for HTML, CSS, and JavaScript
- Judge0-compatible API support for compiled and interpreted languages
- SQL execution support through the application runtime

---

## Firestore Collections

The application uses the following collections:

```text
users
workspaces
assessmentsPrivate
assessmentCatalog
assessmentContent
attempts
reviews
publishedResults
```

### Collection Purpose

#### `users`

Stores account profile information, role, workspace relationship, and avatar path.

#### `workspaces`

Stores shared branding and workspace configuration.

#### `assessmentsPrivate`

Stores administrator-only assessment data such as answer keys and private test cases.

#### `assessmentCatalog`

Stores candidate-safe assessment listing information.

#### `assessmentContent`

Stores the candidate-safe question content available after the configured opening time.

#### `attempts`

Stores Aaki's answers, code, autosave state, test timing, and integrity events.

#### `reviews`

Stores draft and published review data.

#### `publishedResults`

Stores candidate-safe final result snapshots.

---

## Project Structure

```text
aakis-developer-journey-firebase-v8/
│
├── assets/
│   ├── branding/
│   │   └── app-logo.png
│   │
│   ├── profiles/
│   │   ├── aaki.jpg
│   │   └── aayush.jpg
│   │
│   └── questions/
│       └── optional-question-images
│
├── firebase/
│   ├── firestore.indexes.json
│   └── firestore.rules
│
├── app.js
├── config.js
├── config.example.js
├── firebase.json
├── index.html
├── package-lock.json
├── package.json
├── styles.css
├── vercel.json
├── .gitignore
└── README.md
```

---

## Required Image Paths

Add the application logo at:

```text
assets/branding/app-logo.png
```

Add profile pictures at:

```text
assets/profiles/aayush.jpg
assets/profiles/aaki.jpg
```

Optional question images can be stored inside:

```text
assets/questions/
```

If an image is missing, the interface displays an initials-based fallback.

Image paths can also be changed later from the administrator settings page.

---

## Firebase Configuration

Create a Firebase web application and copy the generated configuration into `config.js`.

```js
window.AAKI_APP_CONFIG = {
  requireCloud: true,

  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  },

  judge0Url: "https://ce.judge0.com",
  judge0AuthToken: ""
};
```

Do not place passwords, Firebase service-account credentials, or private API secrets inside `config.js`.

The Firebase web configuration is allowed in the frontend. Access control is enforced through Firebase Authentication and Firestore Security Rules.

---

## Firebase Accounts

Create two Firebase Authentication users:

```text
Aayush
Role: ADMIN
```

```text
Aaki
Role: CANDIDATE
```

The current application username mappings are:

```text
Aayush → aayush@admin.dev
Aaki → aaki@devjourney.dev
```

The login page accepts the usernames `Aayush` and `Aaki`.

Passwords are managed through Firebase Authentication and must never be committed to GitHub.

---

## Required Firestore Documents

Create these documents using the real Firebase UIDs:

```text
users/AAYUSH_UID
users/AAKI_UID
workspaces/AAYUSH_UID
```

The remaining assessment, attempt, review, and result collections are created automatically by the application.

---

## Firestore Security Rules

The security rules are located at:

```text
firebase/firestore.rules
```

Publish these rules in the Firestore Rules section before using the application.

The rules protect:

- Administrator-only data
- Correct MCQ answers
- Private test cases
- Draft assessments
- Draft reviews
- Other users' attempts
- Unpublished results
- Scheduled question content

---

## Local Development

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run serve
```

Open:

```text
http://localhost:5500
```

Do not open `index.html` directly from the file system.

Use another browser or an incognito window to test the second account.

---

## Vercel Deployment

1. Create a GitHub repository.
2. Push the project files.
3. Import the repository into Vercel.
4. Select the repository root.
5. Use the default static deployment settings.
6. Keep the build command empty unless Vercel detects the package configuration automatically.
7. Deploy.
8. Add the final Vercel domain to Firebase Authentication authorized domains.
9. Test both accounts from separate devices.

Every GitHub push updates the website without deleting Firestore data.

---

## Files Not to Commit

Do not commit:

```text
node_modules/
.env
.env.*
.firebase/
.DS_Store
npm-debug.log*
```

Do not commit:

- Account passwords
- Firebase service-account files
- Private API keys
- Judge0 private tokens
- Backup exports containing sensitive candidate data

---

## Data Persistence

Tests, attempts, submissions, reviews, and results are stored in Firestore.

They are not tied to:

- One browser
- One device
- One Chrome profile
- The local development server
- A specific deployment build

Aayush and Aaki can access their permitted data from any authorized browser or device after signing in.

---

## Theme and Appearance

Both users can independently choose:

- Light mode
- Dark mode
- Aurora Pop
- Digital Ocean
- Code Sunset
- Candy Nebula

Theme preferences are stored separately for each Firebase account.

---

## Current Status

The project currently supports the complete assessment workflow:

```text
Aayush creates assessment
→ Assessment is published
→ Aaki receives the assessment
→ Aaki attempts and submits
→ Aayush reviews the submission
→ Aayush publishes the result
→ Aaki receives marks and remarks
```

---

## Privacy

This is a private two-user learning platform.

Keep the GitHub repository private if profile photographs, private question images, or personal data are included in the project files.

---

## License

Private project for personal learning and assessment use.
