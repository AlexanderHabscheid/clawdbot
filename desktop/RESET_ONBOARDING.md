# Reset Onboarding

If you're seeing old onboarding UI, clear the cache:

1. **Clear localStorage** (in browser console or app):

   ```javascript
   localStorage.removeItem("onboarding_completed");
   ```

2. **Clear build cache**:

   ```bash
   cd desktop
   rm -rf src/dist node_modules/.vite
   ```

3. **Rebuild and restart**:
   ```bash
   npm run dev
   ```

The new React onboarding component should now show with the updated UI.
