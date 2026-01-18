# perp-signals-frontend
Frontend prototype for crypto perp signals dashboard.

## Resolving a GitHub merge conflict (no-code, step-by-step)
If your pull request shows **“Resolve conflicts”**, you can fix it directly on GitHub without using the terminal.

### 1) Open the conflict editor
1. Open your pull request in GitHub.
2. Click **Resolve conflicts**.

### 2) Choose which change to keep
You will see blocks like this:

```text
<<<<<<< your-branch
const rejectionSummary = summarizeRejections();
=======
// (nothing in main here)
>>>>>>> main
```

Delete the **conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`) and keep the line you want:

**Keep your branch (accept current change):**
```text
const rejectionSummary = summarizeRejections();
```

**Or keep main (accept incoming change):**
```text
// (nothing in main here)
```

> Tip: If the “main” side is empty, it means **your branch added a line** and main did not. Keeping it means “accept current change.”

### 3) Finish the merge
1. Click **Mark as resolved**.
2. Click **Commit merge**.

That’s it — your PR should now merge cleanly.
