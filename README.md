# FinancialHub

A clean, mobile-first personal finance and home loan tracking web application.

## Tech Stack

- **Frontend:** React 19 + Vite + Tailwind CSS v4
- **Backend:** Firebase (Firestore + Auth)
- **File Storage:** Google Drive (via Drive API, no Firebase Storage costs)
- **Charts:** Recharts
- **Hosting:** GitHub Pages

## Features

- **Dashboard** — Overview of loan outstanding, expenses, savings, and charts
- **Home Loan Tracker** — Manage loans, builder demands, and payments with auto-calculated fields
- **Expense Tracker** — Daily expense entries with category breakdowns and monthly trends
- **Document Manager** — Upload salary slips (PDF) to your Google Drive, preview in-app
- **SMS Parser** — Paste bank SMS to auto-extract amount, date, and transaction reference
- **Google Sign-in** — One-tap Google login, restricted to a single allowed Gmail account

## Setup

### 1. Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com) and click **Create a project**
   - Enter a project name (e.g. `FinancialHub`)
   - Disable Google Analytics if you don't need it (keeps things simpler)
   - Click **Create project**, wait for it to finish, then click **Continue**

2. Enable **Authentication** with Google Sign-in:
   - In the left sidebar, click **Build → Authentication**
   - Click **Get started**
   - Go to the **Sign-in method** tab
   - Click **Google** in the providers list
   - Toggle the **Enable** switch on
   - Enter your email as the **Project support email**
   - Click **Save**

3. Enable **Cloud Firestore**:
   - In the left sidebar, click **Build → Firestore Database**
   - Click **Create database**
   - Choose a location closest to you (e.g. `asia-south1` for India)
   - Select **Start in production mode** (we'll set proper rules later)
   - Click **Create**

4. Register a Web App to get your config keys:
   - Click the **gear icon** (top-left, next to "Project Overview") → **Project settings**
   - Scroll down to the **Your apps** section at the bottom of the General tab
   - Click the **web icon** (`</>`) to add a new web app
   - Enter a nickname (e.g. `FinancialHub Web`)
   - You do NOT need to enable Firebase Hosting (we use GitHub Pages)
   - Click **Register app**

5. Copy the Firebase config values:
   - After registering, Firebase shows a code snippet like this:
     ```js
     const firebaseConfig = {
       apiKey: "AIzaSyB...",
       authDomain: "your-project.firebaseapp.com",
       projectId: "your-project-id",
       storageBucket: "your-project.appspot.com",
       messagingSenderId: "123456789",
       appId: "1:123456789:web:abc123"
     };
     ```
   - Copy each value — you'll paste them into your `.env` file:
     | Config key | Goes into `.env` variable |
     |---|---|
     | `apiKey` | `VITE_FIREBASE_API_KEY` |
     | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
     | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
     | `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
     | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
     | `appId` | `VITE_FIREBASE_APP_ID` |
   - Click **Continue to console**
   - You can always find these values again at **Project settings → General → Your apps**

### 2. Enable Google Drive API

Every Firebase project automatically has a linked Google Cloud project with the same name. We need to enable the Drive API there so our app can upload documents to your Google Drive.

1. Open [Google Cloud Console](https://console.cloud.google.com)
   - Sign in with the same Google account you used for Firebase (`chinchoretej@gmail.com`)

2. Select the correct project:
   - At the **top-left** of the page, you'll see a project dropdown (next to the "Google Cloud" logo)
   - Click it — a dialog shows all your projects
   - Find and select **financialhub-214f7** (this is the same project Firebase created)
   - If you don't see it, make sure the "All" tab is selected, not "Recent"

3. Navigate to the API Library:
   - In the left sidebar, click **APIs & Services** (you may need to click the hamburger menu ☰ first)
   - Then click **Library** (or go directly to [API Library](https://console.cloud.google.com/apis/library))

4. Enable the Google Drive API:
   - In the search bar, type **Google Drive API**
   - Click on **Google Drive API** from the results
   - Click the blue **Enable** button
   - Wait a few seconds — once enabled, you'll see a "Google Drive API" dashboard page

5. That's it — no extra setup needed:
   - When you enabled Google Sign-in in Firebase (step 1.2), Firebase automatically created an OAuth 2.0 client
   - Our app uses that same client to request Drive permissions during sign-in
   - You do NOT need to create any API keys or OAuth credentials manually

### 3. Firestore Security Rules

In Firebase Console → Firestore → Rules, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email == "your-email@gmail.com";
    }
  }
}
```

Replace `your-email@gmail.com` with your actual Gmail address.

### 4. Environment Variables

Copy `.env.example` to `.env` and fill in your Firebase config values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|----------|-----------------|
| `VITE_FIREBASE_API_KEY` | Firebase Console → Project Settings → Web app config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Same as above |
| `VITE_FIREBASE_PROJECT_ID` | Same as above |
| `VITE_FIREBASE_STORAGE_BUCKET` | Same as above (keep it even though we don't use Storage) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Same as above |
| `VITE_FIREBASE_APP_ID` | Same as above |
| `VITE_ALLOWED_EMAIL` | Your Gmail address (only this account can sign in) |

### 5. Local Development

```bash
npm install
npm run dev
```

### 6. Deploy to GitHub Pages

1. Push to a GitHub repository (private recommended)
2. Go to repo **Settings → Pages → Source → GitHub Actions**
3. Go to repo **Settings → Secrets and variables → Actions**
4. Add each `VITE_*` variable from `.env.example` as a repository secret
5. Push to `main` branch — the workflow builds and deploys automatically

Your app will be live at `https://<username>.github.io/FinancialHub/`

## How Google Drive Integration Works

- On Google Sign-in, the app requests `drive.file` scope (access only to files the app creates)
- Documents are uploaded to a folder called **FinancialHub_Docs** in your Google Drive
- Files are set to "anyone with link can view" so the in-app preview works
- Metadata (title, month, salary amount, Drive file ID) is stored in Firestore
- After a page refresh, click **Connect** on the Documents page to re-authorize Drive access
- **Cost: $0** — Google Drive gives you 15 GB free

## Firestore Schema

| Collection  | Key Fields |
|-------------|-----------|
| `loans`     | loanAccountNumber, bankName, sanctionAmount, interestRate, tenure, emiAmount, preEmiAmount, totalDisbursed, remainingAmount |
| `demands`   | demandDate, constructionStage, demandAmount, gstAmount, totalDemand, dueDate, status |
| `payments`  | demandId, paymentDate, paidBy, amountPaid, gstPaid, totalPaid, transactionRef, outstandingAmount, delayDays |
| `expenses`  | date, category, amount, paymentMode, notes |
| `documents` | title, month, salaryAmount, fileName, driveFileId, viewUrl, previewUrl |

## Folder Structure

```
src/
├── components/      Reusable UI (Card, Modal, Layout, EmptyState)
├── contexts/        AuthContext (Google Sign-in + Drive token)
├── hooks/           useFirestore (Firestore CRUD), useGoogleDrive (Drive API)
├── lib/             Firebase config
├── pages/           Dashboard, Loan, Expenses, Documents, SmsParse, Login
├── App.jsx          Router setup
├── main.jsx         Entry point
└── index.css        Tailwind imports
```

## Security

- Google Sign-in restricted to a single hardcoded Gmail address
- Firestore rules enforce server-side auth check on the same email
- Google Drive scope limited to `drive.file` (app can only see its own files)
- API keys stored in environment variables (not committed)
- GitHub Actions secrets for production builds
- Use a **private** GitHub repository
